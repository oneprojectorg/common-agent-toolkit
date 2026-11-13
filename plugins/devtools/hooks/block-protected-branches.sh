#!/bin/bash
# Block git/gh commands that WRITE to the protected branches (main, dev),
# and destructive local operations. Commands that only read main/dev
# (`git grep … origin/dev`, `gh run list --branch dev`, `gh stack init --base dev`)
# are allowed. This hook is an early warning for agents; GitHub branch
# protection is the real guard, so the hook prefers a missed write over
# blocking normal work.
#
# Blocked:
#   - commits while HEAD is main/dev: commit, cherry-pick, revert, am, rebase,
#     merge (except --ff-only, and --abort/--continue/--skip/--quit/--help)
#   - `git push` whose target is main/dev, `--all`/`--mirror`, or a push of
#     HEAD while HEAD is main/dev
#   - destructive ops: `reset --hard`, `clean -f`, `branch -D`, `checkout --`
#   - `gh api` writes (-X POST/PUT/PATCH/DELETE, -f/-F/--input) that name main/dev
#   - `gh pr create|edit --base main` and `gh pr merge` of a PR into main,
#     unless prefixed `CLAUDE_RELEASE=1` (the /release flow)
#
# Text in quotes and after `#` is ignored, so a commit message or PR body that
# mentions main or `reset --hard` does not count. HEAD is read where the git
# command runs: the session cwd, then any earlier `cd <dir>`, then `git -C <dir>`.
#
# Wired as a PreToolUse hook in hooks.json.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
DIR=$(echo "$INPUT" | jq -r '.cwd // empty')
DIR=${DIR:-${CLAUDE_PROJECT_DIR:-$PWD}}

PROTECTED='(^|[[:space:]=:/+])(main|dev)([[:space:]=:/.~^@]|$)'
RELEASE_MARKER='(^|[[:space:]])CLAUDE_RELEASE=1([[:space:]=]|$)'
COMMIT_VERBS='^(commit|cherry-pick|revert|am|rebase|merge)$'
# git, optional env prefixes, then global options (-c k=v, -C dir, --no-pager)
# before the verb.
GIT_RE='^[[:space:]]*([A-Za-z_]+=[^[:space:]]*[[:space:]]+)*git(([[:space:]]+(-c|-C)[[:space:]]+[^[:space:]]+|[[:space:]]+--[a-z-]+(=[^[:space:]]*)?)*)[[:space:]]+([a-z-]+)(.*)$'

block() {
  echo "BLOCKED: $1" >&2
  exit 2
}

