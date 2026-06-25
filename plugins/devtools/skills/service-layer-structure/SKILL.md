---
name: service-layer-structure
description: How to organize a feature's service layer in packages/common/src/services/<feature>/ — one file per operation (createX / getX / listX / updateX / deleteX), all named exports, named-params object signatures, auth-assert first, transactions with advisory locks for concurrent ops, Common errors only. Plus the auxiliary file conventions — schemas.ts (Zod + DTO types), constants.ts (shared limits + security allowlists), utils.ts (pure helpers), <feature>Auth.ts (domain assertions that return useful context), channelScope.ts (realtime fan-out helpers), and ordering.ts (sort-key utilities). Use when adding a new service operation, adding a new feature directory under @op/common, organizing helpers around a service file, deciding where a piece of logic belongs, or writing a transaction.
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

## Parallel work

Use `Promise.all` for independent fetches that the function needs to combine:

```ts
const [existing, { collectionIds }] = await Promise.all([
  db.query.resources.findFirst({ where: { id }, with: { attachment: true } }),
  getScopesForResource(id),
]);
```

Don't `await` sequentially when calls are independent. Reviewers will flag this.

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

- **Don't add I/O to `utils.ts`** — utils are pure. Side-effect helpers belong in `<feature>Auth.ts`, `channelScope.ts`, or their own file.
- **Don't expose `db` from a service file** — the service operates on `db`; consumers call the operation. A router never calls `db` directly.
- **Don't inline auth-check + fetch logic** when a `<feature>Auth.ts` would consolidate the pattern. The third inline copy is a merge-blocker.
- **Don't add a flag parameter** to an operation when the use cases are genuinely different. Split into two operations. PR #1084 review: "I like the composable approach more here because the choice is pretty specific to the use-case... not a big fan of the flags approach generally."
- **Don't store more than the id** when you only need the id. A draft cache that stores the entire proposal will drift; one that stores the id stays correct.
- **Don't open-code the lock**. Use the feature's `lockX` helper from `ordering.ts`.
