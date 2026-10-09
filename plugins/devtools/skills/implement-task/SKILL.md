---
name: implement-task
description: Implement one task end-to-end — resolve source (Asana gid/URL, GitHub issue, spec file, prompt), claim, branch off origin/dev, plan, RGR, gates, CRAP, /simplify + review loop, draft PR, hand-off. Use when asked to implement, fix, or work a task or issue, or for /implement-task.
---

Drives one task from input to draft PR. Works with a runner (`pickup-task` hands over `TASK_ID=<asana gid>`) or standalone: `/implement-task <asana gid | asana URL | #123 | github issue URL | spec path | free text>`.

**Ownership.** The main agent owns the source adapter (claim, comments, status), git, and the PR. Subagents explore, run gates, and review. They never edit tracker state, commit, or push.

Every comment, story and PR body follows `technical-writing` (Simplified Technical English).

## Hard rules

1. Branch from `origin/dev`, never from current HEAD. Never `git checkout dev` (hook-blocked).
2. `pnpm format:changes` before every `git add`/commit. It formats unstaged changes only, so run it before staging. Bare `pnpm format` is denied in common.
3. Every PR opens as a draft: `gh pr create --draft --base dev`.
4. No changed function at CRAP ≥ 30; don't raise the CRAP of a touched function (see Step 6).
5. Never `pnpm build` or `pnpm w:db migrate`. After a schema change, run `pnpm w:db generate`.
6. One task per branch. Don't pull adjacent fixes into the diff (`branch-and-pr` owns scope discipline).

## Step 0 — Resolve the source

| Input | Adapter |
|---|---|
| `TASK_ID`, a bare numeric Asana gid, `asana:<gid>`, or an `app.asana.com` URL | [references/adapter-asana.md](references/adapter-asana.md) |
| `#<n>`, `gh:<n>`, or a `github.com/.../issues/<n>` URL | [references/adapter-github.md](references/adapter-github.md) |
| A spec file path (`spec:<path>` or an existing file) or free text | [references/adapter-local.md](references/adapter-local.md) |

Read the adapter. It defines **fetch**, **claim**, **branch name**, **comment**, **transitions** (`in_progress`, `in_review`, `blocked`) and **hand-off**. The rest of this skill calls only those. "Comment" or "transition" below means "do what the adapter says". The local adapter makes both no-ops.

Fetch produces a brief: title, body, verification / acceptance steps, assignee hint, source URL. Keep the verification steps; Step 6 executes them.

## Step 1 — Claim and branch

1. Run the adapter's **claim**. If it says stop (claimed by another agent, lost race, closed issue), stop and report.
2. Branch name: `issue-<gid>` (Asana), `issue-gh-<n>` (GitHub), `<type>/<slug>` otherwise.
3. Create it on the dev tip and verify:

```bash
git fetch origin dev
git checkout -b "$BRANCH" origin/dev
[ "$(git merge-base HEAD origin/dev)" = "$(git rev-parse origin/dev)" ] || echo "STOP: $BRANCH is not on the origin/dev tip."
```

On STOP, don't work around it. Go to **On failure**.

## Step 2 — Plan

**Bug mode.** If the title or body says bug, regression, broken, error, fails, incorrect or crash, run `/investigate` before writing code. Every kept change must tie to the reported symptom. Adjacent suspicious code that doesn't reproduce the bug stays out; note it as a follow-up in the PR body or a comment.

**Explore with a subagent.** Don't read broadly in the main context. Spawn `devtools:task-explorer` (Agent tool, `subagent_type: "devtools:task-explorer"`) with the brief. It returns files to change, the pattern to copy, ripple, tests, risks and size. Read only the files it names.

**Downstream tests.** Before changing a user-visible string, error fallback, render branch or exported component, make sure the brief lists the specs that assert on it (`tests/e2e/tests/**`, `**/*.test.ts(x)`, `**/*.spec.ts`). Keep them green, or update them in the same commit and say why.

**Write the plan** in the conversation (not a committed file): Problem (1–2 sentences), Approach (3–7 bullets), Files, Edge cases, Out of scope, Verification. For features and non-trivial refactors (not bug mode, not review-revision runs), run `/autoplan` on it.

If the plan grows materially past the task as written, comment the expansion, transition to `blocked`, and stop without code. A human re-scopes.

## Step 3 — Size and stacking

Split into a stack of PRs when any holds:

- roughly > 400 changed lines;
- several independent layers (e.g. schema + API + UI);
- several separately reviewable concerns.

Use `gh stack` (`init`, `add`, `submit`, `sync`). `branch-and-pr` owns the commands and the ordering rules: independent slices go on dev, dependencies at the bottom. Each slice passes Steps 5–7 on its own before the next starts. Name slices `<branch>-<n>-<slice>`.

## Step 4 — Load conventions

From the plan's Files list (later: `git diff --name-only origin/dev...HEAD`), invoke each matching skill with the Skill tool before writing code in that area. Re-check when the diff reaches new paths.

