#!/bin/bash
# Block git/gh commands that WRITE to the protected branches (main, dev),
# and destructive local operations. Commands that only read main/dev
# (`git grep … origin/dev`, `gh run list --branch dev`, `gh stack init --base dev`)
# are allowed.
#
# Blocked:
#   - commits while HEAD is main/dev: commit, cherry-pick, revert, am, rebase,
#     merge (except --ff-only)
#   - `git push` that names main/dev, uses --all/--mirror, or pushes HEAD
#     while HEAD is main/dev
#   - destructive ops: `reset --hard`, `clean -f`, `branch -D`, `checkout --`
#   - `gh api` writes (-X POST/PUT/PATCH/DELETE, -f/-F/--input) that name main/dev
#   - `gh pr create --base main`, unless prefixed `CLAUDE_RELEASE=1`
#     (the only marker exception)
#
# HEAD is read where the git command runs: the session cwd, then any earlier
# `cd <dir>` in the command, then `git -C <dir>`.
#
# Wired as a PreToolUse hook in hooks.json.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
DIR=$(echo "$INPUT" | jq -r '.cwd // empty')
DIR=${DIR:-${CLAUDE_PROJECT_DIR:-$PWD}}

# A protected branch as a standalone ref token: main, dev, origin/main,
# HEAD:dev, refs/heads/main, main~5, dev^. Not: domain, develop, devops.
PROTECTED='(^|[[:space:]=:/+])(main|dev)([[:space:]=:/.~^@]|$)'
RELEASE_MARKER='(^|[[:space:]])CLAUDE_RELEASE=1([[:space:]=]|$)'
COMMIT_VERBS='(commit|cherry-pick|revert|am|rebase|merge)'

block() {
  echo "BLOCKED: $1" >&2
  exit 2
}

resolve() {
  local path=${1/#\~/$HOME}
  case "$path" in
    /*) echo "$path" ;;
    *) echo "$DIR/$path" ;;
  esac
}

branch_in() {
  git -C "$1" branch --show-current 2>/dev/null
}

if ! echo "$COMMAND" | grep -qE '(^|[^[:alnum:]_-])(git|gh)\s'; then
  exit 0
fi

DESTRUCTIVE='git\s+(reset\s+(--hard|-{1,2}H)|clean\s+(-[a-zA-Z]*f|--force)|branch\s+(-[a-zA-Z]*D)|checkout\s+(--|\.[[:space:]]|\.[[:space:]]*$))'
if echo "$COMMAND" | grep -qE "$DESTRUCTIVE"; then
  block "destructive git operation (reset --hard, clean -f, branch -D, checkout --). Ask the user before running this."
fi

if echo "$COMMAND" | grep -qE 'gh\s+pr\s+create\s+(.*\s)?--base[[:space:]=]main(\s|$)' \
  && ! echo "$COMMAND" | grep -qE "$RELEASE_MARKER"; then
  block "'gh pr create --base main' is only allowed inside the /release flow (prefix with CLAUDE_RELEASE=1)."
fi

# Check each shell segment on its own, so a protected name in one command
# (`gh pr create --base dev`) does not count against another (`git push`).
while IFS= read -r SEGMENT; do
  if [[ "$SEGMENT" =~ ^[[:space:]]*cd[[:space:]]+([^[:space:]]+) ]]; then
    DIR=$(resolve "${BASH_REMATCH[1]}")
    continue
  fi

  # Drop filesystem paths (`~/dev/op/common`, `2>/dev/null`) so a directory
  # named `dev` is not a branch. A ref never starts with `/`, `~/` or `./`.
  REFS=$(echo "$SEGMENT" | sed -E "s#(^|[[:space:]=<>(\"'])(~|\.{1,2})?/[^[:space:]\"')]*#\1#g")

  if [[ "$SEGMENT" =~ ^[[:space:]]*([A-Za-z_]+=[^[:space:]]*[[:space:]]+)*git[[:space:]]+(-C[[:space:]]+([^[:space:]]+)[[:space:]]+)?([a-z-]+)(.*)$ ]]; then
    RUN_DIR=$DIR
    [ -n "${BASH_REMATCH[3]}" ] && RUN_DIR=$(resolve "${BASH_REMATCH[3]}")
    VERB=${BASH_REMATCH[4]}
    REST=${BASH_REMATCH[5]}

    if [[ "$VERB" =~ ^$COMMIT_VERBS$ ]] && ! { [ "$VERB" = "merge" ] && [[ "$REST" =~ --ff-only ]]; }; then
      BRANCH=$(branch_in "$RUN_DIR")
      if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "dev" ]; then
        block "HEAD is '$BRANCH' in $RUN_DIR. 'git $VERB' would add commits to a protected branch. Switch to a feature branch first."
      fi
    fi

    if [ "$VERB" = "push" ]; then
      if echo "$REFS" | grep -qE "$PROTECTED|\s--(all|mirror)(\s|$)"; then
        block "pushing to 'main' or 'dev' is never allowed. Open a PR from a feature branch."
      fi
      # A push with no refspec, or a HEAD refspec, pushes the current branch.
      REFSPECS=$(echo "$REST" | tr -s '[:space:]' '\n' | grep -v '^-' | grep -v '^$' | tail -n +2)
      if [ -z "$REFSPECS" ] || echo "$REFSPECS" | grep -qE '^\+?HEAD(:|$)'; then
        BRANCH=$(branch_in "$RUN_DIR")
        if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "dev" ]; then
          block "HEAD is '$BRANCH', so this push targets a protected branch. Push a feature branch instead."
        fi
      fi
    fi
  fi

  if echo "$SEGMENT" | grep -qE '(^|\s)gh\s+api\s' \
    && echo "$SEGMENT" | grep -qE '(-X|--method)[[:space:]=]*(POST|PUT|PATCH|DELETE)|\s(-f|-F|--field|--raw-field|--input)(\s|=)' \
    && echo "$REFS" | grep -qE "$PROTECTED"; then
    block "'gh api' writes that name 'main' or 'dev' are not allowed."
  fi
done < <(echo "$COMMAND" | sed -E 's/(&&|\|\||;|\|)/\n/g')

exit 0
