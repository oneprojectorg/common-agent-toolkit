# GitHub issue adapter

Used when the input is an issue number (`#123`, `gh:123`) or a `github.com/<owner>/<repo>/issues/<n>` URL. Run `gh` from the repo; pass `-R <owner>/<repo>` when the URL names another repo.

## Fetch

```bash
gh issue view "$N" --json number,title,body,state,assignees,labels,comments,url
```

Stop if `state` is `CLOSED`. Verification steps: an "Acceptance criteria", `## Verification` or "Steps to reproduce" section in the body or comments. Source URL for the PR body: the `url` field.

## Claim

```bash
gh issue view "$N" --json assignees --jq '[.assignees[].login]'
```

- Assigned to someone other than you (`gh api user --jq .login`) → stop and ask the user before taking it over.
- Otherwise claim it: `gh issue edit "$N" --add-assignee @me`, then comment `Picked up by agent — branch issue-gh-$N`.

## Branch

`issue-gh-$N`.

## Comment

`gh issue comment "$N" --body "$TEXT"`

## Transitions

common has no status labels; don't create any. State lives in comments and the PR link.

| State | Action |
|---|---|
| in_progress | the claim comment |
| in_review | put `Closes #$N` in the PR body; GitHub links the PR and closes the issue on merge |
| blocked | comment what blocked (what you tried, what failed, what a retry needs); leave the issue open |

## Hand-off (PR open)

1. If the issue has an assignee other than you, add them: `gh pr edit --add-assignee <login>`.
2. Comment `PR opened: <pr-url>`.
3. Never close the issue yourself; the merge does it.
