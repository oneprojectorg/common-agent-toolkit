---
name: implement-task
description: Drive an Asana task from picked → ready-for-review — claim it atomically, move it to In-Progress, branch off dev, investigate bugs, plan, run the RGR loop, the gate suite (typecheck / test / e2e / fallow), `/simplify` + `/review`, then open a draft PR whose description ends with the CRAP metrics block, and move the task to In-Review (or Blocked on failure). Use after a task gid has been chosen (e.g. by `pickup-task`) or when asked to implement, work, or drive a task.
---

Drives a single Asana task from picked → ready-for-review. This skill owns **all** mutation of the Asana task: the atomic claim, every section move, every comment we post, the feature branch, and the PR. `pickup-task` only selects which task to work on.

**Preconditions**: you have a `TASK_ID` (Asana task gid). Branch may or may not exist yet — Step 1 creates it. You do NOT need to have already claimed the task or moved it on the board.

## Required env

- `ASANA_PERSONAL_ACCESS_TOKEN`, `ASANA_PROJECT_ID` — see `asana-api`.
- `ASANA_IN_PROGRESS_SECTION_ID` — section we move to on claim.
- `ASANA_IN_REVIEW_SECTION_ID` — section we move to when the PR is opened.
- `ASANA_BLOCKED_SECTION_ID` — section we move to when something goes wrong mid-task.

If any are unset, stop and ask the user to fill `.env.local`. Do not invent gids.

## Hard rules (read first)

These apply to every run of this skill. No exceptions, no "the diff is tiny" carve-outs:

1. **ALWAYS run `pnpm format` before every commit.** Every commit, including the plan commit, the first RGR commit, and any fixup commits. Details in Step 7.
2. **Every PR opens in draft mode** (`gh pr create --draft --base dev`). Agents never open straight to "ready for review" — the author marks it ready when they're satisfied. Details in Step 8.
3. **Every PR has an assignee set** — the GitHub user mapped from the Asana task's assignee (`scazan` / `valentin0h` / `nourmalaeb`). If the assignee doesn't map, skip the assignment rather than guessing. Details in Step 8.
4. **Every PR description ends with the CRAP metrics block**, directly above the Asana link. No carve-out for a one-line diff or a docs-only diff — a docs-only diff gets the one-line form. `pr-description` owns the score, the table, and the filtering rules. Details in Step 8.

## Step 1 — Claim and branch

Claim the task atomically, move it to In-Progress, then create the feature branch. The claim is a UUID we both write into the task (as a story) and persist locally so we can recognize the task on a later retry.

### Local claim cache

We persist every UUID we generate to `~/.cache/claude-pickup/<task_gid>` (per-machine). This lets us answer one question on a later iteration: *did this machine already claim this task before?* Useful when a task we previously worked on was moved back to Backlog (often with a new comment containing extra info — clarification, re-prioritization, test feedback) and we want to pick it up again rather than walking past it as "already claimed by someone".

### Before claiming, check for prior claims

The block below answers "should I claim this task or stop?" by inspecting the most recent `agent-claim:` story. Read its `echo` output as your decision signal:

- "Retry detected: …" — re-read comments since the prior claim for new context, then run the **claim + move** block to stamp a fresh UUID.
- "already claimed by another agent" — stop. The caller should pick a different task (via `pickup-task`) or abort.
- No output from the `if` block — no prior claim exists; run the **claim + move** block.

