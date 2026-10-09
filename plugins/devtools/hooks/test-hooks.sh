#!/usr/bin/env bash
# Table tests for the PreToolUse hooks: each case feeds a Bash command to the
# hook and checks the exit code (0 = allowed, 2 = blocked).
#
# Usage: bash plugins/devtools/hooks/test-hooks.sh

HOOKS="$(cd "$(dirname "$0")" && pwd)"
failures=0

check() {
  local want=$1 hook=$2 command=$3
  printf '%s' "$command" | jq -Rs '{tool_input: {command: .}}' | bash "$HOOKS/$hook" >/dev/null 2>&1
  local got=$?
  if [ "$got" != "$want" ]; then
    echo "FAIL ($hook) want $want got $got :: $command"
    failures=$((failures + 1))
  fi
}

B=block-protected-branches.sh

# A directory named `dev` is a path, not the branch.
check 0 $B 'cd ~/dev/op/common && git worktree list'
check 0 $B 'git -C /Users/me/dev/op/common ls-files 2>/dev/null'
check 0 $B 'git status > ./dev/out.txt'
check 0 $B 'cd /tmp/dev && git log --oneline -1'

# Refs to the protected branches are still caught.
check 2 $B 'git push origin dev'
check 2 $B 'git push origin HEAD:dev'
check 2 $B 'cd /tmp/dev && git push origin main'
check 2 $B 'git checkout dev'
check 2 $B 'gh api repos/org/repo/branches/main'
check 2 $B 'git worktree add ../x origin/dev'
check 2 $B 'gh pr create --base main'

# Allowed shapes.
check 0 $B 'CLAUDE_RELEASE=1 gh pr create --base main --head dev'
check 0 $B 'gh pr create --draft --base dev'
check 0 $B 'git diff origin/main..HEAD'
check 0 $B 'git fetch origin dev'
check 0 $B 'git checkout -b issue-123 origin/dev'

# Destructive ops are always blocked.
check 2 $B 'git reset --hard'
check 2 $B 'git clean -fd'

if [ "$failures" -gt 0 ]; then
  echo "$failures failure(s)"
  exit 1
fi
echo "all hook cases pass"
