---
name: pr-description
description: How to write a PR description in this repo — short, concise, and to the point. Describe only what the reviewer cannot get from the diff, and spend the words on architectural considerations (new boundaries, data flow, schema shape, coupling, migration order), with a mermaid diagram when structure is the point. One paragraph is the default; no test-plan checklist, no walk-through of the diff, no AI-generated summary. Mermaid ERDs for schema PRs, sequence/flowchart diagrams for cross-service or multi-step flows, stacked-PR references, Asana task link. Use when opening a PR (via implement-task or by hand), drafting a PR body, or deciding what to include / omit.
---

PR descriptions in this repo are **short, concise, and to the point**. The diff speaks for itself; the description tells the reviewer what changed and why in as few words as that takes. Most merged PRs are one paragraph. A handful are longer, and they earn the extra words by explaining a non-obvious constraint, root cause, or stack relationship.

The test for every sentence: **could the reviewer get this from the diff?** If yes, cut it. What survives is almost always **architectural** — the shape of the change rather than its contents:

- A new or moved boundary (a procedure tier, a service split, a package dependency).
- Data flow and ownership — who calls what, what now holds the state, what the source of truth is.
- Schema shape and relationships.
- Coupling the reviewer would otherwise have to infer, and migration or rollout order.
- The constraint that forced the design, when the obvious approach was rejected.

When that shape is easier to see than to read, draw it — a mermaid diagram is part of the description, not decoration. Everything else stays out.

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

### A mermaid diagram when structure is the point

Draw the architecture when a diagram lands it faster than a paragraph. Pick the form that matches what changed, keep it to the nodes that changed plus their immediate neighbours, and don't diagram a change one sentence already covers.

| Change | Diagram |
|---|---|
| Tables added, relationships changed | `erDiagram` |
| A flow crossing services, jobs, or the client/server line | `sequenceDiagram` |
| A new boundary, a moved responsibility, a rewired data flow | `flowchart` |

An `erDiagram` is required, not optional, for any PR adding tables or changing relationships — reviewers read the ERD before the SQL. PR #1186 is the model.

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
- **No implementation narration.** Which hook you used, which helper you renamed, how many files moved — that's the diff's job. Describe the architecture the change lands in, not the steps that got it there.
- **No decorative diagram.** A mermaid block that redraws what one sentence already said costs the reviewer more than it gives.
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
- **Don't leave an architectural change undescribed.** Short is the rule; silent is not. If the PR moves a boundary, changes who owns state, or reorders a migration, that belongs in the body even when the diff is small.
- **Don't bury a Stacked-on PR** in the middle of the body. First line of the summary, or its own line above it.
