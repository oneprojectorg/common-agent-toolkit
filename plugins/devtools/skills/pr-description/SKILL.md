---
name: pr-description
description: "What goes in a PR body: one paragraph on the architecture and the why, the task link, a mermaid erDiagram for schema PRs, a stacked-on line; no test plan, diff walk-through or metrics. Use when drafting or editing a PR description or a gh pr create --body."
---

The test for every sentence: **can the reviewer get this from the diff?** If yes, cut it. Write what survives in the `technical-writing` skill's style. `branch-and-pr` owns the title.

## What belongs

Spend the words on the shape of the change:

- A new or moved boundary (a procedure tier, a service split, a package dependency).
- Data flow and ownership: who calls what, where the state lives, what the source of truth is.
- Schema shape and relationships; migration or rollout order.
- The constraint that forced the design, when the obvious approach was rejected.

## Default: one paragraph plus the task link

```markdown
<One paragraph: what the change does and why. Add a non-obvious follow-up or context if there is one.>

Asana: https://app.asana.com/0/<project_gid>/<task_gid>
```

The task link is required and goes on the last line: the Asana URL, or `Closes #<n>` for a GitHub issue.

Models:

- #1252: "Mirror the profile-side `assertProfileAccess` utility for organizations so org-access denials are fetched, checked, and unified on `UnauthorizedError` in one place."
- #1244: "Move both access-user lookups off the legacy `db._query` API onto `db.query`, the source of truth for relations going forward. The v2 result types match the normalizer, so the role and profile type assertions are no longer needed."

A one-line description for a one-line change is correct.

## When a PR needs more

- **Schema change → `erDiagram` (required).** Any PR that adds tables or changes relationships includes one, under `## Table structure`. Reviewers read it before the SQL (model: #1186).
- **Cross-service or multi-step flow → `sequenceDiagram`; moved boundary or rewired data flow → `flowchart`.** Draw only the changed nodes and their neighbours. Skip a diagram one sentence already covers.
- **Non-obvious root cause.** Name it when the bug class will recur (stale closure, race, cache-key drift) (model: #1176).
- **Stacked PR.** First line: `Stacked on #NNNN (<what it adds>).`
- **Follow-ups.** A `## Follow-ups (out of scope)` list, one concrete line each, only for work already in scope but deferred. File a task for anything non-trivial.

## What stays out

- Test-plan checklists, "skipped locally" notes.
- A walk-through of the diff or narration of the steps you took.
- Blast-radius or CRAP metrics. CI computes and posts them.
- An AI-generated summary, marketing words, decorative diagrams.
- Screenshots, unless a visual change is hard to describe.

## Review checklist

- [ ] Every sentence says something the diff does not
- [ ] An architectural change (boundary, state owner, migration order) is described, even if the diff is small
- [ ] The task link is on the last line
- [ ] A schema PR has an `erDiagram`
- [ ] A stacked PR names its parent on the first line
- [ ] No test plan, diff walk-through, pasted metrics or marketing words
