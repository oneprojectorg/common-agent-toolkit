---
name: pickup-task
description: Pick the next Asana task (Backlog + Type=Agent), re-verify it is still in Backlog, and hand TASK_ID to implement-task; no mutation. Use when asked to pick up, grab or claim the next task, for /pickup-task, or when starting without a task URL.
---

Find one eligible task and hand its gid to `implement-task`. This skill never mutates Asana: no claim, move, comment or branch. Running it twice changes nothing. `implement-task` owns everything after the hand-off.

Endpoints, auth and pagination: `asana-api`.

## Env

`ASANA_PERSONAL_ACCESS_TOKEN`, `ASANA_PROJECT_ID`, `ASANA_BACKLOG_SECTION_ID`. They come from the user's shell env or `~/.claude/settings.json` `env`. If one is unset, stop and ask the user to set it there. Do not invent gids.

## Eligible means all of

1. In the Backlog section (`ASANA_BACKLOG_SECTION_ID`).
2. Custom field `Type` includes `Agent` (multi-enum; also accept a single-enum `Agent`).
3. Not completed (`completed_since=now`).

Assignee is not a filter. It is carried through for the PR assignee later.

## Step 1 — List

Pipe straight into `jq`. Never write responses to a fixed `/tmp/<name>`: a silently failed write leaves a stale file from a prior run, and you pick a task that already left Backlog. Use `mktemp` if you need a file.

```bash
curl -s -H "Authorization: Bearer $ASANA_PERSONAL_ACCESS_TOKEN" \
  "https://app.asana.com/api/1.0/sections/$ASANA_BACKLOG_SECTION_ID/tasks?completed_since=now&limit=100&opt_fields=gid,name,assignee.name,custom_fields.name,custom_fields.multi_enum_values.name,custom_fields.enum_value.name" \
  | jq '[.data[]
      | select(any(.custom_fields[]?; .name == "Type"
          and ((.multi_enum_values // [] | any(.name == "Agent")) or (.enum_value.name == "Agent"))))
      | {gid, name, assignee}]'
```

To choose between candidates, read their stories (`asana-api`, "Read task comments").

## Step 2 — Re-verify, then hand off

The listing is a snapshot. Before handing off, confirm the chosen task is still in Backlog:

```bash
TASK_GID=<chosen gid>
CURRENT=$(curl -s -H "Authorization: Bearer $ASANA_PERSONAL_ACCESS_TOKEN" \
  "https://app.asana.com/api/1.0/tasks/$TASK_GID?opt_fields=memberships.project.gid,memberships.section.gid" \
  | jq -r --arg p "$ASANA_PROJECT_ID" '.data.memberships[] | select(.project.gid == $p) | .section.gid')
[ "$CURRENT" = "$ASANA_BACKLOG_SECTION_ID" ] || echo "Task $TASK_GID left Backlog (now $CURRENT) — skipping."
```

- Still in Backlog → hand off: invoke `implement-task` with `TASK_ID=<gid>`.
- Moved → drop it and try the next candidate.
- None left → report that and stop.
