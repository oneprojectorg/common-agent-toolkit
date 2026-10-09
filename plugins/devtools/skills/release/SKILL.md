---
name: release
description: "Open the dev → main Release PR that lists the PR numbers merged since the last release, prefixing git/gh with CLAUDE_RELEASE=1. Use when asked to cut a release, ship dev to main, or for /release."
---

The plugin hook `hooks/block-protected-branches.sh` blocks `git`/`gh` commands that name `main` or `dev`. The prefix `CLAUDE_RELEASE=1` lets through read-only commands and `gh pr create --base main`. Pushes to `main`/`dev` stay blocked. Use the prefix on every step below, and nowhere else.

## Steps

1. Fetch both branches:
   ```bash
   CLAUDE_RELEASE=1 git fetch origin dev main
   ```
2. List the merges since the last release:
   ```bash
   CLAUDE_RELEASE=1 git log origin/main..origin/dev --merges --first-parent --pretty=format:"%s" --reverse
   ```
3. Take the PR number from each subject (`Merge pull request #NNN from …`).
4. Open the PR:
   ```bash
   CLAUDE_RELEASE=1 gh pr create --base main --head dev --title "Release" --body "$BODY"
   ```

## Rules

- The title is exactly `Release`.
- The body is one bullet per PR, `- #NNN`, oldest first. GitHub expands each reference to its title, so write no titles.
- In common, the project hook `.claude/hooks/block-gh-main.sh` also blocks `git`/`gh` commands that name `main`, and honors the same `CLAUDE_RELEASE=1` marker. If it blocks a marked step (an older checkout without the exception), stop and tell the user. Do not work around it.

## Review checklist

- [ ] Title is `Release`; base `main`, head `dev`
- [ ] Body holds only `- #NNN` lines, one per merged PR since the last release
- [ ] Every git/gh command carried `CLAUDE_RELEASE=1`; nothing was pushed to `main`/`dev`