```bash
TASK_GID="$TASK_ID"
CACHE_DIR="$HOME/.cache/claude-pickup"
mkdir -p "$CACHE_DIR"
PRIOR_CLAIM_FILE="$CACHE_DIR/$TASK_GID"

# What's the last claim story on the task (if any)?
LAST_CLAIM=$(curl -s -H "Authorization: Bearer $ASANA_PERSONAL_ACCESS_TOKEN" \
  "https://app.asana.com/api/1.0/tasks/$TASK_GID/stories?opt_fields=text,created_at" \
  | jq -r '.data | map(select(.text | startswith("agent-claim:"))) | sort_by(.created_at) | last | .text // empty')

if [ -n "$LAST_CLAIM" ]; then
  PRIOR_UUID="${LAST_CLAIM#agent-claim:}"
  if [ -f "$PRIOR_CLAIM_FILE" ] && [ "$(cat "$PRIOR_CLAIM_FILE")" = "$PRIOR_UUID" ]; then
    echo "Retry detected: this machine previously claimed $TASK_GID."
    # The task was moved back to Backlog after our last attempt — likely
    # with new context. Read the comments since the last claim story for
    # the new info, then re-claim with a fresh UUID below.
  else
    echo "Task $TASK_GID is already claimed by another agent ($PRIOR_UUID)."
  fi
fi
```

### Claim + move

```bash
# Generate a new UUID and persist it before stamping.
AGENT_ID=$(uuidgen)
echo "$AGENT_ID" > "$PRIOR_CLAIM_FILE"

# Stamp the claim by appending a comment (story). Comments are append-only,
# so two parallel agents can't overwrite each other's claim — but the LAST
# claim story wins, which is why the verify below is required.
curl -s -X POST -H "Authorization: Bearer $ASANA_PERSONAL_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"data\":{\"text\":\"agent-claim:$AGENT_ID\"}}" \
  "https://app.asana.com/api/1.0/tasks/$TASK_GID/stories"

# Move to In-Progress
curl -s -X POST -H "Authorization: Bearer $ASANA_PERSONAL_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"data\":{\"task\":\"$TASK_GID\"}}" \
  "https://app.asana.com/api/1.0/sections/$ASANA_IN_PROGRESS_SECTION_ID/addTask"
```

On a retry, the user has likely added a comment with new info. Read all stories newer than the prior claim and treat them as additional task context before planning:

```bash
# Comments since our previous claim
curl -s -H "Authorization: Bearer $ASANA_PERSONAL_ACCESS_TOKEN" \
  "https://app.asana.com/api/1.0/tasks/$TASK_GID/stories?opt_fields=text,created_by.name,created_at" \
  | jq --arg prior "$PRIOR_UUID" \
      '.data | map(select(.text | startswith("agent-claim:") | not)) | .[]'
```

### Verify the claim still holds

Re-read the most recent claim story on the task. If it isn't ours, another agent grabbed it between our claim and our move.

```bash
LATEST_CLAIM=$(curl -s -H "Authorization: Bearer $ASANA_PERSONAL_ACCESS_TOKEN" \
  "https://app.asana.com/api/1.0/tasks/$TASK_GID/stories?opt_fields=text,created_at" \
  | jq -r '.data | map(select(.text | startswith("agent-claim:"))) | sort_by(.created_at) | last | .text')

if [ "$LATEST_CLAIM" != "agent-claim:$AGENT_ID" ]; then
  echo "Lost claim race for $TASK_GID — backing off."
fi
```

If the echo prints "Lost claim race", another agent grabbed the task between our claim and our verify. Do **not** roll back the section move (the winning agent now owns the task); stop and report to the caller. Do not proceed to branch / read / RGR.

### Branch

Create the feature branch off `dev` named `issue-$TASK_GID` — the literal `issue-` prefix followed by the Asana task gid you claimed. Every agent picking up the same task derives the same branch name, which is what lets parallel pickups across machines coordinate (and what lets a human glance at a branch and find the task).

Base the branch **explicitly on `origin/dev`**. Never `git checkout dev` (the protected-branch hook blocks switching HEAD onto dev) and never run a bare `git checkout -b` from the current HEAD — after a previous task, HEAD is still that task's branch, and branching from it silently stacks this task on top of the last one:

```bash
git fetch origin dev
git checkout -b "issue-$TASK_GID" origin/dev
```

Then verify the new branch sits exactly on the dev tip:

```bash
if [ "$(git merge-base HEAD origin/dev)" != "$(git rev-parse origin/dev)" ]; then
  echo "STOP: issue-$TASK_GID is not based on the origin/dev tip."
fi
```

