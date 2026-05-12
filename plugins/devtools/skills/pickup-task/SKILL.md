---
name: pickup-task
description: Pick up the next available Agent task from Asana — filter Backlog + Type=Agent + assigned to me, then claim atomically. Use when asked to pick up, claim, or grab a task, when invoking /pickup-task, or when starting work without a specific task URL.
---

This skill builds on `asana-api` (auth, base URL, endpoint reference). Read that skill first if you don't already know how to call Asana REST.

## Required env

- `ASANA_API_KEY`
- `ASANA_PROJECT_ID`
- `ASANA_BACKLOG_SECTION_ID` — section we pull from
- `ASANA_IN_PROGRESS_SECTION_ID` — section we move to on claim
- `ASANA_IN_REVIEW_SECTION_ID` — section we move to when a PR is opened
- `ASANA_BLOCKED_SECTION_ID` — section we move to when something goes wrong mid-task

If any are unset, stop and ask the user to fill `.env.local`. Do not invent gids.

## The eligibility rules

A task is eligible only if **all** of:

1. It lives in the Backlog section (`ASANA_BACKLOG_SECTION_ID`).
2. It is **assigned to the API token's owner** (`assignee.gid === me.gid`). Unassigned or other-assigned tasks are ignored.
3. It has the custom field `Type` with value `Agent` (the field is multi-enum; "Agent" must be one of the selected values).
4. It is not already completed (`completed_since=now` filters the listing).

## Step 1 — list eligible tasks

```bash
ME_GID=$(curl -s -H "Authorization: Bearer $ASANA_API_KEY" \
  "https://app.asana.com/api/1.0/users/me" | jq -r '.data.gid')

curl -s -H "Authorization: Bearer $ASANA_API_KEY" \
  "https://app.asana.com/api/1.0/sections/$ASANA_BACKLOG_SECTION_ID/tasks?completed_since=now&limit=100&opt_fields=gid,name,notes,assignee.gid,custom_fields.name,custom_fields.multi_enum_values.name,custom_fields.enum_value.name" \
  > /tmp/asana-backlog.json
```

Filter the result locally — keep tasks where:
- `assignee.gid === $ME_GID`
- some `custom_fields[].name === "Type"` and that field's `multi_enum_values[].name` (or `enum_value.name`) contains `"Agent"`

Pull comments for each candidate if you need verification context:

```bash
curl -s -H "Authorization: Bearer $ASANA_API_KEY" \
  "https://app.asana.com/api/1.0/tasks/<task_gid>/stories?opt_fields=text,created_by.name,created_at"
```

## Step 2 — pick one and claim it (paired, atomic-ish)

Process tasks sequentially: fully claim+move+verify one before touching the next. The claim is a UUID that we both write into the task and persist locally so we can recognize the task on a later retry.

### Local claim cache

We persist every UUID we generate to `~/.cache/claude-pickup/<task_gid>` (per-machine). This lets us answer one question on a later iteration: *did this machine already claim this task before?* Useful when a task we previously worked on was moved back to Backlog (often with a new comment containing extra info — clarification, re-prioritization, test feedback) and we want to pick it up again rather than walking past it as "already claimed by someone".

### Before claiming, check for prior claims

The block below answers "should I claim this task or skip it?" by inspecting the most recent `agent-claim:` story. Read its `echo` output as your decision signal:

- "Retry detected: …" — re-read comments since the prior claim for new context, then run the **claim + move** block to stamp a fresh UUID.
- "already claimed by another agent" — drop this candidate and try the next one from Step 1.
- No output from the `if` block — no prior claim exists; run the **claim + move** block.

```bash
TASK_GID=<chosen task gid>
CACHE_DIR="$HOME/.cache/claude-pickup"
mkdir -p "$CACHE_DIR"
PRIOR_CLAIM_FILE="$CACHE_DIR/$TASK_GID"

# What's the last claim story on the task (if any)?
LAST_CLAIM=$(curl -s -H "Authorization: Bearer $ASANA_API_KEY" \
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
# claim story wins, which is why verify in step 3 is required.
curl -s -X POST -H "Authorization: Bearer $ASANA_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"data\":{\"text\":\"agent-claim:$AGENT_ID\"}}" \
  "https://app.asana.com/api/1.0/tasks/$TASK_GID/stories"

# Move to In-Progress
curl -s -X POST -H "Authorization: Bearer $ASANA_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"data\":{\"task\":\"$TASK_GID\"}}" \
  "https://app.asana.com/api/1.0/sections/$ASANA_IN_PROGRESS_SECTION_ID/addTask"
```

