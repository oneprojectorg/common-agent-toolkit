---
name: service-layer-structure
description: How to organize a feature's service layer in packages/common/src/services/<feature>/ — one file per operation (createX / getX / listX / updateX / deleteX), all named exports, named-params object signatures, auth-assert first, transactions with advisory locks for concurrent ops, Common errors only. Plus the auxiliary file conventions — schemas.ts (Zod + DTO types), constants.ts (shared limits + security allowlists), utils.ts (pure helpers), <feature>Auth.ts (domain assertions that return useful context), channelScope.ts (realtime fan-out helpers), and ordering.ts (sort-key utilities). Cursor pagination rules — always include an id tie-breaker so rows that share a sort-key timestamp don't get skipped, and gate the cursor on `cursorValue != null` so falsy-but-valid sort values (e.g. rubric score 0) keep paging. Resolution rules — when picking one row by recency, filter to candidates whose referenced configuration parent (phase, category, template) still exists, or "newest" can select a dead reference and 404 a resource the caller can actually reach. Concurrency and API-surface rules — re-assert every gate inside the writing statement's WHERE (a JS-only check is a TOCTOU window) and give the concurrent-failure path its own error message; log a warning when an "impossible" branch fires instead of skipping silently; re-export by name rather than `export *` when only one symbol should be public. Use when adding a new service operation, adding a new feature directory under @op/common, organizing helpers around a service file, designing a paginated listX, writing a guarded update, adding to a barrel index.ts, deciding where a piece of logic belongs, or writing a transaction.
---

The service layer in `packages/common/src/services/<feature>/` is the home of the business logic that tRPC routers thinly wrap. Conventions here are the most consistent in the codebase — reviewers spot deviations quickly.

## Directory layout

For a feature `foo`, the directory looks like:

```
packages/common/src/services/foo/
├── index.ts               # barrel — `export * from './<file>'` per export
├── schemas.ts             # Zod schemas + their z.infer DTO types — small features
├── schemas/               # — OR — multi-file split for larger features
│   ├── index.ts
│   ├── foo.ts
│   └── otherFoo.ts
├── constants.ts           # shared limits, allowlists, magic strings
├── utils.ts               # pure helpers (no I/O)
├── fooAuth.ts             # domain-specific assertion helpers (assertFooAccess, etc.)
├── channelScope.ts        # realtime fan-out helpers (getProfileIdsForFoo, etc.)
├── ordering.ts            # (optional) sort-key utilities if the feature is ordered
├── createFoo.ts           # one operation per file
├── getFoo.ts
├── listFoo.ts
├── updateFoo.ts
├── deleteFoo.ts
└── <opName>.test.ts       # colocated Vitest, when present
```

Look at `packages/common/src/services/resources/` (single `schemas.ts`) and `packages/common/src/services/decision/` (`schemas/` directory) for the two valid shapes. Single file is the default; split into a directory when the schema file would otherwise grow past a few hundred lines or hold several unrelated DTO families.

## One file per operation, single named export

Every service operation lives in its own file. The export name matches the file name:

```ts
// packages/common/src/services/resources/createCollection.ts
export const createCollection = async ({ ... }) => { ... };
```

- One named export per file. No `default export`.
- The `index.ts` is a barrel that re-exports every file: `export * from './createCollection'`. Consumers always import from `@op/common`, not from the operation file directly.
- Don't bundle two operations into one file because they share helpers. Pull the helper into `utils.ts` (or `<feature>Auth.ts`, etc.) and keep operations separated.

## Operation function shape

```ts
import { db } from '@op/db/client';
import { EntityType, resourceCollections } from '@op/db/schema';
import { permission } from 'access-zones';

import { ConflictError } from '../../utils/error';
import { assertProfileTypeAccess } from '../access';
import { appendCollectionToProfile, lockProfile } from './ordering';
import type { CollectionDTO } from './schemas';
import { buildCollectionForProfile } from './utils';

export const createCollection = async ({
  authUserId,
  profileId,
  name,
}: {
  authUserId: string;
  profileId: string;
  name: string;
}): Promise<CollectionDTO> => {
  // 1. Auth assert FIRST — fail closed before any DB work.
  await assertProfileTypeAccess({
    user: { id: authUserId },
    profileIds: [profileId],
    policies: { [EntityType.DECISION]: { decisions: permission.ADMIN } },
  });

  // 2. Mutations that touch multiple rows wrap in a transaction.
  return db.transaction(async (tx) => {
    await lockProfile({ tx, profileId });

    const [collection] = await tx
      .insert(resourceCollections)
      .values({ name })
      .returning();
    if (!collection) {
      throw new ConflictError('Failed to create collection');
    }

    const link = await appendCollectionToProfile({
      tx,
      profileId,
      collectionId: collection.id,
    });

    return buildCollectionForProfile(collection, link);
  });
};
```

