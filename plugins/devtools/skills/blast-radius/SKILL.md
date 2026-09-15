---
name: blast-radius
description: Report what a change reaches and how much review it warrants — every file that transitively depends on something the branch changed, proved symbol by symbol against the TypeScript checker, plus a 0-100 review-impact score built from fallow's health signals (complexity over the repo's own limits, fan-in/fan-out percentiles, churn hotspots, test reachability). Prints the `## Blast radius` markdown section that pr-description requires, or JSON. Use when asked what a change touches or affects, how risky or far-reaching a diff is, whether a change needs human review, what depends on a file, before refactoring a shared module, when reviewing someone else's branch, or when invoking /blast-radius.
---

# Blast radius

Answers two questions: **what does this change reach**, and **how much review does it warrant?**

The script walks the dependency graph upwards from every file the branch changed and reports each file that transitively depends on one of them — not the direct importers, the full downstream set. A four-line edit to a shared module that forty files reach is a different review than the same four lines in a leaf, and nothing in the diff says which one you are looking at.

`pr-description` requires this section in every PR body. This skill is the tool itself, so you can also run it on its own — before a refactor, while reviewing someone else's branch, or any time "what depends on this?" is the question.

## Run it

```bash
node --no-warnings "${CLAUDE_PLUGIN_ROOT}/skills/blast-radius/scripts/blast-radius.ts"
```

It prints the finished markdown section on stdout. Never write the section by hand — a prose guess at what a change touches is exactly the claim a reviewer cannot check.

| Flag | Default | What it does |
|---|---|---|
| `--base REF` | first of `origin/dev`, `dev`, `origin/main`, `main` that resolves | Diff against this ref. PRs here target `dev`. |
| `--root DIR` | the repo the command runs in | Run against another checkout. |
| `--max-depth N` | 25 | Stop the upward walk after N hops. |
| `--engine` | `auto` | `typescript` forces the symbol graph and fails if it is unavailable; `fallow` forces the file-level fallback. |
| `--quiet` | off | Suppress the progress lines on stderr. |
| `--json` | off | Emit the structured result instead of markdown. |

Progress goes to **stderr**, so stdout stays exactly the markdown section:

```
blast-radius: 6 changed file(s) vs origin/dev; building the symbol graph
  loaded 24 TypeScript project(s)
  radius: 255 runtime, 421 type-only, depth 9
  collecting health signals
  score 45/100 (ELEVATED) in 4.3s
```

Requires **Node >= 22.18 or >= 23.6** — it is dependency-free TypeScript run through Node's built-in type stripping, with no build step. `--no-warnings` only suppresses the experimental-type-stripping notice; without it that notice goes to stderr and the markdown on stdout is still clean.

## Reading the output

The section leads with the score, then the radius, then a collapsed breakdown of how the score was computed and a collapsed file list.

```markdown
## Blast radius

**Review impact: 45/100 — ELEVATED.** Worth a reviewer who knows this area.

6 changed file(s) reach **255 file(s)** at runtime across `apps/api`, `apps/app`,
`packages/common`, and a further 421 through types alone.
```

### The score

| Score | Band | What it means |
|---|---|---|
| 0–19 | `LOW` | Contained enough to merge on a skim. |
| 20–39 | `MODERATE` | A normal review should cover it. |
| 40–64 | `ELEVATED` | Worth a reviewer who knows this area. |
| 65–100 | `HIGH` | Have someone read it, and walk the downstream entrypoints. |

Four weighted dimensions, each shown with the measurements behind it:

- **Reach (35)** — how much of the codebase depends on the change at runtime, as a share of this repo, plus how many *entrypoints* (routes, tRPC routers, workflows, jobs) it reaches. Entrypoints score separately because forty components behind one route is a smaller review than forty routes.
- **Exposure (25)** — how much of the change and its radius no test can reach, and whether the diff carries its own tests.
- **Intricacy (25)** — functions in the changed files over the repo's *own* `.fallowrc.json` complexity limits, and how much there is to read.
- **Coupling (15)** — fan-in and fan-out against the repo's own percentiles, import cycles, boundary violations, and git churn hotspots.

Every threshold is either a limit this repo configured, a percentile fallow measured on this repo, or a ratio against this repo's size, so the score calibrates itself rather than encoding one codebase's idea of "big". The weights are the one editorial choice: reach and exposure dominate because a wide, untested change is exactly the one a human has to read, while complexity and churn are tie-breakers a careful author may already have handled.

**The score is advice, not a gate.** `configs/fallow/README.md` in `common` draws the same line around CRAP, for the same reason: a number computed from a static graph should inform a reviewer, not block a merge. Don't wire it into CI as a hard fail.

### The radius