On a retry, the user has likely added a comment with new info. Read all stories newer than the prior claim and treat them as additional task context before planning:

```bash
# Comments since our previous claim
curl -s -H "Authorization: Bearer $ASANA_API_KEY" \
  "https://app.asana.com/api/1.0/tasks/$TASK_GID/stories?opt_fields=text,created_by.name,created_at" \
  | jq --arg prior "$PRIOR_UUID" \
      '.data | map(select(.text | startswith("agent-claim:") | not)) | .[]'
```

## Step 3 — verify the claim still holds

Re-read the most recent claim story on the task. If it isn't ours, another agent grabbed it between our claim and our move.

```bash
LATEST_CLAIM=$(curl -s -H "Authorization: Bearer $ASANA_API_KEY" \
  "https://app.asana.com/api/1.0/tasks/$TASK_GID/stories?opt_fields=text,created_at" \
  | jq -r '.data | map(select(.text | startswith("agent-claim:"))) | sort_by(.created_at) | last | .text')

if [ "$LATEST_CLAIM" != "agent-claim:$AGENT_ID" ]; then
  echo "Lost claim race for $TASK_GID — backing off."
fi
```

If the echo prints "Lost claim race", another agent grabbed the task between our claim and our verify. Do **not** roll back the section move (the winning agent now owns the task); drop this candidate and pick another from Step 1, or stop if none remain.

If the verify passes (no "Lost claim race" output), this task is yours. Proceed to Step 4.

## Step 4 — start work

1. Create a feature branch off `dev` named `issue-$TASK_GID` — the literal `issue-` prefix followed by the Asana task gid you claimed. Every agent picking up the same task derives the same branch name, which is what lets parallel pickups across machines coordinate (and what lets a human glance at a branch and find the task):
   ```bash
   git checkout dev && git pull
   git checkout -b "issue-$TASK_GID"
   ```
2. Run the `implement-task` skill to drive the work end-to-end. It owns reading the task body, BUG MODE (`/investigate`), PLAN REVIEW (`/autoplan`), the exploration test-scan, RGR execution, and the full gate suite (typecheck / test / e2e / fallow + task-specific verification). Pass `TASK_ID=$TASK_GID`.
3. Open a PR targeting `dev`. Include the Asana task URL (`https://app.asana.com/0/$ASANA_PROJECT_ID/$TASK_GID`) in the PR description so reviewers can jump to the task. The branch hooks will block any attempt to commit/push to `main` or `dev` directly.

## Step 5 — when done

Add a final comment with the PR link, then move the task forward:

```bash
curl -s -X POST -H "Authorization: Bearer $ASANA_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"data\":{\"text\":\"PR opened: <pr-url>\"}}" \
  "https://app.asana.com/api/1.0/tasks/$TASK_GID/stories"

curl -s -X POST -H "Authorization: Bearer $ASANA_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"data\":{\"task\":\"$TASK_GID\"}}" \
  "https://app.asana.com/api/1.0/sections/$ASANA_IN_REVIEW_SECTION_ID/addTask"
```

(`ASANA_IN_REVIEW_SECTION_ID` is in `.env.local.example`. If unset, leave the task in In-Progress and ask the user where it should go.)

## On failure

If anything goes wrong mid-task (build broken, requirements ambiguous, scope blew up), do **not** quietly leave the task in In-Progress, and do **not** move it back to Backlog yourself — re-picking it without new info just leads to the same failure. Move it to Blocked so a human can review, add the missing context, and move it back to Backlog when it's ready for another attempt:

1. Add a story explaining exactly what blocked — what you tried, what failed, the error or ambiguity, and what info you'd need to retry. Be specific; the human reading it should be able to act without spelunking.
2. Move the task to `ASANA_BLOCKED_SECTION_ID`:
   ```bash
   curl -s -X POST -H "Authorization: Bearer $ASANA_API_KEY" \
     -H "Content-Type: application/json" \
     -d "{\"data\":{\"task\":\"$TASK_GID\"}}" \
     "https://app.asana.com/api/1.0/sections/$ASANA_BLOCKED_SECTION_ID/addTask"
   ```
3. Leave the local claim cache file (`~/.cache/claude-pickup/$TASK_GID`) in place. When the human moves the task back to Backlog with new info, the next pickup run will recognize it as a retry (see Step 2) and read the newly-added comments as additional context.