If the guard prints STOP, do not work around it and do not proceed to Step 2 — something rebased or blocked the branch creation. Report the state to the caller (or follow Step 8 "On failure") so a human can untangle it.

## Step 2 — Read the task

Pull the task body and stories via `asana-api` (the skill has the
endpoint reference). Capture any verification steps from
`notes` and the most recent stories — `## Verification`,
"Verify by:", "Acceptance criteria", or any clearly-demarcated set
of concrete steps. You'll execute them in Step 7.

If `notes` references a parent PRD, pull that too.

## Step 3 — BUG MODE

If the task is a bug fix — title or description contains "bug",
"regression", "broken", "error", "fails", "incorrect", or "crash" —
run `/investigate` BEFORE writing any code. The skill produces a
structured root-cause hypothesis; use it to inform the RGR loop in
Step 6.

When you ran `/investigate`, skip Step 4 (PLAN REVIEW) — the
investigation already covers the design context.

Every code change kept after `/investigate` must be tied to the
reported symptom. If the investigation flags adjacent suspicious
code that doesn't reproduce the bug, leave it alone — open a
separate Asana follow-up if it's worth tracking. Speculative fixes
bundled into a bug-fix PR get the PR rejected.

## Step 4 — PLAN REVIEW

For features and non-trivial refactors, run `/autoplan` against a
draft plan **before** writing any code.

Skip entirely for:
- Bug fixes (Step 3 BUG MODE replaces this).
- Revision-mode runs (the feedback already replaces the plan
  review).

