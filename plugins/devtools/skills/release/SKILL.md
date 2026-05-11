---
name: release
description: Open the dev → main release PR. The protected-branch hook normally blocks any git/gh command targeting main or dev; this flow is the single exception, gated by the CLAUDE_RELEASE=1 marker. Triggers when the user says "cut a release", invokes /release, or asks to ship dev to main. Trigger phrases — "cut a release", "release PR", "ship to main", "ship dev to main", "dev to main", "/release", "merge to main", "promote to main", "release branch".
---

# Create a release PR

Open a pull request from `dev` to `main` that lists every PR merged since the last release.

The protected-branch hook (`.claude/hooks/block-protected-branches.sh`) refuses any `git`/`gh` command that touches `main` or `dev`. **This skill is the only exception**: prefixing a command with `CLAUDE_RELEASE=1` tells the hook to allow read-only inspection of those branches and the `gh pr create --base main --head dev` call. Pushes to `main`/`dev` remain blocked under the marker.

Every git/gh command in the steps below uses that prefix. Don't drop it.

## Steps

1. Make sure dev is up to date and confirm the remote:
   ```bash
   CLAUDE_RELEASE=1 git fetch origin dev
   CLAUDE_RELEASE=1 git remote get-url origin
   ```

2. Get the list of PRs merged into dev since the last release to main:
   ```bash
   CLAUDE_RELEASE=1 git log origin/main..origin/dev --merges --first-parent --pretty=format:"%s" --reverse
   ```

3. Parse the merge commit messages to extract PR numbers. Merge commits typically look like:
   - `Merge pull request #XXX from ...`
   - Or the PR title if squash merged

4. Build the PR body with each PR number as a bulleted list item:
   - Format: `- #XXX`
   - GitHub will automatically expand the PR reference to show the title
   - Extract PR numbers from merge commits

5. Create the PR using gh CLI (note the marker prefix):
   ```bash
   CLAUDE_RELEASE=1 gh pr create --base main --head dev --title "Release" --body "$BODY"
   ```

## Rules

- PR title must be exactly `Release`
- Each line in the body is a bullet starting with `- #`
- GitHub auto-expands PR references (e.g. `#800`) to the full title, so don't include the title yourself
- Example body:
  ```
  - #800
  - #805
  - #802
  ```
- The `CLAUDE_RELEASE=1` marker is **only** valid for this dev → main PR-creation flow. Don't reuse it elsewhere; the hook still blocks pushes to `main`/`dev` regardless.