| Paths | Skills |
|---|---|
| always | `devtools:code-conventions` |
| `services/db/**` | `devtools:drizzle-migrations` |
| `services/api/src/routers/**`, `services/api/src/encoders/**` | `devtools:api-endpoints`, `devtools:access-control` |
| uploads / storage / signed URLs | `devtools:api-endpoints` (its `references/file-uploads.md`) |
| `packages/common/src/services/**` | `devtools:service-layer-structure` (plus `devtools:access-control` when it gates on roles) |
| `packages/common/src/realtime/**`, `services/realtime/**`, or a new mutation that others must see | `devtools:realtime-channels` |
| `apps/app/**/*.tsx` | `devtools:component-file-structure` |
| any `.tsx` / `.jsx` | `vercel:react-best-practices` (always) |
| user-facing strings (`apps/app/**`, emails, error messages shown to users) | `devtools:i18n-strings` |
| `packages/sense/**`, `packages/styles/**`, or UI library components | `devtools:sense-conventions` |
| `*.test.ts(x)`, `*.spec.ts`, `tests/e2e/**` | `devtools:test-conventions` |

## Step 5 — Implement (red-green-refactor)

1. **Red**: one test that fails for the right reason.
2. **Green**: the minimum code to pass it.
3. Repeat until the plan is done, then **refactor** while green.

Pure refactors: red is "existing tests still pass". Docs or config only: skip RGR. Commit in small conventional commits (`branch-and-pr`), with `pnpm format:changes` first every time.

Once the change is drafted, run `pnpm blast-radius --base origin/dev --quiet` (`devtools:blast-radius` explains the output). If the reach (importers and packages touched) is out of proportion to the task, find the narrower change point and narrow the diff.

## Step 6 — Gates

Delegate to `devtools:gate-runner` (Agent tool, `subagent_type: "devtools:gate-runner"`) so logs stay out of context. Tell it the touched packages and whether UI flows changed. It runs and returns failures only:

1. `pnpm format:changes`
2. typecheck per touched package (`pnpm w:app typecheck`, `pnpm w:api typecheck`, …; `pnpm typecheck` for all)
3. unit tests for touched packages (`pnpm w:<pkg> test`)
4. `pnpm test:coverage`, then `pnpm health --base origin/dev`
5. `pnpm blast-radius --base origin/dev --quiet`
6. `pnpm e2e` when UI flows, routes, or API surface used by the UI changed

Fix each failure in the main context and re-run the gate-runner until it reports all PASS.

**CRAP.** `pnpm health --base origin/dev` exits non-zero when a changed file has a function at CRAP ≥ 30. Iterate: add tests for the uncovered branches first, split or flatten second, until it exits 0 with `CRAP: OK`. `CRAP: STALE` is not a pass. `--json` always exits 0, so never gate on it. Formula, scope, held-out workspaces and the delta rule: [references/crap.md](references/crap.md).

**Task verification.** Execute every verification step from the brief: open the URL, walk the flow, inspect the data. Confirm the observed behavior. If there are none, the gates are the bar.

**A failing or unrun gate is a stop signal.** Not acceptable as reasons to ship: "pre-existing errors", "files I didn't touch", "environment / sandbox", "CI will verify". Try the obvious recovery (reinstall deps, restart the test Supabase). If it still fails for reasons outside the diff, go to **On failure**.

## Step 7 — Review loop

1. Run `/simplify` on the diff. Apply what it finds.
2. In **one message**, spawn the reviewers whose areas the diff touches, plus `/review` and the codex adversarial review (`/codex`), so every perspective scores the same revision:
   - `devtools:backend-reviewer`: `services/**`, `packages/common/**`
   - `devtools:frontend-reviewer`: `apps/app/**`, `packages/sense/**`, any `.tsx`
   - `devtools:test-reviewer`: any test or spec file changed, or behavior changed without one
3. Fix every finding, or record a deliberate non-change with a one-line reason (commit message or comment).
4. Re-run the gate-runner (CRAP numbers are invalid after any edit).
5. Repeat 2–4 until a round produces no new actionable findings (every item is fixed or marked as a deliberate non-change). Cap: **10 rounds**. If round 10 still has actionable findings, don't ship: comment the open findings and what you tried, leave the task `in_progress`, and stop for direction.

## Step 8 — Draft PR and hand-off

1. Push the branch and open the PR. `pr-description` owns the body. Include the source link (Asana URL, `Closes #<n>`, or nothing for local). Leave out CRAP and blast-radius numbers; CI posts both.

```bash
git push -u origin "$BRANCH"
gh pr create --draft --base dev --title "<conventional title>" --body-file <file>
```

   For a stack, `gh stack submit --auto` pushes every slice and opens the PRs as drafts. Then set each body with `gh pr edit <n> --body-file <file>`.
2. Run the adapter's **hand-off** (assignee, "PR opened" comment, `in_review`).
3. When CI finishes, read the PR-metrics comment (see `references/crap.md`). Fix any CRAP regression on a function you touched, or any file pushed over 30, and push again.

## On failure

Build broken, requirement ambiguous, scope blew up, gate failing outside the diff, or the branch guard printed STOP: don't leave the task silently in progress. Comment exactly what blocked (what you tried, what failed, the error, what a retry needs), transition to `blocked`, and stop. Never move a task back to its backlog yourself, and never close it.