resolve() {
  local path=${1//\"/}
  path=${path//\'/}
  path=${path/#\~/$HOME}
  case "$path" in
    /*) echo "$path" ;;
    *) echo "$DIR/$path" ;;
  esac
}

is_protected() {
  [ "$1" = "main" ] || [ "$1" = "dev" ]
}

has_marker() {
  echo "$COMMAND" | grep -qE "$RELEASE_MARKER"
}

if ! echo "$COMMAND" | grep -qE '(^|[^[:alnum:]_-])(git|gh)\s'; then
  exit 0
fi

# Empty every quoted string (except the directory after `cd` or `-C`) and drop
# `#` comments.
SCAN=$(printf '%s' "$COMMAND" | perl -0777 -pe '
  s/(?<!cd )(?<!-C )"(?:[^"\\]|\\.)*"/""/g;
  s/(?<!cd )(?<!-C )\x27[^\x27]*\x27/\x27\x27/g;
  s/(^|[ \t])#[^\n]*/$1/mg;
')

DESTRUCTIVE='git\s+(reset\s+(--hard|-{1,2}H)|clean\s+(-[a-zA-Z]*f|--force)|branch\s+(-[a-zA-Z]*D)|checkout\s+(--|\.[[:space:]]|\.[[:space:]]*$))'
if echo "$SCAN" | grep -qE "$DESTRUCTIVE"; then
  block "destructive git operation (reset --hard, clean -f, branch -D, checkout --). Ask the user before running this."
fi

if echo "$SCAN" | grep -qE 'gh\s+pr\s+(create|edit)\s+(.*\s)?(--base|-B)[[:space:]=]main(\s|$)' && ! has_marker; then
  block "a PR with base 'main' is only allowed inside the /release flow (prefix with CLAUDE_RELEASE=1)."
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

  if [[ "$SEGMENT" =~ $GIT_RE ]]; then
    GLOBAL_OPTS=${BASH_REMATCH[2]}
    VERB=${BASH_REMATCH[6]}
    REST=${BASH_REMATCH[7]}
    RUN_DIR=$DIR
    if [[ "$GLOBAL_OPTS" =~ -C[[:space:]]+([^[:space:]]+) ]]; then
      RUN_DIR=$(resolve "${BASH_REMATCH[1]}")
    fi

    if [[ "$VERB" =~ $COMMIT_VERBS ]] \
      && ! [[ "$REST" =~ (^|[[:space:]])--(abort|continue|skip|quit|help)([[:space:]]|$) ]] \
      && ! { [ "$VERB" = "merge" ] && [[ "$REST" =~ --ff-only ]]; }; then
      BRANCH=$(git -C "$RUN_DIR" branch --show-current 2>/dev/null)
      if is_protected "$BRANCH"; then
        block "HEAD is '$BRANCH' in $RUN_DIR. 'git $VERB' would add commits to a protected branch. Switch to a feature branch first."
      fi
    fi

    if [ "$VERB" = "push" ]; then
      if [[ "$REST" =~ (^|[[:space:]])--(all|mirror)([[:space:]]|$) ]]; then
        block "'git push --all/--mirror' would push 'main' or 'dev'. Push a feature branch instead."
      fi
      # Arguments without flags: the remote, then the refspecs.
      read -r -a ARGS <<<"$(echo "$REST" | tr -s '[:space:]' '\n' | grep -v '^-' | grep -v '^$' | tr '\n' ' ')"
      PUSHES_HEAD=0
      [ "${#ARGS[@]}" -le 1 ] && PUSHES_HEAD=1
      for REFSPEC in "${ARGS[@]:1}"; do
        REFSPEC=${REFSPEC#+}
        TARGET=${REFSPEC##*:}
        TARGET=${TARGET#refs/heads/}
        if is_protected "$TARGET"; then
          block "pushing to '$TARGET' is never allowed. Open a PR from a feature branch."
        fi
        if [[ "$REFSPEC" =~ ^(HEAD|@)$ ]]; then
          PUSHES_HEAD=1
        fi
      done
      if [ "$PUSHES_HEAD" = 1 ]; then
        BRANCH=$(git -C "$RUN_DIR" branch --show-current 2>/dev/null)
        if is_protected "$BRANCH"; then
          block "HEAD is '$BRANCH', so this push targets a protected branch. Push a feature branch instead."
        fi
      fi
    fi
  fi

  if [[ "$SEGMENT" =~ (^|[[:space:]])gh[[:space:]]+pr[[:space:]]+merge([[:space:]]+(.*))?$ ]] && ! has_marker; then
    PR=$(echo "${BASH_REMATCH[3]}" | tr -s '[:space:]' '\n' | grep -v '^-' | grep -v '^$' | head -1)
    BASE=$(cd "$DIR" 2>/dev/null && gh pr view $PR --json baseRefName -q .baseRefName 2>/dev/null)
    if [ "$BASE" = "main" ]; then
      block "merging a PR into 'main' is only allowed inside the /release flow."
    fi
  fi

  if echo "$SEGMENT" | grep -qE '(^|\s)gh\s+api\s' \
    && echo "$SEGMENT" | grep -qE '(-X|--method)[[:space:]=]*(POST|PUT|PATCH|DELETE)|\s(-f|-F|--field|--raw-field|--input)(\s|=)' \
    && echo "$REFS" | grep -qE "$PROTECTED"; then
    block "'gh api' writes that name 'main' or 'dev' are not allowed."
  fi
done < <(echo "$SCAN" | sed -E 's/(&&|\|\||;|\|)/\n/g')

exit 0