Otherwise: draft a short plan file (`.plans/$TASK_ID.md` or your
project's conventional path) with **Problem** (1-2 sentences),
**Approach** (3-7 bullets), **Files**, **Edge cases**, **Out of
scope**. Half a page. Then invoke `/autoplan` and pass the path —
it runs CEO → Design → Eng → DX reviews and writes the revised
plan back.

If `/autoplan` flags scope changes that materially expand the task
beyond the Asana ticket, post a comment on the task summarising
the expansion and **abort without committing code** (see Step 8
"On failure" — move to Blocked). A human will re-scope.

Commit the reviewed plan file in the same commit as the first
implementation change.

## Step 5 — EXPLORATION

Read the relevant code; pay extra attention to test files near the
parts you're about to change.

**Downstream test scan.** Before changing any user-visible string,
error fallback, render branch, or exported component, grep
`tests/`, `**/*.spec.ts`, `**/*.test.ts` for assertions that
reference it. If matches exist, your change must either keep the
assertion green or update it in the same commit with a one-line
note explaining why. Silently breaking a previously-green
assertion (especially in `tests/e2e/`) is the most common way
these PRs regress real behavior.

## Step 6 — EXECUTION (RGR)

Red-Green-Refactor:

1. **RED**: write one test that fails for the right reason.
2. **GREEN**: write the minimum implementation to pass it.
3. **REPEAT** until the task is done.
4. **REFACTOR** once green.

For pure refactors with no behavior change, the RED step is "the
existing tests still pass after the refactor" — don't invent
synthetic tests. For docs- or config-only changes, skip RGR.

## Step 7 — FEEDBACK LOOPS

### ALWAYS format before every commit

Before **every** `git commit` — the plan commit, every RGR commit,
every fixup commit — run:

```bash
pnpm format
```

No exceptions. "It's a one-line change", "it's only markdown",
"only the plan file changed" — still run it.

Before signaling complete (run all of them; do NOT cherry-pick):

```bash
pnpm typecheck
pnpm test
pnpm e2e                          # playwright; pnpm test does NOT include this
```

Then run the fallow audit via the MCP — `mcp__fallow__audit` (verdict
must be `"pass"`). If the fallow MCP isn't registered on this machine,
fall back to `npx fallow audit --format json`; the verdict field is
the same.

Skip `pnpm e2e` only when the diff has no UI / route / API
surface. Note the reason in the commit message; the reviewer
re-runs it either way.

**Task-specific verification.** Walk through every verification
step from the Asana task (Step 2). Execute each — open the URL,
walk the flow, inspect the data — and confirm the observed
behavior matches what's expected. If the task has none, or its
notes say to skip, fall back to the standard gates above.

### Mandatory cleanup + review pass

Once the gate suite is green, run — in this order, every time,
no exceptions:

1. `/simplify` — strip cruft, dead code, premature abstractions,
   and over-engineered scaffolding from the diff. Apply the
   suggested simplifications, then re-run `pnpm typecheck`,
   `pnpm test`, and `pnpm e2e` to confirm the simplified code
   still passes.
2. `/review` — final code review on the diff, run as a **loop**
   until the diff is ship-ready:
   1. Run `/review` against the current diff. Always call the
      codex adversarial review alongside it so both perspectives
      score the same revision.
   2. Apply the fixes for every finding (or, if a finding is a
      deliberate non-change, record the reason in the commit
      message or task comment so the next pass can see it).
   3. Re-run `pnpm typecheck`, `pnpm test`, and `pnpm e2e` to
      confirm the fixes didn't regress the gate suite.
   4. Re-run `/review` (and the codex adversarial review) on the
      updated diff.
   5. Repeat 2–4 until a full pass produces no new actionable
      findings — i.e. every remaining item is either already
      addressed in this pass or explicitly marked as a deliberate
      non-change. Only then is the diff ready to ship.

   Cap the loop at **10 `/review` iterations**. If the 10th pass
   still surfaces actionable findings, do NOT silently keep
   looping and do NOT ship anyway — stop, post a comment on the
   Asana task summarising the outstanding findings and what you
   tried, and ask the user how to proceed. Treat this as a
   hand-off, not a failure: the task stays in In-Progress while
   you wait for direction.

   Within that cap, "ready to ship" is the only exit condition.
   Do not exit early because the remaining findings feel minor
   or because you're confident the reviewer will catch the rest
   — keep iterating until `/review` comes back clean or you hit
   the 10-iteration cap.

Skip neither. "The diff is small" / "I already self-reviewed" /
"there's nothing to simplify" are not valid reasons to skip —
run both and let them confirm.

### A failing or unrun gate is a STOP signal

The reviewer re-runs every gate from a clean checkout. Shipping
with skipped or hand-waved gates is the most expensive failure
mode in this pipeline.

You MUST NOT signal completion citing any of:

- "Pre-existing errors", "errors in files I didn't touch",
  "module resolution issues unrelated to my change".
- "Infrastructure", "environment", "sandbox limitation".
- "I'll let CI verify", "the reviewer will re-run".

These are recoverable problems you must address on this branch.
Try the obvious recovery (e.g. reinstall deps for environment
issues — see the caller's prompt or runbook for project-specific
recovery steps).

If after recovery the gate still fails for reasons genuinely
outside the diff, treat it as on-failure (Step 8 "On failure") —
post a Blocked comment and move the task to `ASANA_BLOCKED_SECTION_ID`.

## Step 8 — Done / not done

### Done

When gates are green and `/simplify` + `/review` are clean: open a PR targeting `dev`. **Always open the PR in draft mode** (`gh pr create --draft --base dev`) — every PR from this skill starts as a draft so the reviewer can opt in to the green-light moment instead of being paged the second CI starts. Include the Asana task URL (`https://app.asana.com/0/$ASANA_PROJECT_ID/$TASK_GID`) in the PR description so reviewers can jump to the task. The branch hooks will block any attempt to commit/push to `main` or `dev` directly. See `branch-and-pr` for the PR template / conventional-commit rules.

### CRAP metrics in the PR description

Compute the CRAP metrics **before** you call `gh pr create`, and end the body with them (Hard rule 4). Read `pr-description` for the score, the table columns, and the four filtering rules; this step is only about when to do it.

1. List the functions the branch adds or changes:
   ```bash
   git diff origin/dev...HEAD
   ```
   Work from the diff, not from your memory of the task. A function you touched in a `/review` pass counts.
2. Score each one. Complexity comes from reading the function. Coverage comes from the coverage reporter when the workspace has one, and from reading the tests when it doesn't — label the block as an estimate in that case.
3. Paste the block into the body, above the Asana link.

The metrics report the diff you are about to open, so a late fix invalidates them. If a `/review` iteration or a gate failure changes any function after you compute the block, recompute it. Do not reuse a block from an earlier iteration, and do not report a score you did not derive from the current diff.

### Assign the PR to the Asana assignee

After the PR is open, set the PR's assignee to the GitHub user that matches the Asana task's assignee. Only three GitHub assignees are valid: `scazan`, `valentin0h`, `nourmalaeb`. Map by the Asana assignee's first name (case-insensitive):

| Asana assignee first name | GitHub login |
| --- | --- |
| Scott | `scazan` |
| Valentin | `valentin0h` |
| Nour | `nourmalaeb` |

If the Asana assignee doesn't map to one of the three (unassigned, someone else, or ambiguous), skip the assignment. Don't guess.

```bash
# Look up the Asana assignee's name.
ASSIGNEE_NAME=$(curl -s -H "Authorization: Bearer $ASANA_PERSONAL_ACCESS_TOKEN" \
  "https://app.asana.com/api/1.0/tasks/$TASK_GID?opt_fields=assignee.name" \
  | jq -r '.data.assignee.name // empty')

case "$(echo "$ASSIGNEE_NAME" | tr '[:upper:]' '[:lower:]')" in
  scott*)     GH_ASSIGNEE="scazan" ;;
  valentin*)  GH_ASSIGNEE="valentin0h" ;;
  nour*)      GH_ASSIGNEE="nourmalaeb" ;;
  *)          GH_ASSIGNEE="" ;;
esac

if [ -n "$GH_ASSIGNEE" ]; then
  gh pr edit --add-assignee "$GH_ASSIGNEE"
fi
```

Then post the PR link to the task and move it to In-Review:

```bash
curl -s -X POST -H "Authorization: Bearer $ASANA_PERSONAL_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"data\":{\"text\":\"PR opened: <pr-url>\"}}" \
  "https://app.asana.com/api/1.0/tasks/$TASK_GID/stories"

curl -s -X POST -H "Authorization: Bearer $ASANA_PERSONAL_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"data\":{\"task\":\"$TASK_GID\"}}" \
  "https://app.asana.com/api/1.0/sections/$ASANA_IN_REVIEW_SECTION_ID/addTask"
```

(`ASANA_IN_REVIEW_SECTION_ID` is in `.env.local.example`. If unset, leave the task in In-Progress and ask the user where it should go.)

### On failure

If anything goes wrong mid-task (build broken, requirements ambiguous, scope blew up, gate failed for reasons outside the diff), do **not** quietly leave the task in In-Progress, and do **not** move it back to Backlog yourself — re-picking it without new info just leads to the same failure. Move it to Blocked so a human can review, add the missing context, and move it back to Backlog when it's ready for another attempt:

1. Add a story explaining exactly what blocked — what you tried, what failed, the error or ambiguity, and what info you'd need to retry. Be specific; the human reading it should be able to act without spelunking.
2. Move the task to `ASANA_BLOCKED_SECTION_ID`:
   ```bash
   curl -s -X POST -H "Authorization: Bearer $ASANA_PERSONAL_ACCESS_TOKEN" \
     -H "Content-Type: application/json" \
     -d "{\"data\":{\"task\":\"$TASK_GID\"}}" \
     "https://app.asana.com/api/1.0/sections/$ASANA_BLOCKED_SECTION_ID/addTask"
   ```
3. Leave the local claim cache file (`~/.cache/claude-pickup/$TASK_GID`) in place. When the human moves the task back to Backlog with new info, the next pickup run will recognize it as a retry (see Step 1) and read the newly-added comments as additional context.
4. Do NOT close the task.

## Scope rules

- ONE task at a time. Don't pull adjacent fixes into the diff.
- In revision mode, the issue scope is **the feedback** — don't
  expand into unrelated changes.
- Stay on the feature branch. Pushing to `main` or `dev` is
  blocked by hooks (see `branch-and-pr`).
