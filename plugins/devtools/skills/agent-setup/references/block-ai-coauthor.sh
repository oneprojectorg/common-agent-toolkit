#!/bin/bash
# Block git commits whose message contains a `Co-Authored-By:` trailer that
# attributes the commit to an AI / agent / tooling identity.
#
# Wired as a PreToolUse(Bash) hook in ~/.claude/settings.json.
#
# Examples blocked:
#   Co-Authored-By: Claude <noreply@anthropic.com>
#   Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
#   Co-Authored-By: Anthropic <...>
#   Co-Authored-By: Multica <...>
#   Co-Authored-By: <noreply@anthropic.com>
#
# Examples allowed (real humans):
#   Co-Authored-By: Scott Cazan <scottcazan@gmail.com>

set -u

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only inspect git-commit-ish commands. Allow non-commit work through unchanged.
# Match `git ... commit` permissively so `git -c user.name=x commit`,
# `git -C path commit`, `git commit --amend`, etc. all qualify.
if ! echo "$COMMAND" | grep -qE '(^|[[:space:]|&;(])git[[:space:]]+([^[:space:]]+[[:space:]]+)*commit([[:space:]]|$)'; then
  exit 0
fi

# Pattern: any `Co-Authored-By:` line whose name OR email mentions one of the
# banned identities. Match is case-insensitive (grep -i). We only care about
# the Co-Authored-By trailer — the commit author (set by git config) is
# unaffected.
BANNED='Co-Authored-By:[^\n]*(claude|anthropic|noreply@anthropic|multica|multico|gpt|openai|codex|"the agent")'

if echo "$COMMAND" | grep -qiE "$BANNED"; then
  cat >&2 <<'MSG'
BLOCKED: this commit message includes a Co-Authored-By: trailer that
attributes the commit to an AI / tool identity (Claude, Anthropic, Multica,
GPT, etc.). The commit author is the configured git user; the only allowed
Co-Authored-By: trailer is the human owner of the work (the Asana
assignee's GitHub identity — e.g. `Scott Cazan <scottcazan@gmail.com>`).

Remove the AI/tool Co-Authored-By: line and retry the commit. If you do not
know the human owner's commit email, ask the user before committing rather
than guessing or falling back to noreply@anthropic.com.
MSG
  exit 2
fi

exit 0