The rules:

1. **Named-params object signature.** Always. `{ authUserId, profileId, name }`, never `(authUserId, profileId, name)`. See the `code-conventions` skill on parameter shape.
2. **Explicit return type** — `Promise<CollectionDTO>`. Don't rely on inference for the public surface.
3. **Auth assert first.** Any mutation (or any read that's not deliberately public) calls `assertXAccess` before any DB write. Public reads call the corresponding `assertXReadAccess` or the service folds the public sentinel via `resolveAccessUserIds`. See the `access-control` skill.
4. **Transaction for multi-step mutations.** When the operation writes to two or more rows that must stay consistent, wrap in `db.transaction`. Single-row inserts/updates don't need it.
5. **Throw Common errors only** — `UnauthorizedError`, `NotFoundError`, `ValidationError`, `ConflictError`, `ModerationError`, `RateLimitError`. Never raw `Error`; never let `access-zones` exceptions leak. See the `code-conventions` skill.
6. **Comments explain WHY**, not what. Cite the constraint, the invariant, or the prior incident:
   ```ts
   // Listing never creates. The Default collection is created lazily on the
   // first upload (createLink/createDocument -> resolveTargetCollection); until
   // then a profile simply has no collection and we return an empty list.
   ```

## Transactions, locks, and deadlock avoidance

When two operations can mutate overlapping rows concurrently, take advisory locks **in a deterministic order** so they can't deadlock.

```ts
// deleteResource.ts
const sortedCollectionIds = [...collectionIds].sort();

await db.transaction(async (tx) => {
  // Sorted order prevents deadlocks against attach/reorder paths.
  for (const collectionId of sortedCollectionIds) {
    await lockCollection({ tx, collectionId });
  }
  // ... mutations
});
```

- Sort the ids before taking locks. Two operations holding the same sort order can't form a cycle.
- Pull lock helpers into the feature's `ordering.ts` (or equivalent) — don't open-code `pg_advisory_xact_lock`.
- If two services share lockable resources, the lock helper lives in the lower-level service and the higher-level service imports it.

## Re-check every gate inside the write, not just in JavaScript

A precondition checked in JS and enforced by a later `UPDATE` has a window between them. Anything that can change concurrently — a phase advancing, a state transitioning, a row being claimed — must be re-asserted in the **same statement** that writes, as an extra `WHERE` predicate (or a `NOT EXISTS` / lateral subquery when the condition lives on another table). Then treat "zero rows updated" as the concurrency failure.

PR #1703: `updateReview` checked `canEditSubmittedReview` (the assignment's phase must still be the instance's current phase) in JS, but the atomic `WHERE` only guarded `state = SUBMITTED`. "If the instance advances to the next phase in the gap between the JavaScript check and this `UPDATE`, the write succeeds — a reviewer could sneak in one final edit after the review phase is officially closed. The doc-comment on the function promises the review is frozen once the phase advances, so this is a violated contract."

When the JS check and the SQL guard both exist, they fail for **different reasons — give them different error messages.** The JS path means "this was never in an editable state"; the empty-result path means "it was, and something changed underneath us." Reusing one message makes a production incident unreadable. PR #1703: reaching the second path warrants its own `ValidationError('Review state changed concurrently; please refresh and try again')`.

## Don't let an "impossible" branch skip silently

A guard for a case the caller supposedly makes unreachable still needs a `logger.warn` when it fires — otherwise the branch reproduces exactly the bug it was written to prevent, and leaves no trace to diagnose it. Split the genuinely-expected case from the shouldn't-happen case so they're distinguishable in the logs. PR #1677: `reconcileCategoryRename` returned early on a missing new taxonomy term with no log line, so "the result is exactly the orphaning bug this PR fixes: `instanceData` now holds the new label but all existing proposal links still target the old term. At minimum the missing-new-term case should emit a warning so the condition is diagnosable in production." An absent *old* term, by contrast, is normal (nothing was ever tagged) and needs no log.

See the `code-conventions` skill for level selection — an expected-but-recoverable absence is `warn`, not `error`.

## Resolving "the newest one" — filter to rows whose parent still exists

A resolver that picks a single row by recency (`the latest assignment`, `the most recent draft`) assumes every candidate is still resolvable. When those rows reference a **configuration** entity that an admin can remove — a phase, a category, a template — the newest row can point at something that no longer exists, and the resolver hands back a dead reference instead of the perfectly good older row sitting behind it. The caller then fails to resolve the parent's settings and returns a 404 for a resource the user does have access to. PR #1774: "when a reviewer has assignments for the same proposal in multiple phases and the newest assignment belongs to a phase later removed from the instance, this resolver unconditionally selects that assignment … [and] returns a 404 instead of opening another valid assignment for the proposal."

Filter the candidate set to still-valid parents *before* ordering, not after selecting. This is the read-side twin of the `access-control` rule that an authorization path must fail with `UnauthorizedError` rather than propagating a `NotFoundError` from an internal lookup — same root cause (a stale `currentStateId` / removed phase), opposite end of the request.

## Barrel exports widen the public API — re-export by name when only one symbol should be public

`export * from './someFile'` promotes **everything** that file exports, not the one symbol you needed. A side-effecting internal (`ensureProposalTaxonomyTerms`) becoming reachable from `@op/common` is a real API-surface change hiding inside a one-line diff. When a file holds a mix of public and package-internal exports, use a named re-export in `index.ts`:

```ts
export { categoryTermUri } from './proposalTaxonomy';   // ✅ intentional surface
export * from './proposalTaxonomy';                     // ❌ also exports the internals
```

PR #1676 review. Related, from PR #1680: when you *do* promote a helper whose correct use depends on a caller contract the types can't express (e.g. "callers must intersect this with the eligibility set first"), say so in its JSDoc — a publicly-exported footgun is worse than a private one.

## Parallel work

Use `Promise.all` for independent fetches that the function needs to combine:

```ts
const [existing, { collectionIds }] = await Promise.all([
  db.query.resources.findFirst({ where: { id }, with: { attachment: true } }),
  getScopesForResource(id),
]);
```

Don't `await` sequentially when calls are independent. Reviewers will flag this. PR #1320: "Looks like it can all be run in `Promise.all`?" / "Better move into `submitUserFlag` so that we can run in a `Promise.all`."

**Respect each external provider's own per-request limits — don't `Promise.all` the whole list.** When a third-party API caps items per request, split into chunks under that provider's cap and process them with bounded concurrency via `pMap` (it preserves input order, so results reassemble 1:1 by index). Express both the cap and the concurrency as named constants in `constants.ts` documenting the provider — never inline magic numbers. Each provider is independent: OpenL caps texts per request (`OPENL_MAX_TEXTS_PER_REQUEST`, PR #1523); DeepL rejects any request carrying more than 50 text params, so translate one text per request under a bounded `DEEPL_REQUEST_CONCURRENCY` (PR #1533) — don't reuse a batching strategy that happened to work for a different provider.

## Don't re-fetch what the caller already has

When the caller (router, parent service, or `<feature>Auth.ts` assertion) has already fetched the row you need, **take it as a parameter** instead of querying again. PR #1320 review: "We fetched this already upstream."

```ts
// ❌ The router asserted `parentProfileId`. The service refetches it.
export const flagItem = async ({ user, itemId }) => {
  const item = await assertModerationItemAccess({ user, itemId });
  const profile = await db.query.profiles.findFirst({ where: { id: item.parentProfileId } });
  // ...
};

// ✅ The assert returned what's needed. Use it.
export const flagItem = async ({ user, itemId }) => {
  const { item, parentProfile } = await assertModerationItemAccess({ user, itemId });
  // parentProfile already loaded for the auth check; no second query.
};
```

This is why `<feature>Auth.ts` assertions return resolved context (see the `<feature>Auth.ts` pattern above) — so the service doesn't re-query. If you find yourself fetching the same row in both the assert and the operation, fold the assert to return it.

**Short-circuit an always-empty query.** When a scope resolver can determine the result set will be empty before the main query runs (e.g. a phase that hasn't been reached, an unresolved parent), have the helper return an `isEmpty: true` flag and short-circuit — skip issuing the main query entirely instead of running one guaranteed to return nothing. PR #1437.

## Query style — prefer RBQ v2 (`db.query`) over `db.select`

For reads, default to `db.query.<table>.findFirst / findMany` with object-form filters and explicit column projection — every service file under `@op/common` should follow this:

```ts
const rows = await db.query.decisionBoundaries.findMany({
  where: { profileId, taxonomyTermId: { isNotNull: true } },
  columns: { name: true },
});
```

The rules in short — the `drizzle-migrations` skill has the full version with reference sites:

1. **Object-literal filters, not imported operator functions.** Express `eq` / `isNotNull` / `isNull` / `ilike` / `inArray` / range predicates inline (`notifiedAt: { isNotNull: true }`, `acceptedOn: { isNull: true }`, `email: { ilike: pattern }`, `role: { inArray: [...] }`). Don't import `eq` / `isNotNull` / `ilike` from `drizzle-orm` to use inside a `where`. See `listUserInvites.ts:25-28` and `listProfileUserInvites.ts:30` for the pattern.
2. **Fall back to `db.select().from().where()`** only when RBQ genuinely can't express the query — PostGIS / raw `sql` predicates, literal projections (`` sql`1` `` existence probes, `count(*)`, window functions), or CTEs / custom joins. When you fall back, leave a one-line comment explaining *why*. Canonical fallback: `resolveBoundary.ts:27-40` (`ST_Contains`).
3. **Row types come from `typeof <table>.$inferSelect`**, not `InferModel<typeof <table>>`.
4. **Project columns explicitly with `columns: { foo: true }`** when only one or two fields are needed, instead of pulling the whole row and discarding most of it.

Writes (`db.insert` / `db.update` / `db.delete`) stay imperative — RBQ v2 doesn't replace them, and transactions wrapping several statements continue to use those operators on the `tx` handle.

**Push membership into a subquery — don't materialize an ID set in JS.** When a filter scopes rows to a set (phase / snapshot membership), fold it into an inline `inArray(t.id, db.select({ id: other.fkId }).from(other).where(...))` subquery against an indexed column rather than an extra round-trip that builds a JS array and splats it into `WHERE id IN ($7...$506)`. Extract the predicate into a shared builder and flow the same predicate into the parallel `count(*)` query so neither side re-materializes the set. PR #1437 review. For a pure *existence* filter (does a related row exist?), prefer a correlated `EXISTS` subquery over `inArray` — it short-circuits per row and never bounces IDs through JS as bound params. PR #1551: the category filter is "pushed down as a SQL `EXISTS` subquery instead of bouncing every category proposal ID through JS as bound params."

**Page the base-table ids first, then hydrate relations for that page.** For a `listX` that eager-loads relations via `LEFT JOIN LATERAL json_agg`, the laterals are evaluated across the *whole* table before the `limit` prunes — so returning one page of 10 can scan tens of thousands of rows. Do it in two steps: (1) page the bare base-table ids (`order` / `cursor` / `limit` over the existing index), then (2) hydrate relations only for that page with `where id in (pageIds)`, and **re-apply the paged order afterward** since `in` doesn't preserve it. This is the pattern `listPosts` already uses. PR #1516 (`perf(organization)`): eager laterals "evaluated across the whole organizations table before the limit could prune, so returning a single page of 10 scanned ~20,000 rows."

## Cursor pagination — tie-breaker on id, null-safe `cursorValue`

`listX` operations that page over `createdAt` / `updatedAt` / `score` need two rules to be correct under concurrent inserts and falsy-but-valid sort values. PR #1304 (`listProposals` / `listAllProposals` infinite scroll) failed both before review.

### Always add an id tie-breaker to order + cursor

Two rows that share a `createdAt` (same millisecond — yes, this happens) sort un-deterministically when the only `orderBy` is `createdAt`. The cursor for "last row of page N" then matches the next page's start row inclusively/exclusively at random and **skips rows**. Tie-break with the primary key:

```ts
const orderBy = [
  desc(proposals.createdAt),
  desc(proposals.id),  // tie-breaker — no row is "equal to" another
];

// Cursor: (createdAt, id) pair. The where becomes a lexicographic compare:
//   createdAt < cursor.createdAt OR (createdAt = cursor.createdAt AND id < cursor.id)
```

PR #1304: "paging on `createdAt` / `updatedAt` alone skips rows that share a boundary timestamp, which matters now that this endpoint drives results-phase infinite scroll." Mirror this in every new `listX` that supports infinite scroll. Covered by the regression test "does not skip rows that share a boundary timestamp."

### Gate the cursor on `cursorValue != null`, not on truthiness

When deriving the next cursor from the last item of a page, gate on `!= null` — not on a truthy check — because a falsy-but-valid value (a rubric score of `0`, a vote count of `0`, an empty string) is a perfectly fine sort key:

```ts
// ❌ Breaks when sorting on rubric score and the last item's score is 0.
const nextCursor = hasMore && lastItem && cursorValue ? { ... } : null;

// ✅ Falsy values stay paginable.
const nextCursor = hasMore && lastItem && cursorValue != null ? { ... } : null;
```

PR #1304 review (nourmalaeb): "If we sort on rubric scores or something where `cursorValue` can be falsy (e.g the rubric score is `0`) this breaks." Both `listProposals` and `listAllProposals` were hardened to `cursorValue != null` in the same PR.

The same rule extends to any "is there a next page" check: gate on `lastItem` (not undefined) and on `cursorValue != null` (not truthy), separately.

## Auxiliary files — what goes where

| File | Contents | Examples |
|---|---|---|
| `schemas.ts` | Zod schemas (built with `createSelectSchema(<table>)` from drizzle-zod where possible) + their `z.infer` DTO types. Imported from `@op/common/client` by routers. | `resourceSchema`, `ResourceDTO`, `attachmentSummarySchema` |
| `constants.ts` | Limits, allowlists, magic strings shared across operations. Comments explain the reason (mirror to client, security caveat, etc.). | `RESOURCE_TITLE_MAX_LEN`, `ALLOWED_RESOURCE_MIME_TYPES`, `STORAGE_BUCKET` |
| `utils.ts` | Pure helpers (no I/O). Build-DTO, normalize, sort. | `buildCollectionForProfile`, `getNormalizedRoles` |
| `<feature>Auth.ts` | Domain-specific assertion utilities that wrap `assertProfileAccess` / `assertOrgAccess` with feature-aware lookups and **return useful context** (resolved ids, parent profile, etc.) so callers don't re-fetch. | `assertCollectionAccess`, `assertResourceAccess` |
| `channelScope.ts` (or `*Context.ts`) | Helpers that resolve realtime fan-out targets — "which profiles' channels need to invalidate when X changes?" | `getProfileIdsForCollection`, `getScopesForResource` |
| `ordering.ts` | Sort-key / fractional-index utilities + lock helpers for ordered lists. | `appendCollectionToProfile`, `lockProfile`, `lockCollection` |
| `<feature>DTO.ts` | (Optional, when DTOs are large) Decoder functions converting raw DB rows to wire DTOs. | `resourceDTO` |
| `storage.ts` | Object-storage operations (Supabase storage, S3, etc.). | `deleteResourceObject` |

When a new helper doesn't fit any of these, **prefer adding it to `utils.ts` or extracting a new named file**. Don't put it in the operation file.

**Custom JSONSchema keywords are two-sided — register or break.** When you add an `x-<name>` keyword to a custom-form definition schema (`customForm.ts`), you MUST also register it on the AJV instance in `schemaValidator.ts` (`this.ajv.addKeyword('x-<name>')`, alongside `x-field-order` / `x-format` / `x-map-default`). AJV rejects any unregistered custom keyword, so a schema-only change makes validation fail at runtime. PR #1532 added `x-phase` on both sides for exactly this reason.

### The `<feature>Auth.ts` pattern

Domain auth helpers wrap the lower-level `assertProfileAccess` / `assertOrgAccess` and add feature-specific lookup logic. They return the resolved context so the caller doesn't re-query:

```ts
export const assertCollectionAccess = async ({
  user, collectionId, policies,
}: {
  user: { id: string };
  collectionId: string;
  policies: ProfileTypePolicies;
}): Promise<{ parentProfileIds: string[]; parentProfileId: string }> => {
  // Resolve the collection's parents...
  const parentProfileIds = await getProfileIdsForCollection(collectionId);
  if (parentProfileIds.length === 0) {
    throw new NotFoundError('Collection', collectionId);
  }
  // ...then delegate the policy check to the base assert.
  const parentProfileId = await assertAnyParentProfileAccess({ user, parentProfileIds, policies });
  return { parentProfileIds, parentProfileId };
};
```

The pattern lets callers do:

```ts
const { parentProfileId } = await assertCollectionAccess({ user, collectionId, policies });
// parentProfileId reused for `addedBy`, channel fan-out, etc. — no extra fetch
```

This is the "reviewers consistently flag inline fetch-then-check" pattern from PR #1229 in concrete form. **Don't inline fetch + assert** in the operation file.

## Naming the operation function

Use the standard verb prefixes — they're load-bearing for code review:

| Prefix | Means | Examples |
|---|---|---|
| `create*` | Creates a new row / aggregate | `createCollection`, `createPost` |
| `get*` | Returns one record (or null) | `getCollection`, `getProposalById` |
| `list*` | Returns a paginated/multi-record query | `listCollections`, `listProposals` |
| `update*` | Updates a row | `updateCollection`, `updateProposal` |
| `delete*` | Deletes a row | `deleteCollection`, `deleteResource` |
| `attach*` / `detach*` | Adds/removes a join-table row | `attachResourceToCollection` |
| `reorder*` | Moves an ordered item | `reorderCollection`, `reorderResource` |
| `resolve*` | Disambiguates or computes | `resolveOrCreateDefaultCollection`, `resolveTargetCollection` |
| `assemble*` / `build*` | Composes a DTO from parts | `assembleProposalData`, `buildCollectionForProfile` |
| `assert*` | Throws on failure (in `<feature>Auth.ts`) | `assertCollectionAccess` |

A function called `proposalsForPhase()` reads as ambiguous. The same logic named `getProposalsForPhase()` reads as "pure, returns a value." Reviewers will rename.

## Channel registration lives in the router, not the service

The service operation **does the work**. The router **decides which channels to fan invalidations on**. This keeps services testable without a tRPC context, and lets the same service back multiple endpoints with different channel posture.

When a mutation affects many profiles (e.g. a resource attached to a shared collection), the service exports a `channelScope` helper that returns the fan-out targets, and the router maps that into `ctx.registerMutationChannels([...])`. See the `realtime-channels` skill for the channel side.

## Don't

**Changing a content-key / cache-key format is a silent cache bust.** Any value keyed by a derived content-key (memoized translations, computed-DTO caches, hash-addressed rows) is orphaned the moment you change how that key is built — old entries no longer match, so the next access recomputes from scratch. When a PR alters a key format, spell out in the description exactly which entries re-derive and which are untouched. PR #1540 (self-review): the change altered the content-key format for array fields only, so array translations (e.g. category) re-translate once after deploy while scalar keys are unchanged. Scope it tightly and say so — reviewers can't see the blast radius from the diff alone.

- **Don't add I/O to `utils.ts`** — utils are pure. Side-effect helpers belong in `<feature>Auth.ts`, `channelScope.ts`, or their own file.
- **Don't expose `db` from a service file** — the service operates on `db`; consumers call the operation. A router never calls `db` directly.
- **Don't inline auth-check + fetch logic** when a `<feature>Auth.ts` would consolidate the pattern. The third inline copy is a merge-blocker.
- **Don't add a flag parameter** to an operation when the use cases are genuinely different. Split into two operations. PR #1084 review: "I like the composable approach more here because the choice is pretty specific to the use-case... not a big fan of the flags approach generally."
- **Don't store more than the id** when you only need the id. A draft cache that stores the entire proposal will drift; one that stores the id stays correct.
- **Don't open-code the lock**. Use the feature's `lockX` helper from `ordering.ts`.
- **Don't re-implement the visibility filter per read endpoint.** When two reads (e.g. a paginated `listX` and a map/aggregate endpoint) must apply the same access / phase / visibility / moderation filtering, extract the WHERE-clause filter builder into one shared helper both call. If each endpoint hand-rolls its own predicate, what a viewer may see drifts between them and one surface leaks rows the other hides. PR #1553 review: the whole access/phase/visibility/moderation filter builder was lifted out of `listProposals` into a shared helper that both the paginated list and the new map endpoint call.
