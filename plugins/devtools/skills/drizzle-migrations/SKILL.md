---
name: drizzle-migrations
description: Drizzle schema, migrations and queries in services/db — schema/tables/*.sql.ts, pnpm w:db generate (never migrate), relations.ts v2, indexes / ON DELETE, db.query filters ({ in }, isNull), $inferSelect. Use when changing a table, writing a migration, or writing any db read in a service.
---

Sole owner of Drizzle query syntax (filters, relations, `db.query`) and migrations. Other skills link here.

## Where things live

- Tables: `services/db/schema/tables/*.sql.ts`, registered in `schema/publicTables.ts` (the drizzle-kit entry).
- Relations: `services/db/relations.ts` (v2 `defineRelations`, source of truth for `db.query`). Don't add v1 `relations()` blocks in `*.sql.ts` for new tables.
- Migrations: `services/db/migrations/<timestamp>_<slug>/{migration.sql,snapshot.json}`. Applied ones are tracked in the `drizzle.migrations` table; there is no `_journal.json`.
- Imports: client from `@op/db/client`, tables and enums from `@op/db/schema`.

## Workflow

1. Edit the table file (and `relations.ts` if relations change).
2. `pnpm w:db generate`. This writes a migration but does not apply it.
3. Read `migration.sql`. Look for DROP, RENAME-as-drop+add, and NOT NULL without a default.
4. If it's wrong, delete the new directory, fix the schema, regenerate.
5. Never run `pnpm w:db migrate` (it's denied). CI/CD applies migrations, and the local docker stack runs them on boot.
6. `pnpm w:app typecheck` to surface type fallout.

## Migration rules

- Order is a high-water mark by folder timestamp. A migration timestamped before the last applied one is skipped silently. After a rebase, regenerate or rename it so it sorts last.
- Never edit or delete a migration that has been merged. Write a corrective one. `pnpm check-migrations` (`scripts/migrationsCheck.ts`) rejects staged M/D on migration SQL. Don't bypass it.
- One concern per migration. Keep unrelated schema changes out.
- A data backfill is not a migration. Ship it as a standalone ops script you can run, inspect and re-run per environment. Keep migrations to DDL.
- Skip defensive `IF NOT EXISTS` guards unless you have a concrete reason.
- An update that must keep the edit date sets `updatedAt: sql\`${table.updatedAt}\``. The shared `timestamps.updatedAt` has `$onUpdate`, so any `.set()` without it stamps now. Don't write back a value you read earlier; a concurrent edit is lost.

## Schema rules

- FK column names follow the neighbouring tables' suffix (e.g. `addedByProfileUserId`, not `addedById`).
- Name a new table after its siblings (`decisions_vote_drafts` next to `decisions_vote_submissions`) and for what a row holds (`decision_phone_numbers`, not `decision_chat_lines`). Use the words the code already uses (`selections`, not `picks`).
- Start with the fewest columns. Store the end result (`enrolledAt`), not the method that got there (an attestation hash) or a status you can derive. Add columns when a second process needs them.
- Reference the stable concept, not an intermediary you derive it from: a taxonomy term, not the boundary the term comes from.
- A set of rows a record points at is a child table with FKs, shaped like its sibling (`decisions_vote_draft_proposals` mirrors `decisions_vote_proposals`). Not a jsonb array of ids.
- Keep channel and session state (page cursor, last line used) out of a domain table. Put it in its own table, so the domain row works for web and SMS alike.
- Before you make a column unique, ask what could need a second row later (a second channel on the same decision). When a unique index changes, change the relation too (`r.one` → `r.many`).
- Add unique indexes on natural keys explicitly. Drizzle won't infer them.
- A unique index must cover every column the service's JS guard checks. If it doesn't, the guard does nothing under concurrency.
- Decide ON DELETE for every FK. Before you cascade a relationship, ask whether its absence still has to be shown (merged-from history, for example). If it does, keep the edge and add a marker column.
- Trace the cascade from the row you delete. A child that owns a profile through its own `profileId` does not delete that profile. Delete the owned profiles in the same statement.
- A field you filter, join or sort on is a column, not a key in the `data` JSON column.
- Prefer a concrete per-entity edge table over a polymorphic one. FKs can enforce "both ends are proposals"; generic tables can't.
- Prefer a specific table now. `ADD COLUMN type ... DEFAULT` is cheap later, while splitting a populated generic table isn't.
- Don't copy columns that `auth.users` owns (`phone`, `email`, `*_confirmed_at`). Reference the auth row.
- `profileUsers.email` is never synced after creation. Anything that sends, notifies or identifies reads the auth email.
- Use generated columns (`GENERATED ALWAYS AS (...) STORED`) for values derivable from other columns.

## Query rules (reads)

Default to `db.query.<table>.findFirst / findMany` (`tx.query` inside a transaction):

```ts
const rows = await db.query.profileUserInvites.findMany({
  where: {
    profileId,
    notifiedAt: { isNotNull: true },
    email: { ilike: pattern },
    role: { in: ['admin', 'owner'] },
    ...(pending === true && { acceptedOn: { isNull: true } }),
  },
  columns: { id: true, email: true },
  orderBy: { createdAt: 'desc' },
});
```

- Write filters as objects: `{ in: [...] }`, `{ isNull: true }`, `{ isNotNull: true }`, `{ ilike }`, `{ gt/gte/lt/lte }`. Never `{ inArray: [...] }`. Don't import `eq`/`isNull`/`inArray`/etc. into a `where` you could write as an object.
- Add optional filters with a conditional spread (`...(x && { col: ... })`). Remember that `undefined` conditions are dropped silently, so a missing caller id turns into "no filter". See access-control for `resolveAccessUserIds`.
- Project with `columns: { a: true }` when you need only a few fields, and narrow `with:` relations to what the encoder emits.
- `findFirst` on a non-unique column needs a predicate (or `orderBy`) that picks exactly one row, e.g. `{ profileId, status: ProcessStatus.PUBLISHED }`.
- `db._query` is the v1 relational API, kept only as a migration path. Do not add it. Move a `_query` call you touch to `db.query`.
- Fall back to `db.select()` only when `db.query` can't express the query: PostGIS/raw `sql` predicates, `count(*)`, `sql\`1\`` probes, window functions, CTEs. Leave a one-line comment saying why. Example: `packages/common/src/services/decision/resolveBoundary.ts`.
- When a list needs both a page and a total, share one predicate builder between `findMany` and the `count(*)` (see `buildWhereClause` in `decision/listProposals.ts`).
- For a set-membership filter, use a subquery or `EXISTS` instead of materializing ids in JS and splatting them into `IN (...)`.
- For heavy eager loads, page the base ids first, then hydrate with `where: { id: { in: pageIds } }` and re-apply the order (see `posts/listPosts.ts`).
- Writes (`insert/update/delete`) stay imperative and may use operator functions.

## Types

- Row type: `typeof table.$inferSelect` / `$inferInsert`, never `InferModel`.
- Zod row schema: `createSelectSchema(table)` from `drizzle-zod`, then `.extend()`. Don't hand-write the row shape.

See [references/lessons.md](references/lessons.md) for the PR history behind these rules.

## Review checklist

- [ ] Schema change has a generated migration; SQL read for destructive ops
- [ ] No `pnpm w:db migrate`; no edits/deletes to merged migrations
- [ ] Migration timestamp sorts after the latest on `dev`
- [ ] No data backfill inside a migration
- [ ] New relations in `relations.ts` (v2), none added in `*.sql.ts`
- [ ] Unique index covers every column the JS guard checks
- [ ] New table is named like its siblings, holds the minimum columns, and keeps session state out
- [ ] Updates that must not bump the edit date keep `updatedAt` in the `.set()`
- [ ] ON DELETE chosen deliberately for each new FK
- [ ] No duplicated `auth.users` columns; no reads of `profileUsers.email` for contact
- [ ] Reads use `db.query` with object filters; `{ in }` not `{ inArray }`
- [ ] `findFirst` filters identify exactly one row
- [ ] `db.select` fallbacks carry a why-comment
- [ ] Row types via `$inferSelect`; Zod via `createSelectSchema`
