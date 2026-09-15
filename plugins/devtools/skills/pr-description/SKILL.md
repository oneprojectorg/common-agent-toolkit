---
name: pr-description
description: How to write a PR description in this repo — short, concise, and to the point. Describe only what the reviewer cannot get from the diff, and spend the words on architectural considerations (new boundaries, data flow, schema shape, coupling, migration order), with a mermaid diagram when structure is the point. Every body carries a generated `## Blast radius` section — every file that transitively imports the change, from the bundled fallow-backed script. One paragraph is the default; no test-plan checklist, no walk-through of the diff, no AI-generated summary. Mermaid ERDs for schema PRs, sequence/flowchart diagrams for cross-service or multi-step flows, stacked-PR references, a required CRAP metrics table at the end, Asana task link. Use when opening a PR (via implement-task or by hand), drafting a PR body, or deciding what to include / omit.
---

PR descriptions in this repo are **short, concise, and to the point**. The diff speaks for itself; the description tells the reviewer what changed and why in as few words as that takes. Most merged PRs are one paragraph. A handful are longer, and they earn the extra words by explaining a non-obvious constraint, root cause, or stack relationship.

Write every surviving sentence in the `technical-writing` skill's Simplified Technical English — active voice, a named actor, one word per meaning, no filler ("It is important to note", "Crucially"). This skill decides what belongs in the body; `technical-writing` decides how to phrase it.

The test for every sentence: **could the reviewer get this from the diff?** If yes, cut it. What survives is almost always **architectural** — the shape of the change rather than its contents:

- A new or moved boundary (a procedure tier, a service split, a package dependency).
- Data flow and ownership — who calls what, what now holds the state, what the source of truth is.
- Schema shape and relationships.
- Coupling the reviewer would otherwise have to infer, and migration or rollout order.
- The constraint that forced the design, when the obvious approach was rejected.

When that shape is easier to see than to read, draw it — a mermaid diagram is part of the description, not decoration. Everything else stays out.

Three blocks are exempt from that test because they are not prose: the generated blast radius, the CRAP metrics table, and the Asana link. All three are required on every PR. See "Blast radius" and "CRAP metrics" below.

## The default — one paragraph plus the generated blocks

Most PRs need exactly this:

```markdown
<One paragraph: what the change does, and the why behind it. End with any non-obvious follow-up or context the reviewer needs.>

## Blast radius

<Generated — see below.>

## CRAP metrics

| Function | File | Complexity | Coverage | CRAP |
|---|---|---|---|---|
| `mergeProposalFields` | `packages/common/src/services/decision/mergeProposalFields.ts` | 9 | 60% | 14 |

Worst: 14 (`mergeProposalFields`). Nothing above 30.

Asana: https://app.asana.com/0/<project>/<task_gid>
```

Models from PRs that closed cleanly:

- **#1240**: "Makes each endpoint's auth posture explicit ahead of opening any public access. Renames the closed-network procedure (`commonAuthedProcedure` → `networkAuthenticatedProcedure`) and adds inert `authenticatedConfirmedProcedure`, `authenticatedProcedure`, and `openProcedure` scaffolding with no endpoint behavior change yet."
- **#1252**: "Mirror the profile-side `assertProfileAccess` utility for organizations so org-access denials are fetched, checked, and unified on `UnauthorizedError` in one place."
- **#1244**: "Move both access-user lookups off the legacy `db._query` API onto `db.query`, the source of truth for relations going forward. The v2 result types match the normalizer, so the role and profile type assertions are no longer needed."

That's the bar. One declarative sentence about what, one about why or consequence, optional one about follow-ups. Stop there.

## Blast radius — required in every PR

Every PR body carries a `## Blast radius` section: **every file that transitively imports something the branch changed**. Not a summary, not the direct importers — the full downstream set. A reviewer approving a four-line change to a shared hook deserves to see, without going and looking, that it is reachable from forty other modules.

Generate it; never write it by hand:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/pr-description/scripts/blast-radius.py"
```

It prints the finished markdown section — paste it in verbatim, directly above the CRAP metrics block. It defaults to `origin/dev` (what PRs here target) and walks the whole graph; `--base <ref>`, `--max-depth <n>` and `--json` are there when you need them.

### What it does

Fallow has no impact command, so the script composes one out of `fallow dead-code --trace-file <path> --format json`, which reports the direct importers of one file. Starting from `git diff --name-only $(git merge-base origin/dev HEAD)...HEAD`, it walks importers breadth-first, memoizing every file it has seen so a cycle or a diamond costs one trace rather than an unbounded walk. Output is grouped by workspace and sorted, so re-running on the same diff gives a byte-identical section.

Over 25 downstream files the list moves inside a `<details>` block. Every path is still in the body — collapsing keeps the summary line readable, it does not trim the set.

```markdown
## Blast radius

