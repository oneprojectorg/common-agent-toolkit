# branch-and-pr: review lessons

- Put an independent schema migration on `dev` or at the bottom of a stack, never mid-stack (PR #1951)
- A reordered stack inflates every diff above it; only a rebase after the parent merges fixes it, a merge does not (PR #1917)
- Close a superseded PR with a pointer to the PR that now carries its commits (PR #1917)
- Disclosing bundled fixes in the PR body does not clear review; split them into their own PRs (PR #1750 → #1783, #1785, #1786)
- An unrequested refactor of nearby code is its own finding; revert it unless you can say what it buys (PR #1909)
- Do not add a feature flag nobody asked for; gate only the surface that must be hidden (PR #1930)
- A stacked PR whose only content is a helper with no caller ships dead code; fold it into the PR that calls it (PR #2113 → #2116)
- When you patch a call site instead of the upstream cause, name the cause and file it (PR #1750)
