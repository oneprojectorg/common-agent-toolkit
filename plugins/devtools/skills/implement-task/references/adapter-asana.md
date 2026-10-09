# Asana adapter

Used when the input is an Asana task gid or an `app.asana.com` URL. Endpoints, auth and URL parsing: see the `asana-api` skill. All snippets set `A="Authorization: Bearer $ASANA_PERSONAL_ACCESS_TOKEN"` and `API=https://app.asana.com/api/1.0`.

## Env

`ASANA_PERSONAL_ACCESS_TOKEN`, `ASANA_PROJECT_ID`, `ASANA_IN_PROGRESS_SECTION_ID`, `ASANA_IN_REVIEW_SECTION_ID`, `ASANA_BLOCKED_SECTION_ID`. They come from the user's shell env or `~/.claude/settings.json` `env` — never from common's `.env.local`. If one is unset, stop and ask the user to set it there. Do not invent gids.

## Fetch

```bash
curl -s -H "$A" "$API/tasks/$TASK_GID?opt_fields=name,notes,assignee.name,custom_fields,memberships.section.name"
curl -s -H "$A" "$API/tasks/$TASK_GID/stories?opt_fields=text,created_by.name,created_at"
```

Verification steps: `## Verification`, "Verify by:", "Acceptance criteria", or any demarcated list of concrete steps in `notes` or recent stories. If `notes` links a parent PRD, fetch that too. Source URL for the PR body: `https://app.asana.com/0/$ASANA_PROJECT_ID/$TASK_GID`.

## Claim

The claim is a UUID written to the task as an `agent-claim:<uuid>` story and cached in `~/.cache/claude-pickup/<gid>`, so this machine can recognize its own earlier claim when a task returns to Backlog with new context.

**1. Check prior claims.**

```bash
CACHE="$HOME/.cache/claude-pickup/$TASK_GID"; mkdir -p "$(dirname "$CACHE")"
last_claim() {
  curl -s -H "$A" "$API/tasks/$TASK_GID/stories?opt_fields=text,created_at" \
    | jq -r '.data | map(select(.text | startswith("agent-claim:"))) | sort_by(.created_at) | last | .text // empty'
}
LAST=$(last_claim)
if [ -n "$LAST" ]; then
  if [ -f "$CACHE" ] && [ "$(cat "$CACHE")" = "${LAST#agent-claim:}" ]; then
    echo "Retry detected: this machine previously claimed $TASK_GID."
  else
    echo "Task $TASK_GID is already claimed by another agent (${LAST#agent-claim:})."
  fi
fi
```

- "Retry detected" → read every non-claim story newer than the prior claim as extra task context, then claim.
- "already claimed by another agent" → stop; the caller picks another task.
- No output → claim.

**2. Claim and move to In-Progress.** Stories are append-only, so parallel agents can't overwrite each other, but the last claim wins — hence step 3.

```bash
AGENT_ID=$(uuidgen); echo "$AGENT_ID" > "$CACHE"
curl -s -X POST -H "$A" -H "Content-Type: application/json" \
  -d "{\"data\":{\"text\":\"agent-claim:$AGENT_ID\"}}" "$API/tasks/$TASK_GID/stories"
curl -s -X POST -H "$A" -H "Content-Type: application/json" \
  -d "{\"data\":{\"task\":\"$TASK_GID\"}}" "$API/sections/$ASANA_IN_PROGRESS_SECTION_ID/addTask"
```

**3. Verify the claim holds.**

```bash
[ "$(last_claim)" = "agent-claim:$AGENT_ID" ] || echo "Lost claim race for $TASK_GID — backing off."
```

On "Lost claim race": do not roll back the section move (the winner owns the task). Stop and report. Do not branch.

## Branch

`issue-$TASK_GID`. Every agent derives the same name, which lets parallel pickups coordinate.

## Comment

```bash
curl -s -X POST -H "$A" -H "Content-Type: application/json" \
  -d "$(jq -n --arg t "$TEXT" '{data:{text:$t}}')" "$API/tasks/$TASK_GID/stories"
```

## Transitions

Move with `POST $API/sections/<section>/addTask` and body `{"data":{"task":"<gid>"}}`.

| State | Section | When |
|---|---|---|
| in_progress | `ASANA_IN_PROGRESS_SECTION_ID` | on claim |
| in_review | `ASANA_IN_REVIEW_SECTION_ID` | draft PR open (if unset, stay in In-Progress and ask the user) |
| blocked | `ASANA_BLOCKED_SECTION_ID` | any failure; never move back to Backlog yourself |

## Hand-off (PR open)

1. Set the PR assignee from the Asana assignee's first name; skip if it doesn't map. Don't guess.

```bash
NAME=$(curl -s -H "$A" "$API/tasks/$TASK_GID?opt_fields=assignee.name" | jq -r '.data.assignee.name // empty')
case "$(echo "$NAME" | tr '[:upper:]' '[:lower:]')" in
  scott*) GH=scazan ;; valentin*) GH=valentin0h ;; nour*) GH=nourmalaeb ;; *) GH= ;;
esac
[ -n "$GH" ] && gh pr edit --add-assignee "$GH"
```

2. Comment `PR opened: <pr-url>`, then transition to in_review.

## On failure

1. Comment exactly what blocked: what you tried, what failed, the error or ambiguity, and what info a retry needs. The reader must be able to act without digging.
2. Transition to blocked.
3. Keep `~/.cache/claude-pickup/$TASK_GID`, so the next pickup sees a retry and reads the new comments.
4. Do not close the task.
