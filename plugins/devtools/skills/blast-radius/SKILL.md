---
name: blast-radius
description: "Run pnpm blast-radius in common to list every file that depends on the branch's changes, with a 0-100 review-impact score (the section CI posts). Use when asked what a change touches or how risky a diff is, before refactoring a shared module, or before /review."
---

## Run it (from the common repo root)

```bash
pnpm blast-radius --base origin/dev --quiet          # markdown "## Blast radius" section
pnpm blast-radius --base origin/dev --quiet --json   # same data as JSON
```

- The script is `scripts/blast-radius.ts` (root `package.json` script `blast-radius`). CI runs both forms on every PR (`.github/workflows/tests.yml`, "Measure the blast radius") and posts the result. Never paste it into a PR body or write it by hand.
- It diffs committed work only (`<merge-base>...HEAD`). Commit before you run it.
- `--quiet` hides the progress lines on stderr. Other flags: `--max-depth N` (default 25), `--engine auto|typescript|fallow`, `--root DIR`.

## Reading the output

- **Score and band:** `0–19 LOW`, `20–39 MODERATE`, `40–64 ELEVATED`, `65+ HIGH`. The score is advice, not a gate. It sums reach (35), exposure to untested code (25), intricacy (25) and coupling (15).
- **Reach line:** "N changed file(s) reach X product file(s) at runtime across `<workspaces>`, plus T test file(s), and a further Y through types alone." Only the runtime product set drives the score. A type-only radius means `tsc` is the check that matters.
- **"Reached through N direct importer(s)":** the few files that carry most of the reach. Start here.
- "the change is a leaf" means nothing imports the changed files.
- JSON keys: `changed`, `downstream`, `downstream_type_only`, `impact.score`, `impact.band`, `impact.components[]`, `truncated`.

## Judging undue reach

Compare the radius with what the task needs:

- The reach crosses workspaces or entrypoints (routes, routers, workflows) the task does not name.
- One direct importer carries most of the radius, because you edited a shared module where a local change would do.
- The band is ELEVATED or HIGH for a task the plan sized as small.

Then narrow the change: add a new function in place of changing a shared one's contract, move the edit down to the one consumer, or split the shared-module change into its own PR (see `branch-and-pr`). If the reach is real and the task needs it, say why in the PR body in one sentence.

## Review checklist

- [ ] Ran `pnpm blast-radius --base origin/dev --quiet` on the committed branch
- [ ] Every workspace and entrypoint in the reach line belongs to the task
- [ ] The top direct importers are files the task meant to change
- [ ] ELEVATED/HIGH reach is either narrowed or justified in one PR-body sentence
- [ ] No blast-radius section pasted into the PR body
