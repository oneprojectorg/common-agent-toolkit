---
name: service-layer-structure
description: Layout of @op/common services in packages/common/src/services/<feature>/ — one op per file, named params, assert first, transactions and locks, schemas.ts/utils.ts/<feature>Auth.ts, cursor pagination, bulk reads, exports. Use when adding or editing a createX/getX/listX/updateX op or helper there.
---

Business logic lives in `packages/common/src/services/<feature>/`. Routers are thin wrappers around it (see api-endpoints). Other skills own these topics, so this one only links to them: query syntax is in drizzle-migrations, channel wiring in realtime-channels, naming/errors/params/logging in code-conventions, and authorization primitives in access-control.

## Layout

```
services/foo/
├── index.ts          # barrel
├── schemas.ts        # Zod schemas + z.infer DTO types (or schemas/ dir when large)
├── constants.ts      # limits, allowlists, provider caps — with why-comments
├── utils.ts          # pure helpers, no I/O
├── fooAuth.ts        # assertFooAccess helpers that return resolved context
├── channelScope.ts   # realtime fan-out target resolvers
├── ordering.ts       # sort keys + lockX helpers (optional)
├── storage.ts        # object-storage ops (optional)
├── createFoo.ts      # one operation per file
└── listFoo.ts
```

Reference shapes: `services/resources/` (single `schemas.ts`, `resourceAuth.ts`, `channelScope.ts`, `ordering.ts`) and `services/decision/` (`schemas/` dir).

- One operation per file. The file's single named export has the same name as the file, and there are no default exports.
- Consumers import from `@op/common` (server) or `@op/common/client` (client-safe), never from the op file.
- Shared helpers go in `utils.ts` / `<feature>Auth.ts` / etc., not in an op file. A single helper doesn't earn its own file: list `utils/` first, and consider deleting a wrapper that only names one expression.
- `export * from './x'` exports everything in that file. When it holds internals, re-export by name (`export { categoryTermUri } from './proposalTaxonomy'`).
- If a promoted helper relies on a caller contract that types can't express, document that contract in JSDoc.
- Never put I/O in `utils.ts`, and never expose `db` from a service.

## Operation shape

```ts
export const createCollection = async ({
  authUserId,
  profileId,
  name,
}: {
  authUserId: string;
  profileId: string;
  name: string;
}): Promise<CollectionDTO> => {
  await assertProfileTypeAccess({ ... });          // 1. assert first, before any DB work
  return db.transaction(async (tx) => {             // 2. multi-row writes in a transaction
    await lockProfile({ tx, profileId });           // 3. feature lock helper, never raw pg_advisory_xact_lock
    const [collection] = await tx.insert(resourceCollections).values({ name }).returning();
    if (!collection) throw new ConflictError('Failed to create collection');
    const link = await appendCollectionToProfile({ tx, profileId, collectionId: collection.id });
    return buildCollectionForProfile(collection, link);
  });
};
```

- Use a named-params object and an explicit return type, and throw Common errors only (see code-conventions).
- Assert access before any DB write. A public read takes `user?: AccessUser` and folds via access-control.
- Use `db.transaction` only when two or more rows must stay consistent.
- Don't take a flag that changes which rows come back. Split the op instead. A flag that opts into a cost (a correlated COUNT, an extra join) is fine if you can name the callers that would otherwise pay for it.
- Store only the id when the id is all you need.

## `<feature>Auth.ts`

Wrap `assertProfileAccess` / `assertProfileTypeAccess` with the feature's lookup and return the resolved context, so the op doesn't fetch again:

```ts
const { parentProfileId } = await assertCollectionAccess({ user, collectionId, policies });
```

- Don't inline fetch-then-check in an op file. Fold it into an assert that returns the row.
- Don't re-fetch a row the caller or the assert already loaded. Take it as a parameter.
- A read and its write sibling assert the same preconditions through the same helper. If one bad input yields two different error types, one of them is missing an assert.

## Concurrency

- Take locks in sorted id order so they can't deadlock.
- A lock protects nothing you read before the transaction. Re-read the guard's inputs inside it.
- A lock only serializes writers that take the same lock. Name the concurrent writer and match what it locks: a plain `UPDATE` takes a row lock, so use `SELECT … FOR UPDATE` rather than an advisory lock.
- A `lockX` that returns "no row" is reporting a concurrent delete. Surface it (404) instead of discarding it.
- Re-assert every gate (phase, state, claim) in the writing statement's `WHERE`. Treat zero rows updated as a concurrent failure, with its own error message distinct from the JS-check message.
- For inserts, the unique index has to cover every column the JS check covers (see drizzle-migrations). A relationship invariant (no cycles, no chains, one edge per pair) needs an advisory lock over the sorted id pair.
- A dedup or in-progress row written before an external call must be either written after success, rolled back by the transaction, or marked retryable and checked by the early return. Never catch and move on.

