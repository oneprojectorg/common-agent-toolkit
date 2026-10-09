---
name: branch-and-pr
description: "Scope, branches, commits and PRs: one task per PR, branch off origin/dev, conventional commits, draft PRs to dev, stacked PRs with gh stack, and what the protected-branch hooks block. Use before a commit or push, when opening or stacking a PR, or when a change grows past its task."
---

## Scope: one task per PR

- The PR does the task and nothing else. A bug fix ships no refactor; a refactor ships no feature.
- A fix you tripped over goes on its own branch off `origin/dev`, as you find it. Saying "bundled" in the PR body does not make it OK to bundle.
- Exception: a trivial, load-bearing change (a one-line config tweak without which nothing runs). Name it in the PR body.
- Revert a rewrite of nearby code that nobody asked for, unless you can say what it buys. Add no speculative feature flags.
- Adjacent problems you see become follow-up tasks or separate PRs, not scope growth.
- If you patch a call site and not the upstream cause, name the cause in the PR body and file it.
- Re-adding code the repo deleted? Start from the deleting commit's parent, not a fresh rewrite.

## Branches and commits

- Never commit on `main` or `dev`. Create every branch explicitly from `origin/dev`:
  `git fetch origin dev && git checkout -b <branch> origin/dev`. A bare `git checkout -b` stacks on whatever HEAD was.
- Branch names: `issue-<asana_gid>` for an Asana task, `issue-gh-<n>` for a GitHub issue, `<type>/<slug>` for a spec or prompt. The same task always gives the same name, so parallel pickups collide visibly.
- Before every commit run `pnpm format:changes`. It formats files that differ from the index, so run it before `git add`. CI runs `pnpm format:check`.
- Commit messages: conventional (`feat(scope): …`, `fix(scope): …`, `refactor(scope): …`), written per the `technical-writing` skill.
- Force-push (`--force-with-lease`) only your own feature branch, after a rebase.

## Pull requests

- `gh pr create --draft --base dev`. Agents never open a PR as ready; the author marks it ready.
- Title: conventional-commit form, under 70 characters. The body follows the `pr-description` skill.
- Releases (`dev` → `main`) go only through the `release` skill.

## Stacked PRs (`gh stack`)

Stack when a task is large (more than about 400 changed lines) or splits into layers that each review on their own (schema → service → API → UI). Each slice must do something observable; a slice that only adds a helper with no caller goes into the PR that calls it.

- Stack only what depends on the slice below. A change nothing depends on (an independent migration) goes straight on `dev`. Put a dependency at the **bottom**, never mid-stack.
- The bottom PR targets `dev`. Each PR above uses the slice below it as its base.

Flow. The repo's default branch is `dev`, so `gh stack init` needs no `--base`. Do not pass `--base dev`: the hook blocks a `gh` command that names `dev`.

```bash
git fetch origin dev && git checkout -b issue-<gid>-schema origin/dev
gh stack init issue-<gid>-schema                 # adopt that branch as the bottom layer
# edit, pnpm format:changes, commit
gh stack add -Am "feat(api): add review endpoint" issue-<gid>-api   # new layer on top; commits staged changes
gh stack view --short                            # branches, PRs, "needs rebase" markers
gh stack submit --auto                           # push all; create/update PRs (drafts with --auto); wire bases
gh stack sync                                    # fetch, cascade-rebase onto updated parents, push, sync PR state
gh stack rebase [--upstack|--downstack]          # cascade rebase; --continue / --abort on conflict
gh stack push                                    # push branches only
gh stack up | down | top | bottom                # move between layers
```

- `gh stack init a b c` creates or adopts several layers at once, bottom to top.
- After `submit --auto`, set each title and body with `gh pr edit <n> --title … --body …`. Never pass `--open`; PRs stay drafts.
- After a lower PR merges, run `gh stack sync` (add `--prune` to drop merged branches). GitHub's merge-base does not move on merge. Only the rebase removes the merged commits from the diffs above.
- If you reorder a stack, say in each PR body which files belong to it. Close a superseded PR with a pointer to its replacement.

## What the plugin hooks block

`hooks/block-protected-branches.sh` (any Bash call that runs `git`/`gh`):

- Always blocked, even with the marker: `git push` that names `main`/`dev` (including force); `git reset --hard`, `git clean -f`, `git branch -D`, `git checkout -- <path>` / `git checkout .`.
- Allowed: `gh pr create --base dev`; `git checkout -b|switch -c <branch> [origin/]dev`; read and local-sync verbs naming `main`/`dev` (`fetch`, `pull`, `rebase`, `merge`, `diff`, `log`, `show`, `status`, `rev-parse`, `ls-remote`, `blame`, `range-diff`, and similar).
- Blocked unless prefixed `CLAUDE_RELEASE=1`: `gh pr create --base main`, and any other `git`/`gh` command that names `main`/`dev` (`git checkout dev`, `git switch main`, `gh api …/branches/dev`, `gh stack init --base dev`).
- `CLAUDE_RELEASE=1` is for the `release` skill only. Never use it anywhere else.

`hooks/require-feature-branch.sh`: blocks `git commit` while HEAD is `main` or `dev`.

In common, the project hook `.claude/hooks/block-gh-main.sh` also blocks every `git`/`gh` command that names `main`, with no marker exception (so `git diff origin/main..HEAD` fails there; diff against `origin/dev`).

If a hook blocks you, move to a feature branch. Do not route around it.

Past review incidents: [references/lessons.md](references/lessons.md).

## Review checklist

- [ ] The diff does one task; no bundled fix, unrequested refactor or speculative flag
- [ ] Any trivial load-bearing extra is named in the PR body
- [ ] Branch was cut from `origin/dev` and follows the naming rule
- [ ] Commits are conventional and the diff is formatted (`pnpm format:check` clean)
- [ ] PR is a draft against `dev` (or the slice below, in a stack)
- [ ] Each stacked slice depends on the one below and does something observable on its own
- [ ] Independent changes (such as a standalone migration) are not mid-stack
- [ ] No `CLAUDE_RELEASE=1` outside the release flow; no force-push to a shared branch
