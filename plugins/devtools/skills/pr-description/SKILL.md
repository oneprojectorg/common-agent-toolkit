---
name: pr-description
description: How to write a PR description in this repo — concise, lead with what and why in one paragraph (sometimes a few bullets), no test-plan checklist, no walk-through of the diff. Mermaid ERDs for schema PRs, stacked-PR references, Asana task link. Use when opening a PR (via implement-task or by hand), drafting a PR body, or deciding what to include / omit.
---

PR descriptions in this repo are **short**. The diff speaks for itself; the description tells the reviewer what changed and why in as few words as that takes. Most merged PRs are one paragraph. A handful are longer, and they earn the extra words by explaining a non-obvious constraint, root cause, or stack relationship.

## The default — one paragraph

Most PRs need exactly this:

```markdown
<One paragraph: what the change does, and the why behind it. End with any non-obvious follow-up or context the reviewer needs.>

Asana: https://app.asana.com/0/<project>/<task_gid>
```

Models from PRs that closed cleanly:

- **#1240**: "Makes each endpoint's auth posture explicit ahead of opening any public access. Renames the closed-network procedure (`commonAuthedProcedure` → `networkAuthenticatedProcedure`) and adds inert `authenticatedConfirmedProcedure`, `authenticatedProcedure`, and `openProcedure` scaffolding with no endpoint behavior change yet."
- **#1252**: "Mirror the profile-side `assertProfileAccess` utility for organizations so org-access denials are fetched, checked, and unified on `UnauthorizedError` in one place."
- **#1244**: "Move both access-user lookups off the legacy `db._query` API onto `db.query`, the source of truth for relations going forward. The v2 result types match the normalizer, so the role and profile type assertions are no longer needed."

That's the bar. One declarative sentence about what, one about why or consequence, optional one about follow-ups. Stop there.

## When a PR needs more

A small set of cases earn extra structure. Don't reach for them by default — only when the PR genuinely needs them.

### Schema / migration PRs — mermaid ERD

Embed a mermaid `erDiagram` block for any PR adding tables or changing relationships. PR #1186 is the model. Reviewers reviewing migrations read the ERD before the SQL.

````markdown
<One-paragraph summary.>

## Table structure

```mermaid
erDiagram
  profiles ||--o{ resource_collection_profiles : has
  resource_collections ||--o{ resource_collection_profiles : "shared with"
  resources ||--o{ resource_collection_items : "appears in"
  ...
```
````

### Bug-fix PRs with a non-obvious root cause

When the root cause is the kind of bug that will recur in similar shape (a stale-closure, a race, a cache-key drift), name it. PR #1176 is the model — the root-cause paragraph becomes the post-mortem someone debugging a similar issue will grep for next time. Don't expand a bug-fix description when the root cause is obvious from the diff.

### Stacked PRs

If the PR depends on another open PR, say so at the top:

> Stacked on the moderation_flags schema PR (#1264).

When a release-train PR follows a sequence, list the stack in order:

> Service layer + tRPC routes: #1180. UI: #1181. This PR (#1186) is now rebased onto `dev`.

### Follow-ups

If the PR surfaced concrete items that didn't fit its scope, list them — one line each, action-oriented. Keep it tight:

```markdown
## Follow-ups (out of scope)

- **Budget validation gap:** map `money` in `X_FORMAT_TO_FIELD_TYPE` + add budget checks to `getFieldErrors`.
- **Drift risk:** `LOCKED_PROPOSAL_FIELD_KEYS` hardcodes the editor's locked/editable split; a shared constant would be sturdier.
```

Two rules:
1. **Concrete enough that someone else could pick it up.** "Refactor this later" doesn't qualify.
2. **Already in scope but punted, not ideas.** If it isn't going to happen, leave it out.

When the follow-up is non-trivial, file an Asana task and link it — the PR section is for "where do we pick up from here," the task tracker is for actually following up.

## What NOT to include

- **No test-plan checklist.** Reviewers know what gates run and CI re-runs them. A `- [ ] pnpm typecheck` checklist is noise.
- **No diff walk-through.** Reviewers read the diff. A bullet list that just enumerates "added X to file Y, added Z to file W" gets skimmed.
- **No marketing copy.** "Comprehensive refactor", "unlocks a powerful workflow" — drop it. Be flat.
- **No "Skipped locally" section.** If you're handing off a gate to CI, that's a process decision and doesn't need to be debated in the PR body. The implement-task skill governs when gates are required at task-completion time.
- **No screenshots unless they actually clarify the change.** A modal that's "wider now" doesn't need a before/after; a layout shift that's hard to describe might.

## Title vs body

The title carries the conventional-commit type and one-line description: `feat(decisions): add admin review-selection screen`. Under 70 characters; details go in the body. The `branch-and-pr` skill owns title conventions; this skill is just about the body.

## Asana link

Every PR opened by `implement-task` includes:

```
Asana: https://app.asana.com/0/<project_gid>/<task_gid>
```

Drop it on the last line. Reviewers click through to read the original task; the link gets used in both directions (the task also gets a "PR opened: <url>" story posted back).

## Don't

- **Don't paste an AI-generated summary** of the diff. Concise human framing beats verbose mechanical narration.
- **Don't open a PR without the Asana link** — it's what makes the PR findable from the task tracker.
- **Don't expand a Summary just to look thorough.** A one-line PR description for a one-line change is correct, not lazy.
- **Don't bury a Stacked-on PR** in the middle of the body. First line of the summary, or its own line above it.
