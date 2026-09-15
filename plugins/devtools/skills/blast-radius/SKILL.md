---
name: blast-radius
description: Report what a change reaches — every file that transitively imports something the branch changed, plus fallow's own risk flags on the changed set (fan-in against the repo's percentiles, import cycles, architecture-boundary violations). Prints the `## Blast radius` markdown section that pr-description requires, or JSON. Use when asked what a change touches or affects, how risky or far-reaching a diff is, what depends on a file, before refactoring a shared module, when reviewing someone else's branch, or when invoking /blast-radius.
---

# Blast radius

Answers one question: **what does this change reach?**

The script walks the import graph upwards from every file the branch changed and reports each file that transitively imports one of them — not the direct importers, the full downstream set. A four-line edit to a shared hook that forty modules reach is a different review than the same four lines in a leaf, and nothing in the diff says which one you are looking at.

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
| `--workers N` | — | Parallel `fallow` calls. Barely helps; the walk is IO-bound. |
| `--json` | off | Emit the structured result instead of markdown. |

Requires **Node >= 22.18 or >= 23.6** — it is dependency-free TypeScript run through Node's built-in type stripping, with no build step. `--no-warnings` only suppresses the experimental-type-stripping notice; without it that notice goes to stderr and the markdown on stdout is still clean.

## Reading the output

```markdown
## Blast radius

6 changed file(s) reach **23 file(s)** downstream across `apps/api`, `apps/app`, `services/workflows`.

- **High fan-in** — `packages/common/src/client.ts` is imported directly by 242 files (repo p95 is 10). Every change here amplifies.

**apps/api**

- `apps/api/app/api/v1/workflows/route.ts`
```

Three things to know when you read it:

- **A leaf is a result.** `Nothing imports the N changed file(s) — the change is a leaf.` is an answer, not a failure. Leave it in the PR body.
- **Over 25 downstream files the list collapses into `<details>`.** Every path is still there; collapsing keeps the summary line readable, it does not trim the set.
- **Only the p95 fan-in outliers are named** (top 5, then a count). A wide diff puts dozens of files over p75, and listing them all buries the cycles underneath.

Deleted files are dropped from the seed set — nothing is left to trace, and anything still importing them fails typecheck long before review — as are non-JS/TS paths. A migration-only or docs-only diff reports no radius.

## What it costs

The risk flags are flat-cost: three `fallow` calls regardless of diff size. The transitive walk is not — one `fallow` process per file in the radius, and fallow reloads its cache each call.

| Diff | Radius | Time |
|---|---|---|
| Normal single-task PR | tens of files | 5–10 seconds |
| 52-file release train | 1163 files | ~4.5 minutes |

So run it **once**, at PR time, not repeatedly during a task. On a branch that wide the radius is most of the app and the exhaustive list stops discriminating — say so in the paragraph above it and keep the generated section as-is. Don't hand-trim it, and don't lower `--max-depth` to make the number look smaller.

## How it works

Two parts, because fallow answers half of this natively and not the other half.

**The risk flags come from fallow.** Fallow's own term for blast radius is **fan-in** — "Number of files that import this file. High fan-in means high blast radius." `fallow health --file-scores --targets` reports fan-in for every file *and* the repo's own `fan_in_p75` / `fan_in_p95` percentiles in one call, so a changed file is judged against how this codebase is actually shaped rather than a threshold invented here. `fallow dead-code --changed-since <base>` separately flags import cycles and architecture-boundary violations involving the changed files.

**The transitive set is not something fallow reports**, so the script composes it out of `fallow dead-code --trace-file <path> --format json`, which gives the direct importers of one file. Starting from `git diff --name-only $(git merge-base <base> HEAD)...HEAD`, it walks importers breadth-first, memoizing every file it has seen so a cycle or a diamond costs one trace rather than an unbounded walk. Output is grouped by workspace and sorted, so re-running on the same diff gives a byte-identical section.

Two traps if you extend the script:

1. `fallow dead-code` **exits 1 whenever it finds any issue at all**, which in a real repo is always. Parse its stdout and ignore the exit code.
2. **Boundary zones are opt-in.** `common` declares one zone per workspace in the `boundaries` block of `.fallowrc.json`, each allowed to import exactly the workspaces its `package.json` depends on, so an undeclared or inverted cross-package import shows up as a violation. In a repo with no zones the check reports nothing rather than confirming nothing is wrong — the section says so out loud instead of printing a reassuring zero.
