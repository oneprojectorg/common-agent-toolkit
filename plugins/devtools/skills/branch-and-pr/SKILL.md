---
name: branch-and-pr
description: Branching and PR workflow — feature branches off dev with issue-<task_gid> naming, conventional commits, and gh pr create --base dev. Stack only what genuinely depends on the branch below it (an independent schema PR bases on dev; a dependency goes at the bottom, never mid-stack), because reordering a stack inflates every diff above it — GitHub's merge-base does not move, so a rebase after the parent merges is the only fix. Use before any commit or push, when opening a PR, when deciding whether to stack, or when asked about branch names, rebasing, or merging dev.
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
2. Make edits. **Before every `git commit`, run `pnpm format`** — no exceptions, including plan commits and one-line fixes. Then commit with a conventional message: `feat(scope): summary`, `fix(scope): summary`, `refactor(...)`. Write the summary and any body lines in the `technical-writing` skill's Simplified Technical English — active voice, one word per meaning, no filler.
3. Push the feature branch: `git push -u origin "issue-$TASK_GID"`.
4. Open the PR with `gh pr create --draft --base dev`. If the task has an Asana assignee that maps to a valid GitHub user (`scazan` / `valentin0h` / `nourmalaeb`), set it as the PR assignee with `gh pr edit --add-assignee <login>` — see `implement-task` Step 8 for the mapping.
5. Never `git push --force` to a shared branch unless you are rebasing. If you must rewrite history, do it on your own feature branch only.

## Stacking: only stack what actually depends on the parent

A stack is for work that cannot compile or run without the branch below it. A PR that nothing depends on goes straight on `dev`, even when you happened to write it while working on the stack. PR #1951 (a schema migration sitting mid-stack) drew *"We can also probably base this one directly off of `dev` and not have it in the stack here (or at the bottom of the stack instead of mid-stack)."*

The cost of getting it wrong is not stylistic. Reordering a stack rewrites the branches above it, and GitHub diffs each PR against a merge-base that does **not** move — so a reordered branch carries commits it does not own and the diff inflates. PR #1917 opened at 18 files / +18,008 when the real change was 13 files / +1,439, and the fix was *"a rebase after #1956 merges. Git drops the duplicate commit by patch-id and the count falls to 13. The merge alone does not fix it, because the merge-base does not move."*

So, in order: base an independent change on `dev`; put a dependency at the **bottom** of the stack, not in the middle; if you reorder anyway, say in the PR body which files belong to which PR and tell reviewers with the branch checked out to reset to `origin` rather than merge. And when a PR is superseded by a reordered sibling, close it with the pointer — *"Superseded by #1917, which carries these three commits directly (byte-identical patches, different SHAs)"* — so the review history stays followable.

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
