---
name: drizzle-migrations
description: Drizzle ORM workflow — edit schema files under services/db/schema/, run pnpm w:db generate, read the generated SQL, never apply with migrate. A data backfill is NOT a migration (ship it as a standalone ops script); a unique index must cover every column its JS guard covers; don't restate a column supabase auth already owns (phone, email, *_confirmed_at) and read the auth email rather than profileUsers.email, which is never synced after creation; a specific table beats a speculative generic one because ADD COLUMN type stays available later while splitting a populated generic table does not; prefer a concrete per-entity edge table over a polymorphic one whose "both ends are proposals" invariant no foreign key can express; and keep a relationship row rather than cascading it away when its absence still has to be displayed. Plus query conventions — prefer db.query.X (Relational Queries / RBQ v2) over imperative db.select().from().where(), use $inferSelect for row types, and always give findFirst a filter that identifies exactly one row (a non-unique column silently returns the wrong one). Use when touching services/db, adding/dropping columns, renaming, creating a new table, or writing a service-layer query.
---

## Where things live

- Schema: `services/db/schema/` — one file per logical area, re-exported from `index.ts`. Table files use the `.sql.ts` suffix.
- Drizzle config: `services/db/drizzle.config.ts` (entry: `schema/publicTables.ts`, snake_case casing, `drizzle.migrations` tracking table).
- Generated migrations: `services/db/migrations/<timestamp>_<slug>/{migration.sql,snapshot.json}` — one directory per migration. Drizzle records applied migrations in the `drizzle.migrations` table on the DB; there's no on-disk journal.
- Migration order is a high-water mark by folder-name timestamp (there's no `meta/_journal.json`) — any migration timestamped *before* the last-applied one is silently skipped and never runs in deployed envs. If you rebased `dev` or hand-copied a migration under an older prefix, re-generate or rename it so its timestamp is after the last released migration. PR #1510 self-review: a migration older than the last-applied one is silently skipped; it was timestamped after the prior migration so it can't be skipped.
- Drizzle client: imported via `@op/db/client`. Tables and schema types: `@op/db/schema`.

## Workflow

1. Edit a schema file under `services/db/schema/`.
2. Run `pnpm w:db generate` to produce a new migration directory (`migration.sql` + `snapshot.json`). This creates the migration; it does **not** apply it.
3. **Read the generated SQL.** Drizzle occasionally produces destructive ops (DROP, RENAME, NOT NULL backfills with no default) that need manual care.
4. Iterate on the schema until the generated SQL looks right. If a generation is wrong, delete the new migration directory, fix the schema, and re-run `generate` until it's clean.
5. **Don't run `pnpm w:db migrate` locally.** It's denied in `.claude/settings.json`. CI/CD applies migrations against every environment (including local dev via the docker stack's startup), so you don't need to apply by hand. If you need the schema in your local DB to test, restart the docker stack — migrations run on boot.

## Schema conventions

Recurring review patterns from recent schema PRs (#1186, #1228, #1264, #1274):

- **Foreign-key column naming**: use the suffix the rest of the table follows. If neighboring tables use `addedByProfileUserId`, don't introduce `addedById` — align (PR #1186 review: "we use `addedByProfileUserId` in other table, just a note to align if possible").
- **Unique indexes on natural keys**: if a column should be unique (e.g. a `sort_order` per parent), add a unique index — Drizzle won't infer it.
- **Generated columns** can replace runtime computation when the value is derivable from other columns:
  ```sql
  type text GENERATED ALWAYS AS (
    CASE WHEN attachment_id IS NOT NULL THEN 'document' ELSE 'link' END
  ) STORED
  ```
- **ON DELETE behavior**: confirm what happens to dependents on parent delete. Orphan rows can pile up silently when no cascade is set. Either set the cascade explicitly or document why orphans are OK ("ok to start like this or add an AFTER DELETE trigger").
- **Don't add defensive `IF NOT EXISTS` / `WHERE NOT EXISTS` guards to migrations** unless you have a real reason — they read as cargo-culted. PR #1274 review: "yeah, was just meant to ensure the migration won't fail but I'll remove."
- **A unique index has to cover every column the JS check covered**, or the check is decorative under concurrency. PR #1789: two callers both passed an unlocked "is there already a merge edge?" check before either insert, because the unique index was on the source column alone while the predicate spanned source *and* target — both edges committed. When you add a guard in a service, ask what index makes it hold when two requests interleave (see the `service-layer-structure` skill on re-asserting inside the writing statement).

### A generic edge table can't enforce what its ends are

A relationship table keyed on a polymorphic parent — `(entity_a, entity_b, type)` over "anything" — cannot express "both ends are proposals" or "both ends belong to the same decision instance" as a constraint, because there is no column pair for a composite foreign key to point at. PR #1801 review (valentin0h): *"do we have checks at the data layer that these are proposals?"* and *"feels like we need a composite foreign key to ensure certain relationships are blocked … But this table isn't necessarily tied to proposals, so I don't know how to enforce that generically."*

The resolution is to stop being generic: the table that shipped is keyed on `proposals` specifically, so the foreign keys do the work the service layer would otherwise have to. Prefer a concrete per-entity edge table over one polymorphic table whose invariants live only in application code. If a generic table really is the right call, the invariants it can't hold have to be asserted in the service *and* named in a comment on the table — an unenforceable invariant that nobody wrote down is indistinguishable from one that holds.

### Keep the edge when it determines how the row is presented

Before setting `ON DELETE CASCADE` on a relationship, ask whether the *absence* of the far end still needs to be displayed. PR #1761 (scazan): *"if the relationship determines anything about how the proposal shows up, we want that to persist with a dangling relationship so we can still present it (for instance, if merged from another proposal, we still want to display that history or if a proposal was merged into another, we need to flag that it is missing where it was merged to). A simple example would be a GDPR deletion request."* A cascade that tidies the graph also erases the reason a proposal disappeared from a pipeline. Pair the retained edge with a column on the row that consumers can key off (a merged-away marker) so reads don't have to walk the graph to learn the row should be hidden.

### Don't restate a column Supabase auth already owns

`auth.users` already holds `phone`, `email`, `phone_confirmed_at` and `email_confirmed_at`. A new table that copies one of them owns a second copy that can drift, and it has to be kept in sync by a trigger nobody remembers. PR #1951 review on `phoneVerifications`: *"We might not need to store the phone over here as it is stored also in the auth table. I guess I wonder whether or not we want to duplicate this from the auth table if so. Is this duplicating the `confirmed_at` field that's already in the supabase auth table?"* Reference the auth row and read through it; store a column here only when this table's copy means something the auth column doesn't (a value at the time of an event, a field the auth row lets the user reset).

### Specific table now, generic table later — the migration costs aren't symmetric

The reflex on a channel-specific table is to reach for the general shape: *"I'd be curious if it makes more sense to keep this as simply `verifications` or `auth_verifications` and we type it as phone, email, WhatsApp, etc. Might be more extensible without the specificity of phone here."* (#1951). Both answers are defensible, and the tiebreaker is which direction is cheap later:

> *"`ADD COLUMN type NOT NULL DEFAULT 'phone'` stays available later, while splitting a generic table once it holds rows does not."* (#1956)

The other half of that thread is worth copying too: the extensibility argument only holds if the *writer* generalizes. A trigger reading `NEW.phone_confirmed_at` and an email equivalent reading different columns means one table with two triggers, not one mechanism. Ask what the generic version actually shares before you name it generically — and when a table names a channel, decide before the migration is applied, because a name and a column set are cheap to change now and a second migration later.

### Read the auth email, not `profileUsers.email`

`profileUsers.email` is written at creation and **never synced after**, so it goes stale the moment a user changes their address and is null for anyone who never supplied one. It exists for join-free lookups in search and for stored vectors — not as a way to reach a person. PR #1919: *"we should be relying on the auth email for now rather than the profileUser email, which is never synced after creation. That column should probably go away either way."* Confirmed again on #1886: *"now that I've looked, `profileUser.email` was ONLY used for faster lookups without joins in search as well as stored vectors. We shouldn't rely on it here."* Anything that sends, notifies, or identifies goes through the auth user. (This is the same shape as *don't disambiguate on a column the write path leaves empty* in `service-layer-structure`.)

### A data backfill is not a migration

Schema changes ship through `pnpm w:db generate`; **data backfills don't**. PR #1825 was closed on exactly this: *"the bitfield backfill must not ship through the drizzle migration pipeline — it will be redone as a standalone ops script if we go ahead."* A migration runs unattended on every environment at boot, in one transaction, with no dry-run, no progress, no re-run story and no per-row error handling — all of which a backfill over real rows needs. Write it as a script that can be run, inspected, and re-run against one environment at a time, and keep the migration to the DDL.

## Query conventions — prefer relational (RBQ v2) over imperative

Reach for `db.query.<table>.findFirst / findMany` with `{ where, with, columns, orderBy }` before reaching for `db.select().from().where()`. The relational API is the codebase's direction — PR #1244 migrated access-user lookups to RBQ v2, and reviewers ask for it on new code.

```ts
// Prefer
const tail = await tx.query.resourceCollectionProfiles.findFirst({
  columns: { sortKey: true },
  where: { profileId },
  orderBy: { sortKey: 'desc' },
});

// Over
const [tail] = await tx
  .select({ sortKey: resourceCollectionProfiles.sortKey })
  .from(resourceCollectionProfiles)
  .where(eq(resourceCollectionProfiles.profileId, profileId))
  .orderBy(desc(resourceCollectionProfiles.sortKey))
  .limit(1);
```

### Filters use the object form, not imported operator functions

RBQ v2 expresses `eq`, `isNotNull`, `isNull`, `ilike`, `inArray`, and range predicates as object literals inside `where`. Don't import `eq` / `isNotNull` / `isNull` / `ilike` / `inArray` / `gt` / `gte` / `lt` / `lte` from `drizzle-orm` just to use them in a `where`:

```ts
// Prefer — object-literal filters, explicit columns
const rows = await db.query.profileUserInvites.findMany({
  where: {
    profileId,
    notifiedAt: { isNotNull: true },
    acceptedOn: { isNull: true },
    email: { ilike: pattern },
    role: { inArray: ['admin', 'owner'] },
  },
  columns: { id: true, email: true },
});

// Over — imported eq / isNotNull / isNull / ilike / inArray
const rows = await db
  .select({ id: profileUserInvites.id, email: profileUserInvites.email })
  .from(profileUserInvites)
  .where(
    and(
      eq(profileUserInvites.profileId, profileId),
      isNotNull(profileUserInvites.notifiedAt),
      isNull(profileUserInvites.acceptedOn),
      ilike(profileUserInvites.email, pattern),
      inArray(profileUserInvites.role, ['admin', 'owner']),
    ),
  );
```

Spread-conditional clauses keep optional filters readable:

```ts
where: {
  profileId,
  ...(pending === true && { acceptedOn: { isNull: true } }),
},
```

Live references: `packages/common/src/services/profile/listUserInvites.ts:25-28` (`isNotNull` + spread-conditional) and `listProfileUserInvites.ts:30` (`isNull`).

### `findFirst` on a non-unique column needs a disambiguating filter

`findFirst` returns whichever row the planner hands back first. That's only deterministic when the `where` narrows to at most one row — so if you're filtering on a column with no unique constraint, add the predicate that actually identifies the row you want (a status, a soft-delete flag, an explicit `orderBy`). The failure is silent: the query succeeds, returns a real row, and the operation quietly acts on the wrong one.

```ts
// ❌ profileId isn't unique on processInstances — an archived DRAFT can win.
db.query.processInstances.findFirst({ where: { profileId } })

// ✅ Name the row you mean.
db.query.processInstances.findFirst({
  where: { profileId, status: ProcessStatus.PUBLISHED },
  columns: { id: true },
})
```

PR #1658: without the status filter "a non-published instance (e.g. an archived DRAFT) could be returned first since `profileId` has no unique constraint, causing the backfill to silently skip while the live instance is never reached." Check the sibling that already does it right — `backfillReviewAssignments.ts` carried the filter; the new workflow didn't.

### Project only the columns you need

Pass `columns: { foo: true, bar: true }` when only a few fields are wanted — don't pull the whole row and discard most of it:

```ts
const rows = await db.query.decisionBoundaries.findMany({
  where: { profileId, taxonomyTermId: { isNotNull: true } },
  columns: { name: true },
});
```

### When to fall back to `db.select`

Imperative `db.select().from()` is fine when RBQ genuinely can't express the query — typically:

- PostGIS / raw `sql` predicates (`ST_Contains`, `ST_Intersects`).
- Literal projections RBQ doesn't model (`` sql`1` `` for existence probes, `count(*)`, window functions).
- CTEs, custom join conditions on computed expressions, or raw subqueries.

When you do fall back, **leave a one-line comment explaining *why*** so the next reader doesn't reflexively rewrite it as RBQ. Canonical fallback: `packages/common/src/services/decision/resolveBoundary.ts:27-40` (`ST_Contains` over a geography column — RBQ can't express it cleanly).

**Share the predicate between a findMany and its count.** When a list query needs both the page (relational `findMany`) and a total (`count(*)`), don't duplicate the `where` — extract a `buildWhereClause(table)` helper parameterized on the table ref so the same predicate applies to both the aliased relational table and the plain count query. PR #1553 review: `buildWhereClause` is parameterized on the table ref so the same predicate works for both the relational `findMany` (aliased table) and the plain count query.

### Mutations and transactions are out of scope

`db.insert()` / `db.update()` / `db.delete()` stay imperative — RBQ doesn't replace writes. Transactions wrapping several statements continue to use the same operators on the `tx` handle; the preference here is about the **read** path. RBQ on a `tx` handle (`tx.query.<table>.findFirst(...)`) is fine and matches the example above.

## Type generation

- Schema types flow through `@op/db` automatically — re-running `generate` and a typecheck (`pnpm w:app typecheck`) is enough to surface mismatches.
- For a row type, use `typeof <table>.$inferSelect` (or `$inferInsert` for the insert shape) — not `InferModel<typeof <table>>`. PR #1264 review: "Use `$inferSelect` if needed." Don't handwrite a Zod schema that duplicates the row shape — use `createSelectSchema(<table>)` from drizzle-zod and extend it.

## Don't

- Don't run `pnpm w:db migrate`. The agent should never apply migrations directly — it's a denied command, and applying outside the normal flow risks drift between the migration files and the DB state.
- Don't hand-edit `migration.sql` or `snapshot.json` after a migration has been committed and shipped — write a new corrective migration instead.
- Don't delete a migration directory that's already been merged to `dev`/`main`. Other devs and shared envs have applied it; removing it desyncs everyone.
- A `migrationsCheck` pre-commit guard blocks deleting committed migrations by design — don't reach for `--no-verify` to get around it. The one safe exception is deleting a migration no real database has recorded (generated locally, never applied to `dev`/`main`); anything already shipped desyncs shared envs. PR #1510 self-review: deletion via `--no-verify` was only safe because no database had it recorded.
- Don't add unrelated schema changes to a feature migration. One concern per migration; reviewers will ask you to split.
