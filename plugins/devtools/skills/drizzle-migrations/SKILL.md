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

## Query conventions — prefer relational (RBQ) over imperative

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

Imperative `db.select().from()` is fine when you need a SQL feature RBQ doesn't expose (CTEs, custom join conditions on computed expressions, raw subqueries) — but it's the exception, not the default. When you do reach for it, leave a one-line comment explaining why.

The same applies to `db.update()`, `db.insert()`, `db.delete()` — RBQ doesn't replace those, but the **read path** is the one that should default to `db.query`.

## Type generation

- Schema types flow through `@op/db` automatically — re-running `generate` and a typecheck (`pnpm w:app typecheck`) is enough to surface mismatches.
- For a row type, use `typeof <table>.$inferSelect` (or `$inferInsert` for the insert shape). PR #1264 review: "Use `$inferSelect` if needed." Don't handwrite a Zod schema that duplicates the row shape — use `createSelectSchema(<table>)` from drizzle-zod and extend it.

## Don't

- Don't run `pnpm w:db migrate`. The agent should never apply migrations directly — it's a denied command, and applying outside the normal flow risks drift between the migration files and the DB state.
- Don't hand-edit `migration.sql` or `snapshot.json` after a migration has been committed and shipped — write a new corrective migration instead.
- Don't delete a migration directory that's already been merged to `dev`/`main`. Other devs and shared envs have applied it; removing it desyncs everyone.
- Don't add unrelated schema changes to a feature migration. One concern per migration; reviewers will ask you to split.