- **Runtime versus type-only.** A file reachable through a chain of value imports can change behaviour when it runs. A file reachable only through `import type` — or through a plain `import { SomeType }` that the checker knows carries no value — is checked by `tsc` before anything executes. Both are listed, type-only ones marked `_(type-only)_`, but only the runtime set drives the score. A change whose whole radius is type-only says so, and that is a genuinely smaller review.
- **A leaf is a result.** `Nothing imports the N changed file(s) — the change is a leaf.` is an answer, not a failure. Leave it in the PR body.
- **The longest proven chain is shown** so the number is auditable. Every hop is an import the TypeScript checker resolved; you can open the files and check it.
- **Over 25 downstream files the list collapses into `<details>`.** Every path is still there; collapsing keeps the summary line readable, it does not trim the set.

Deleted files are dropped from the seed set — nothing is left to trace, and anything still importing them fails typecheck long before review — as are non-JS/TS paths. A migration-only or docs-only diff reports no radius.

Keep the generated section as-is. Don't hand-trim it, and don't lower `--max-depth` to make the number look smaller.

## What it costs

About **5 seconds** on a ~2,100-file monorepo, near enough flat regardless of how wide the diff is: one pass to build the graph, then four `fallow` calls that each cost the same whatever the diff contains.

| Phase | Time |
|---|---|
| Load the TypeScript projects | ~1s |
| Build and invert the symbol graph (2,084 files, 19,070 symbols) | ~1.3s |
| fallow health signals (4 calls, parallel) | ~2s |

The `--engine fallow` fallback is a different story — one `fallow` process per file found, ~23 seconds to hit its 400-file budget on the same diff — which is why it is only used where the checker is unavailable.

## How it works

Two parts: the graph, and the signals scored against it.

### The graph comes from the TypeScript checker

The obvious source of import edges is `fallow dead-code --trace-file`, which reports the direct importers of one file. Its edges are *file*-level: `A` imports `B` if `A` names `B`'s module. Through a barrel that re-exports with `export *`, that makes every consumer of the barrel a dependent of every file behind it. Measured on `common`, a six-file moderation change traced to **1,015 files** that way — and of the 289 files importing the `@op/common` barrel, exactly **one** actually depended on a changed file. A number nobody can check is worse than no number.

So the walk is built on symbol identity instead. `typescript/unstable/sync` exposes the real checker: for each import or export specifier it resolves the *symbol*, `getAliasedSymbol` follows it through however many `export *` hops it takes, and the symbol's declarations name the file that actually declares it. The barrel drops out, because it routes symbols rather than owning them. `SymbolFlags.Value` then separates runtime edges from erased ones. Every edge is one the compiler itself resolves.

It is also both faster and *more complete* than the file walk it replaces: **2.1s versus 3m45s**, and a strict superset — fallow's per-file trace missed 46 real edges on that diff, including an inbound moderation webhook route. That is not a knock on fallow, whose job here is the health signals; it is what a file-level graph can and cannot say.

Output is grouped by workspace and sorted, and the walk takes frontier order rather than completion order, so re-running on the same diff gives a byte-identical section.

### The signals come from fallow

All flat-cost, one call each, run in parallel:

- `fallow audit --changed-since <base>` — functions in the changed files over the repo's own complexity limits, plus duplication and dead code, with a verdict.
- `fallow health --file-scores --targets` — fan-in and fan-out for every file *and* the repo's own `fan_in_p95` / `fan_out_p95` percentiles in one call, so a changed file is judged against how this codebase is actually shaped.
- `fallow health --hotspots` — git churn × complexity, i.e. code that has needed repeated attention.
- `fallow health --coverage-gaps` — which files no test can reach.

Three traps if you extend the script:

1. `fallow` **exits 1 whenever it finds any issue at all**, which in a real repo is always. Parse its stdout and ignore the exit code.
2. **`--coverage-gaps` is static reachability, not coverage.** A file counts as reachable if any import path reaches it from a test root. So "not reachable" is a hard finding — no test can touch this — while "reachable" only means a test *could*, not that one does. The section says so inline. For measured coverage, `common` has `pnpm health` after an instrumented run; see `configs/fallow/README.md`, which explains at length why fallow's own `crap` column is not the one that gates there.
3. **Boundary zones come from `.fallowrc.json`, and the script reads them at run time.** `common` declares one zone per workspace, each `allow`ing the workspaces its `package.json` actually depends on, so undeclared and inverted cross-package imports surface as violations and score in Coupling. Nothing in this script is hardcoded to that shape: it asks `fallow list --boundaries` whether zones are `configured` on each run. Against a checkout with no `boundaries` block it says so out loud rather than printing a reassuring zero, and against a configured one the disclaimer disappears and violations start counting — no edit either way.
