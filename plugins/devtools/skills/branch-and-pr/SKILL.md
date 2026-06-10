---
name: branch-and-pr
description: Branching and PR workflow — feature branches off dev with issue-<task_gid> naming, conventional commits, and gh pr create --base dev. Use before any commit or push, when opening a PR, or when asked about branch names, rebasing, or merging dev.
---

## Rules

- **Never commit directly to `main` or `dev`.** Both are protected by the plugin hooks (`block-protected-branches.sh`, `require-feature-branch.sh`).
- All work happens on a feature branch off `dev`. Naming: `issue-<task_gid>` — the literal `issue-` prefix plus the Asana task gid. Single convention for humans and agents alike. Two reasons it's a hard rule:
  1. Anyone (or any agent) opening a branch for the same task derives the same name, so parallel pickups coordinate instead of forking.
  2. Reviewers can map a branch back to its task at a glance without grepping the PR description.
  If there genuinely isn't an Asana task, create one first — that's the entry point for any non-trivial change.
- Open a pull request targeting `dev`, **always in draft mode** (`gh pr create --draft --base dev`). The author marks it ready for review when they're satisfied; agents never open a PR straight to "ready". Releases from `dev` to `main` go through `/release`.

## Workflow

1. `git fetch origin dev && git checkout -b "issue-$TASK_GID" origin/dev` — always base the branch explicitly on `origin/dev`. A bare `git checkout -b` branches from the current HEAD (stacking the new task on whatever was checked out last), and `git checkout dev` itself is hook-blocked.
2. Make edits. **Before every `git commit`, run `pnpm format`** — no exceptions, including plan commits and one-line fixes. Then commit with a conventional message: `feat(scope): summary`, `fix(scope): summary`, `refactor(...)`.
3. Push the feature branch: `git push -u origin "issue-$TASK_GID"`.
4. Open the PR with `gh pr create --draft --base dev`. If the task has an Asana assignee that maps to a valid GitHub user (`scazan` / `valentin0h` / `nourmalaeb`), set it as the PR assignee with `gh pr edit --add-assignee <login>` — see `implement-task` Step 8 for the mapping.
5. Never `git push --force` to a shared branch unless you are rebasing. If you must rewrite history, do it on your own feature branch only.

## What hooks block

The pre-tool hooks in `.claude/hooks/` will refuse:
- Pushing to `main` or `dev` (incl. `--force` / `--force-with-lease`).
- Destructive ops: `git reset --hard`, `git clean -f`, `git branch -D`, `git checkout -- <path>`.
- Switching HEAD onto `main`/`dev` (`git checkout dev`, `git switch main`).
- `gh pr create --base main` outside the `/release` flow.
- Anything else that names `main`/`dev` and isn't on the read-only/sync allowlist (`gh api .../branches/dev/...`, etc.).
- Commits while currently on `main` or `dev` (separate hook).

What's **allowed** without any marker:
- Creating a new branch from a protected ref: `git checkout -b <branch> origin/dev` / `git switch -c <branch> origin/dev`.
- Read-only and local-sync git verbs against protected refs: `git fetch origin dev`, `git rebase origin/dev`, `git merge origin/dev`, `git pull origin dev`, `git diff origin/main..HEAD`, `git log main..feature`, `git show origin/dev:path`. The standard "keep my feature branch in sync with dev" flow just works.
- `git push --force` / `--force-with-lease` to **feature** branches — needed after a rebase.
- `gh pr create --base dev` — the normal feature → dev PR.

## The one exception: `/release`

The release command opens the dev → main PR. It works by prefixing its git/gh calls with `CLAUDE_RELEASE=1`, which the protected-branch hook reads as "allow read-only inspection of dev/main and the `gh pr create --base main --head dev` call." Pushes to `main`/`dev` are still rejected even under the marker.

Don't use `CLAUDE_RELEASE=1` outside of `/release`. If you find yourself reaching for it, you're routing around the policy.

If you hit a block, switch to a feature branch — don't try to bypass it.
