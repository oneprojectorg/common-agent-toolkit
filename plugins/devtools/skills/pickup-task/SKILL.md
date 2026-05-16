---
name: pickup-task
description: Find the next available Agent task on the Asana board — filter Backlog + Type=Agent + assigned to me, then return the chosen task gid for the caller to drive. Use when asked to pick up, claim, or grab a task, when invoking /pickup-task, or when starting work without a specific task URL. Does NOT claim, move, branch, or comment — hand the chosen gid off to `implement-task`, which owns all task mutation.
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

If you need verification context (e.g. to decide between candidates), pull the stories for a candidate:

```bash
curl -s -H "Authorization: Bearer $ASANA_API_KEY" \
  "https://app.asana.com/api/1.0/tasks/<task_gid>/stories?opt_fields=text,created_by.name,created_at"
```

## Step 2 — pick one and hand off

Choose one eligible task. Output its gid (and title, for human-readable confirmation) and **hand off to `implement-task`** — pass `TASK_ID=<task_gid>`. That skill owns:

- The atomic UUID claim + move to In-Progress.
- Retry detection via the local claim cache.
- Claim-race verification.
- Branch creation off `dev` (`issue-$TASK_ID`).
- Everything downstream: reading the task body, BUG MODE / PLAN REVIEW, RGR, gates, PR open, In-Review move, and on-failure Blocked move.

If no eligible tasks remain, report that to the caller and stop. Do not mutate any task here.
