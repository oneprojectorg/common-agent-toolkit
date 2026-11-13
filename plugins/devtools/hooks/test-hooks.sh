#!/usr/bin/env bash
# Table tests for the PreToolUse hooks: each case feeds a Bash command (and the
# session cwd) to the hook and checks the exit code (0 = allowed, 2 = blocked).
#
# Usage: bash plugins/devtools/hooks/test-hooks.sh

HOOKS="$(cd "$(dirname "$0")" && pwd)"
failures=0

# Two scratch repos: one with HEAD on dev, one on a feature branch.
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
for b in dev feature; do
  git init -q -b "$b" "$TMP/$b"
  git -C "$TMP/$b" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
done
ON_DEV="$TMP/dev"
ON_FEATURE="$TMP/feature"

check() {
  local want=$1 hook=$2 cwd=$3 command=$4
  printf '%s' "$command" | jq -Rs --arg cwd "$cwd" '{cwd: $cwd, tool_input: {command: .}}' \
    | bash "$HOOKS/$hook" >/dev/null 2>&1
  local got=$?
  if [ "$got" != "$want" ]; then
    echo "FAIL ($hook, cwd $(basename "$cwd")) want $want got $got :: $command"
    failures=$((failures + 1))
  fi
}

B=block-protected-branches.sh

# Read-only commands are allowed, even when they name dev/main or a dev path.
check 0 $B "$ON_DEV" 'git grep "createProposal" 2>/dev/null'
check 0 $B "$ON_DEV" 'git grep -n "foo" origin/dev -- packages'
check 0 $B "$ON_DEV" 'cd ~/dev/op/common && git worktree list'
check 0 $B "$ON_DEV" 'git -C /Users/me/dev/op/common ls-files 2>/dev/null'
check 0 $B "$ON_DEV" 'git ls-tree --name-only origin/dev docs/adr/'
check 0 $B "$ON_DEV" 'git archive origin/dev apps/app | tar -x -C /tmp/x'
check 0 $B "$ON_DEV" 'gh pr view 2531'
check 0 $B "$ON_DEV" 'gh run list --branch dev --limit 12'
check 0 $B "$ON_DEV" 'gh stack init --base dev a b c'
check 0 $B "$ON_DEV" 'gh api repos/org/repo/branches/dev/protection --jq .url'
check 0 $B "$ON_DEV" "gh api 'repos/org/repo/compare/dev...feat/x' --jq .ahead_by"
check 0 $B "$ON_DEV" 'git checkout dev'
check 0 $B "$ON_DEV" 'git worktree add -b feat/x ../x origin/dev'
check 0 $B "$ON_DEV" 'git fetch origin dev'
check 0 $B "$ON_DEV" 'git diff origin/main..HEAD'
check 0 $B "$ON_FEATURE" 'git rebase origin/dev'
check 0 $B "$ON_FEATURE" 'git checkout -b issue-123 origin/dev'

# Pushes to dev/main are blocked: by name, by --all/--mirror, or by HEAD on dev.
check 2 $B "$ON_FEATURE" 'git push origin dev'
check 2 $B "$ON_FEATURE" 'git push origin HEAD:dev'
check 2 $B "$ON_FEATURE" 'git push --force origin +feat:main'
check 2 $B "$ON_FEATURE" 'cd /tmp/dev && git push origin main'
check 2 $B "$ON_FEATURE" 'git push --all origin'
check 2 $B "$ON_DEV" 'git push'
check 2 $B "$ON_DEV" 'git push origin HEAD'

# Pushes of feature branches are allowed, also next to a command that names dev.
check 0 $B "$ON_FEATURE" 'git push'
check 0 $B "$ON_FEATURE" 'git push -u origin feat/x'
check 0 $B "$ON_DEV" 'git push -u origin feat/x'
check 0 $B "$ON_FEATURE" 'git push -u origin feat/x && gh pr create --draft --base dev'

# The release PR needs the marker.
check 2 $B "$ON_DEV" 'gh pr create --base main'
check 0 $B "$ON_DEV" 'CLAUDE_RELEASE=1 gh pr create --base main --head dev'
check 0 $B "$ON_FEATURE" 'gh pr create --draft --base dev'

# gh api writes that name dev/main are blocked.
check 2 $B "$ON_DEV" 'gh api -X DELETE repos/org/repo/branches/main/protection'
check 2 $B "$ON_DEV" 'gh api repos/org/repo/git/refs/heads/dev -f sha=abc'

# Destructive ops are always blocked.
check 2 $B "$ON_FEATURE" 'git reset --hard'
check 2 $B "$ON_FEATURE" 'git clean -fd'

# Commits are blocked while HEAD is dev, wherever the git command runs.
check 2 $B "$ON_DEV" 'git commit -m "fix"'
check 2 $B "$ON_DEV" 'git add . && git commit -m "fix; done"'
check 2 $B "$ON_DEV" 'git cherry-pick abc123'
check 2 $B "$ON_DEV" 'git merge feat/x'
check 2 $B "$ON_FEATURE" "cd $ON_DEV && git commit -m fix"
check 2 $B "$ON_FEATURE" "git -C $ON_DEV commit -m fix"

# Commits on a feature branch, and a fast-forward of dev, are allowed.
check 0 $B "$ON_FEATURE" 'git commit -m "fix"'
check 0 $B "$ON_DEV" "cd $ON_FEATURE && git commit -m fix"
check 0 $B "$ON_DEV" "git -C $ON_FEATURE commit -m fix"
check 0 $B "$ON_DEV" 'git merge --ff-only origin/dev'
check 0 $B "$ON_DEV" 'git log --grep commit'
check 0 $B "$ON_DEV" 'git pull'

if [ "$failures" -gt 0 ]; then
  echo "$failures failure(s)"
  exit 1
fi
echo "all hook cases pass"