## Validation and bounds

- A `*_MAX_BYTES` cap is measured with `new TextEncoder().encode(s).length`, never `String.length`.
- A bound you tighten must still accept stored rows. Grandfather the change, or migrate the rows in the same PR.
- Treat a value read from a cache as untrusted input. `safeParse` it against the shared Zod schema the type derives from (`z.infer`), not with `as`. A cache miss in the middle of a read-modify-write means "cannot patch".
- Custom-form `x-<name>` keywords must also be registered via `ajv.addKeyword` in `schemaValidator.ts`.
- Don't disambiguate two records on a column their write path leaves optional (e.g. `profiles.email`). Use one that's always populated (`slug`).

## Reads and pagination

- Sorting or filtering in JS means the query isn't finished. Push the predicate into SQL and the endpoint input. Never filter client-side after paging.
- A secondary read may ship unpaginated, but the PR has to state the expected upper bound and file a follow-up. Re-evaluate it when its audience or realtime refetch trigger changes, and split the query per consumer before paging.
- Paginated services return `Paginated<T>` (`{ items, next }`) from `@op/common` (ADR-0003).
- The cursor carries an id tie-breaker: `orderBy [desc(createdAt), desc(id)]`, compared lexicographically.
- Gate the next cursor on `cursorValue != null`, not truthiness (a score of 0 is valid).
- A bulk read (export, backfill, digest) loops until `next` is null. When it detects truncation, surface it through the flag the UI renders, not a log line. Name any hard `limit` cap where it's applied.
- When resolving "the newest" row, filter to candidates whose config parent (phase, category, template) still exists before ordering.
- Run independent reads with `Promise.all`. For a provider with per-request caps, chunk under the cap and use `pMap` with a named concurrency constant in `constants.ts`.
- When a scope resolver knows the result is empty, return `isEmpty` and skip the main query.
- Use a join only when no per-row privacy flag needs evaluating. Anonymous-author checks need the nested query (see access-control redaction).
- Share one visibility/moderation predicate builder across sibling reads. Fold a new arm into it, not beside it.
- Query syntax (`db.query`, `{ in }`, fallbacks, page-then-hydrate) is owned by [drizzle-migrations](../drizzle-migrations/SKILL.md).

## Side outputs

- Generated CSV/spreadsheet cells that start with `= + - @`, tab or CR must be escaped where the cell string is built (e.g. `csv-stringify`'s `escape_formulas`). This covers titles, categories, custom-field values and free text.
- An "impossible" branch logs `logger.warn` when it fires. Keep it separate from the expected-absence case.
- Changing a content-key or cache-key format busts the cache. Say in the PR which entries re-derive.

## Channels

The service does the work, and the router registers channels. A mutation that fans out exports a `channelScope.ts` resolver, and the router snapshots scopes before the write. Wiring rules are in [realtime-channels](../realtime-channels/SKILL.md).

See [references/lessons.md](references/lessons.md) for the PR history behind these rules.

## Review checklist

- [ ] One op per file, named export matching filename, named params, explicit return type
- [ ] Access asserted before any write; fetch+check lives in `<feature>Auth.ts` and returns context
- [ ] No re-fetch of rows the caller/assert already has
- [ ] Multi-row writes in a transaction; locks via `lockX`, sorted, matching the concurrent writer
- [ ] Guard inputs re-read inside the transaction; gates re-asserted in the write's `WHERE`
- [ ] Zero-rows / lock-miss paths surfaced with their own error
- [ ] Byte caps use `TextEncoder`; tightened bounds accept stored rows
- [ ] Cache reads `safeParse`d against the shared schema
- [ ] No in-memory sort/filter of a paged set; unpaginated reads state their bound
- [ ] Cursor has id tie-breaker and `!= null` gate; bulk reads consume every page
- [ ] CSV output escapes formula prefixes
- [ ] `utils.ts` pure; barrel re-exports by name when the file has internals
- [ ] Query syntax per drizzle-migrations; channels per realtime-channels
