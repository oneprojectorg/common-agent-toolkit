---
name: pickup-task
description: Find the next available Agent task on the Asana board — filter Backlog + Type=Agent, then return the chosen task gid for the caller to drive. Use when asked to pick up, claim, or grab a task, when invoking /pickup-task, or when starting work without a specific task URL. Does NOT claim, move, branch, or comment — hand the chosen gid off to `implement-task`, which owns all task mutation.
---

This skill builds on `asana-api` (auth, base URL, endpoint reference). Read that skill first if you don't already know how to call Asana REST.

Scope is intentionally narrow: **find a task and return its gid**. Atomic claim, section moves, branch creation, comments, and PR linkage all live in `implement-task` — that keeps the picker idempotent (running it twice doesn't mutate Asana) and keeps every claim+move under a single owner.

## Required env

- `ASANA_API_KEY`
- `ASANA_PROJECT_ID`
- `ASANA_BACKLOG_SECTION_ID` — section we pull from

If any are unset, stop and ask the user to fill `.env.local`. Do not invent gids.

## The eligibility rules

A task is eligible only if **all** of:

1. It lives in the Backlog section (`ASANA_BACKLOG_SECTION_ID`) of the current sprint.
2. It has the custom field `Type` with value `Agent` (the field is multi-enum; "Agent" must be one of the selected values).
3. It is not already completed (`completed_since=now` filters the listing).

Assignee is **not** part of the filter — any task in Backlog with `Type=Agent` is fair game regardless of who it's assigned to. (We still capture the assignee so `implement-task` can request a PR review from them later.)

## Step 1 — list eligible tasks

**Never write API responses to `/tmp/<fixed-name>`.** That path is shared across sessions and may be sandbox-blocked; a write that silently fails leaves a stale file from a prior run, and the next `jq` step reads stale data and picks a task that has long since moved off the Backlog. Pipe the response straight into `jq`, or use `$TMPDIR` with `mktemp` if you genuinely need a file.

```bash
# Pipe directly to jq — no intermediate file, no stale-data class of bug.
ELIGIBLE_JSON=$(curl -s -H "Authorization: Bearer $ASANA_API_KEY" \
  "https://app.asana.com/api/1.0/sections/$ASANA_BACKLOG_SECTION_ID/tasks?completed_since=now&limit=100&opt_fields=gid,name,notes,assignee.gid,assignee.name,custom_fields.name,custom_fields.multi_enum_values.name,custom_fields.enum_value.name" \
  | jq '[.data[]
      | select(any(.custom_fields[]?;
          .name == "Type"
          and ((.multi_enum_values // [] | any(.name == "Agent"))
               or (.enum_value.name == "Agent"))))
      | {gid, name, assignee}]')

echo "$ELIGIBLE_JSON"
```

Filter the result locally — keep tasks where some `custom_fields[].name === "Type"` and that field's `multi_enum_values[].name` (or `enum_value.name`) contains `"Agent"`. The assignee field is carried through for downstream use, not filtered on.

If you need verification context (e.g. to decide between candidates), pull the stories for a candidate:

```bash
curl -s -H "Authorization: Bearer $ASANA_API_KEY" \
  "https://app.asana.com/api/1.0/tasks/<task_gid>/stories?opt_fields=text,created_by.name,created_at"
```

## Step 2 — pick one, re-verify, and hand off

Choose one eligible task. **Before handing off**, re-fetch the task's memberships and confirm it is still in the Backlog section. The Step 1 listing is a snapshot — between listing and handoff the task can be moved (by another agent, by a human, by an automation), and `implement-task` will then claim and move a task that no longer belongs in Backlog.

```bash
TASK_GID="<chosen_task_gid>"
CURRENT_SECTION=$(curl -s -H "Authorization: Bearer $ASANA_API_KEY" \
  "https://app.asana.com/api/1.0/tasks/$TASK_GID?opt_fields=memberships.project.gid,memberships.section.gid" \
  | jq -r --arg proj "$ASANA_PROJECT_ID" \
      '.data.memberships[] | select(.project.gid == $proj) | .section.gid')

if [ "$CURRENT_SECTION" != "$ASANA_BACKLOG_SECTION_ID" ]; then
  echo "Task $TASK_GID is no longer in Backlog (now in $CURRENT_SECTION) — skipping."
  # Drop this candidate, pick another, or stop if none remain.
fi
```

Only if the re-verify passes do you output the gid and **hand off to `implement-task`** — pass `TASK_ID=<task_gid>`. That skill owns:

- The atomic UUID claim + move to In-Progress.
- Retry detection via the local claim cache.
- Claim-race verification.
- Branch creation off `dev` (`issue-$TASK_ID`).
- Everything downstream: reading the task body, BUG MODE / PLAN REVIEW, RGR, gates, PR open, In-Review move, and on-failure Blocked move.

If no eligible tasks remain (or all candidates fail re-verify), report that to the caller and stop. Do not mutate any task here.
