---
name: asana-api
description: Asana REST via $ASANA_PERSONAL_ACCESS_TOKEN and $ASANA_PROJECT_ID — read a task, stories and custom fields, comment, move sections, parse app.asana.com URLs. Use when a skill or script reads or writes Asana instead of using the Asana MCP.
---

Skill-driven flows (`pickup-task`, the `implement-task` Asana adapter) use REST, not the Asana MCP: the env vars pin the account, project and sections, and there is no MCP auth to set up. The MCP is fine for ad-hoc exploration.

## Auth

- Env: `ASANA_PERSONAL_ACCESS_TOKEN` (personal access token), `ASANA_PROJECT_ID` (team project gid). They come from the user's shell env or `~/.claude/settings.json` `env`, not from a repo `.env.local`. If one is unset, ask the user to set it there. Do not invent a value.
- Header: `Authorization: Bearer $ASANA_PERSONAL_ACCESS_TOKEN`
- Base URL: `https://app.asana.com/api/1.0`
- Request only the fields you need with `opt_fields`. Pipe responses into `jq`; don't write them to fixed `/tmp` paths.

Below, `A="Authorization: Bearer $ASANA_PERSONAL_ACCESS_TOKEN"`, `API=https://app.asana.com/api/1.0`, and `J="Content-Type: application/json"`.

## Read

```bash
# Open tasks in the project
curl -s -H "$A" "$API/projects/$ASANA_PROJECT_ID/tasks?completed_since=now&opt_fields=name,assignee.name,due_on,memberships.section.name"
# Open tasks in one section
curl -s -H "$A" "$API/sections/<section_gid>/tasks?completed_since=now&opt_fields=name,custom_fields.name,custom_fields.multi_enum_values.name"
# One task
curl -s -H "$A" "$API/tasks/<task_gid>?opt_fields=name,notes,assignee.name,custom_fields,memberships.section.name"
# Task comments / activity
curl -s -H "$A" "$API/tasks/<task_gid>/stories?opt_fields=text,created_by.name,created_at"
```

## Write

```bash
# Comment (story)
curl -s -X POST -H "$A" -H "$J" -d '{"data":{"text":"<text>"}}' "$API/tasks/<task_gid>/stories"
# Move to a section
curl -s -X POST -H "$A" -H "$J" -d '{"data":{"task":"<task_gid>"}}' "$API/sections/<section_gid>/addTask"
# Update (complete, assignee, ...)
curl -s -X PUT -H "$A" -H "$J" -d '{"data":{"completed":true}}' "$API/tasks/<task_gid>"
# Create in the project
curl -s -X POST -H "$A" -H "$J" \
  -d "{\"data\":{\"name\":\"<title>\",\"notes\":\"<body>\",\"projects\":[\"$ASANA_PROJECT_ID\"]}}" "$API/tasks"
```

Build JSON bodies with `jq -n --arg` when the text has quotes or newlines.

## Task URLs

- `https://app.asana.com/0/<project_gid>/<task_gid>`
- `https://app.asana.com/1/<workspace>/project/<project>/task/<task_gid>`

Take the trailing `<task_gid>` (strip any `/f` or query string) and `GET /tasks/<task_gid>`.

## Pagination and rate limits

- `?limit=100`, then pass `offset=<next_page.offset>` from the response until `next_page` is null.
- About 150 requests/min per token. On 429, wait `Retry-After` seconds and retry.
