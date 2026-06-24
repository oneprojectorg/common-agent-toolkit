---
name: drizzle-migrations
description: Drizzle ORM workflow — edit schema files under services/db/schema/, run pnpm w:db generate, read the generated SQL, never apply with migrate. Plus query conventions — prefer db.query.X (Relational Queries / RBQ v2) over imperative db.select().from().where(), and use $inferSelect for row types. Use when touching services/db, adding/dropping columns, renaming, creating a new table, or writing a service-layer query.
---

## Where things live

- Schema: `services/db/schema/` — one file per logical area, re-exported from `index.ts`. Table files use the `.sql.ts` suffix.
- Drizzle config: `services/db/drizzle.config.ts` (entry: `schema/publicTables.ts`, snake_case casing, `drizzle.migrations` tracking table).
- Generated migrations: `services/db/migrations/<timestamp>_<slug>/{migration.sql,snapshot.json}` — one directory per migration. Drizzle records applied migrations in the `drizzle.migrations` table on the DB; there's no on-disk journal.
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

### Mutations and transactions are out of scope

`db.insert()` / `db.update()` / `db.delete()` stay imperative — RBQ doesn't replace writes. Transactions wrapping several statements continue to use the same operators on the `tx` handle; the preference here is about the **read** path. RBQ on a `tx` handle (`tx.query.<table>.findFirst(...)`) is fine and matches the example above.

## Type generation

- Schema types flow through `@op/db` automatically — re-running `generate` and a typecheck (`pnpm w:app typecheck`) is enough to surface mismatches.
- For a row type, use `typeof <table>.$inferSelect` (or `$inferInsert` for the insert shape) — not `InferModel<typeof <table>>`. PR #1264 review: "Use `$inferSelect` if needed." Don't handwrite a Zod schema that duplicates the row shape — use `createSelectSchema(<table>)` from drizzle-zod and extend it.

## Don't

- Don't run `pnpm w:db migrate`. The agent should never apply migrations directly — it's a denied command, and applying outside the normal flow risks drift between the migration files and the DB state.
- Don't hand-edit `migration.sql` or `snapshot.json` after a migration has been committed and shipped — write a new corrective migration instead.
- Don't delete a migration directory that's already been merged to `dev`/`main`. Other devs and shared envs have applied it; removing it desyncs everyone.
- Don't add unrelated schema changes to a feature migration. One concern per migration; reviewers will ask you to split.