6 changed file(s) reach **23 file(s)** downstream across `apps/api`, `apps/app`, `services/workflows`.

**apps/api**

- `apps/api/app/api/v1/workflows/route.ts`

**apps/app**

- `apps/app/src/components/decisions/ProposalView.tsx`
- ...
```

A change nothing imports says so — `Nothing imports the N changed file(s) — the change is a leaf.` That is a real result, not a failure; leave it in.

### What it costs

One `fallow` process per file in the radius, and fallow reloads its cache each call. A normal single-task PR (a handful of files, tens downstream) takes **5–10 seconds**. A wide diff is much worse: a 52-file release-train branch reaching 1163 files took **~4.5 minutes**, and `--workers` barely helps because the walk is IO-bound. Two consequences:

- Run it **once**, at PR time, not repeatedly during the task.
- On a branch that wide, the radius is most of the app and the exhaustive list stops discriminating. Say so in the paragraph above it and keep the generated section as-is — don't hand-trim it, and don't lower `--max-depth` to make the number look better.

Deleted files are dropped from the seed set (nothing is left to trace, and anything still importing them fails typecheck long before review), as are non-JS/TS paths — a migration-only or docs-only PR reports no radius.

## When a PR needs more

A small set of cases earn extra structure. Don't reach for them by default — only when the PR genuinely needs them.

### A mermaid diagram when structure is the point

Draw the architecture when a diagram lands it faster than a paragraph. Pick the form that matches what changed, keep it to the nodes that changed plus their immediate neighbours, and don't diagram a change one sentence already covers.

| Change | Diagram |
|---|---|
| Tables added, relationships changed | `erDiagram` |
| A flow crossing services, jobs, or the client/server line | `sequenceDiagram` |
| A new boundary, a moved responsibility, a rewired data flow | `flowchart` |

An `erDiagram` is required, not optional, for any PR adding tables or changing relationships — reviewers read the ERD before the SQL. PR #1186 is the model.

````markdown
<One-paragraph summary.>

## Table structure

```mermaid
erDiagram
  profiles ||--o{ resource_collection_profiles : has
  resource_collections ||--o{ resource_collection_profiles : "shared with"
  resources ||--o{ resource_collection_items : "appears in"
  ...
```
````

### Bug-fix PRs with a non-obvious root cause

When the root cause is the kind of bug that will recur in similar shape (a stale-closure, a race, a cache-key drift), name it. PR #1176 is the model — the root-cause paragraph becomes the post-mortem someone debugging a similar issue will grep for next time. Don't expand a bug-fix description when the root cause is obvious from the diff.

### Stacked PRs

If the PR depends on another open PR, say so at the top:

> Stacked on the moderation_flags schema PR (#1264).

When a release-train PR follows a sequence, list the stack in order:

> Service layer + tRPC routes: #1180. UI: #1181. This PR (#1186) is now rebased onto `dev`.

### Follow-ups

If the PR surfaced concrete items that didn't fit its scope, list them — one line each, action-oriented. Keep it tight:

```markdown
## Follow-ups (out of scope)

- **Budget validation gap:** map `money` in `X_FORMAT_TO_FIELD_TYPE` + add budget checks to `getFieldErrors`.
- **Drift risk:** `LOCKED_PROPOSAL_FIELD_KEYS` hardcodes the editor's locked/editable split; a shared constant would be sturdier.
```

Two rules:
1. **Concrete enough that someone else could pick it up.** "Refactor this later" doesn't qualify.
2. **Already in scope but punted, not ideas.** If it isn't going to happen, leave it out.

When the follow-up is non-trivial, file an Asana task and link it — the PR section is for "where do we pick up from here," the task tracker is for actually following up.

## CRAP metrics

Every PR body ends with a CRAP metrics block, directly above the Asana link. CRAP is the Change Risk Anti-Patterns score. It combines how branchy a function is with how much of it the tests reach, so the reviewer sees where the risk sits before reading the diff. Print the block on every PR, including a one-line change.

### The score

```
CRAP = complexity² × (1 − coverage)³ + complexity
```

`coverage` is a fraction from 0 to 1. Round the score to a whole number.

Count `complexity` as McCabe cyclomatic complexity. Start at 1 and add 1 for each of: an `if`, an `else if`, a `case` (not `default`), a loop, a `catch`, a ternary, and each `&&`, `||`, or `??`. Count the same way on every PR — the numbers are only useful when they compare.

Read `coverage` from a coverage reporter when the workspace has one. The `common` monorepo has none today, so derive it instead: divide the branches a test exercises by the function's total branches, and use 0 when no test reaches the function. Mark the block as an estimate when you derive it this way.

### The block

Add one row per function the diff adds or changes, sorted by score, highest first. Then state the worst score and whether anything is above 30.

```markdown
## CRAP metrics

| Function | File | Complexity | Coverage | CRAP |
|---|---|---|---|---|
| `resolveVoteWeight` | `packages/common/src/services/decision/resolveVoteWeight.ts` | 12 | 0% | 156 |
| `mergeProposalFields` | `packages/common/src/services/decision/mergeProposalFields.ts` | 9 | 60% | 14 |
| `getProposalVotes` | `packages/common/src/services/decision/getProposalVotes.ts` | 7 | 100% | 7 |

Worst: 156 (`resolveVoteWeight`) — the retry branches need a live queue, so they stay untested for now. Coverage is estimated from the tests; the repo has no coverage reporter.
```

Four rules keep the block short:

1. Skip a function with a complexity of 1. It carries no signal. Add a trailing line — "6 straight-line functions omitted" — so the reviewer knows the table is filtered.
2. Keep the 10 highest rows when the table runs longer. Add "+ 14 more, all under 6".
3. Write one line of justification for any score above 30, as in the example. A high score with no explanation reads as an oversight.
4. Write "No executable functions changed." when the diff only touches docs, config, schema SQL, or fixtures. That line is the whole block.

The block does not replace the paragraph, and the paragraph does not describe the block. A score above 30 is not a blocker — it is a flag the reviewer decides on.

## What NOT to include

- **No test-plan checklist.** Reviewers know what gates run and CI re-runs them. A `- [ ] pnpm typecheck` checklist is noise. The CRAP block is not a test plan — it reports risk, not which gates you ran, and it stays.
- **No diff walk-through.** Reviewers read the diff. A bullet list that just enumerates "added X to file Y, added Z to file W" gets skimmed.
- **No implementation narration.** Which hook you used, which helper you renamed, how many files moved — that's the diff's job. Describe the architecture the change lands in, not the steps that got it there.
- **No decorative diagram.** A mermaid block that redraws what one sentence already said costs the reviewer more than it gives.
- **No marketing copy.** "Comprehensive refactor", "unlocks a powerful workflow" — drop it. Be flat.
- **No "Skipped locally" section.** If you're handing off a gate to CI, that's a process decision and doesn't need to be debated in the PR body. The implement-task skill governs when gates are required at task-completion time.
- **No screenshots unless they actually clarify the change.** A modal that's "wider now" doesn't need a before/after; a layout shift that's hard to describe might.
- **No hand-written blast radius.** The section is generated. A prose guess at what a change touches is exactly the claim a reviewer cannot check.

## Title vs body

The title carries the conventional-commit type and one-line description: `feat(decisions): add admin review-selection screen`. Under 70 characters; details go in the body. The `branch-and-pr` skill owns title conventions; this skill is just about the body.

## Asana link

Every PR opened by `implement-task` includes:

```
Asana: https://app.asana.com/0/<project_gid>/<task_gid>
```

Drop it on the last line. Reviewers click through to read the original task; the link gets used in both directions (the task also gets a "PR opened: <url>" story posted back).

## Don't

- **Don't paste an AI-generated summary** of the diff. Concise human framing beats verbose mechanical narration.
- **Don't open a PR without the Asana link** — it's what makes the PR findable from the task tracker.
- **Don't open a PR without the CRAP block.** "The diff is one line" and "nothing here is risky" are the cases the block answers in one line — write that line.
- **Don't pad the CRAP table.** One row per changed function, filtered by the four rules above. A table longer than the paragraph defeats the point.
- **Don't expand a Summary just to look thorough.** A one-line PR description for a one-line change is correct, not lazy.
- **Don't leave an architectural change undescribed.** Short is the rule; silent is not. If the PR moves a boundary, changes who owns state, or reorders a migration, that belongs in the body even when the diff is small.
- **Don't open a PR without a Blast radius section.** It is the one section every body has, whatever the size of the diff.
- **Don't edit the generated radius** to make it shorter or tidier. If the number is alarming, that is information the reviewer wants; put the reassurance in your paragraph, not in the file list.
- **Don't bury a Stacked-on PR** in the middle of the body. First line of the summary, or its own line above it.
