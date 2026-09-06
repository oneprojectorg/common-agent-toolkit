---
name: api-endpoints
description: How to add or change a tRPC API endpoint in services/api — one procedure per file merged with mergeRouters, the 4-tier procedure model (networkAuthenticatedProcedure / authenticatedConfirmedProcedure / authenticatedProcedure / openProcedure), Zod .input() from @op/common/client schemas, .output() via encoders, schemas live in @op/common (never hand-rolled DTOs), types consumed via @op/api/encoders (never RouterOutput), thin routers that delegate to @op/common services, and realtime channel registration instead of manual invalidation. Input-schema traps — an optional id-like string needs .min(1) or '' collides with a NULL sentinel, and narrowing an output enum breaks decode of existing rows without a .catch() fallback. Compose list inputs from the shared paginationSchema / createSortable / createPaginatedOutput builders in services/api/src/utils rather than re-declaring cursor, limit and sort per endpoint. Use when adding/editing a query or mutation, a router, an encoder, writing or tightening an input schema, picking the right procedure factory, or wiring auth/channels.
---

## Where things live

- `services/api/src/routers/<domain>/` — one procedure per file, plus an `index.ts` that merges them with `mergeRouters`.
- `services/api/src/encoders/` — Zod encoders (frontend-facing wire shapes) + their exported `z.infer` types. Built from `createSelectSchema(<drizzle table>)`, extended where needed.
- `packages/common/src/services/<feature>/schemas.ts` (or `schemas/`) — **input** Zod schemas + service-layer DTO schemas, re-exported via `@op/common/client`. **This is where new schemas go**; do not invent ad-hoc shapes in encoders. Single-file is the default; a `schemas/` directory is used when the file would otherwise be unwieldy (`packages/common/src/services/decision/schemas/` is the canonical example).
- `services/api/src/trpcFactory.ts` — the procedure factories (the 4-tier model below) and `router` / `mergeRouters`.
- `services/api/src/middlewares/` — `withNetworkAuthenticatedUser`, `withConfirmedUser`, `withAuthenticatedUser`, `withResolvedUser`, `withRequestCache`, `withChannelMeta`, `withRateLimited`, etc.

Business logic does **not** live here. It lives in `@op/common` services (`packages/common/src/services/...`). The procedure validates, declares channels, calls the service, and encodes the output. Authorization is asserted in the service — see the `access-control` skill.

**No DB access at the router level.** A router must not `import` from `@op/db` or run a query / transaction directly — that is a service concern. PR #1480 review, on a router that pulled in the DB directly: "We never pull in the DB to the router level (or at least never should)" and "Everything below this should be in a service instead." Resolution replaced a fat base64 router with thin sign/update routers that delegate to `@op/common` services.

## The 4-tier procedure model

`commonAuthedProcedure` was renamed in PR #1240. There are now four factories, each declaring the endpoint's auth posture at the type level:

| Factory | Caller admitted | Use when |
|---|---|---|
| `networkAuthenticatedProcedure()` | Closed-network: confirmed `@oneproject.org` / allow-listed user. **Replaces `commonAuthedProcedure`.** | The endpoint requires an in-network user (most internal mutations and reads today). |
| `authenticatedConfirmedProcedure()` | Any confirmed, non-anonymous account (real email/phone). | Endpoint requires a real account but not network membership. |
| `authenticatedProcedure()` | Any user, **including anonymous Supabase sessions**. No network gating; auth is deferred to the service. | Endpoint mutates on behalf of a logged-in user (anonymous or not). Pair with explicit service-layer assertions. |
| `openProcedure()` | No JWT required. Resolves `ctx.user` *if present*, otherwise leaves it `undefined`. | Public reads of public-by-design resources (e.g. public decisions). Service must `resolveAccessUserIds` and gate every fetch. |

Pass `{ rateLimit: { windowSize, maxRequests } }` to override the 10 req / 10 s default — but only with a specific reason. Reviewers push back on custom rate limits added by reflex; rely on the factory default unless the endpoint genuinely needs a different budget. PR #1580: "We don't need a custom rate limit here, I think. We can just use the default one." The factories already compose `withRequestCache` → `withChannelMeta` → `withLogger` → `withRateLimited` → (tier middleware) → `withAnalytics`.

Never hand-roll `t.procedure` — go through a factory so middleware ordering stays consistent.

### Picking the tier

Default to **`networkAuthenticatedProcedure`** unless you're consciously opening access. When you do open access, do it deliberately:

- Migrate a procedure **down** the ladder (e.g. network → open) only when access-tier gating tests prove the service still fails closed for out-of-network callers. See the `test-conventions` skill on `describeAccessTierGating`.
- `openProcedure` means `ctx.user` is `AccessUser | undefined`. Every downstream call into `@op/common` services must accept `user?: AccessUser` and use `resolveAccessUserIds(user)` to fold the public sentinel into the auth-user filter — never let `undefined` drop the filter (Drizzle silently skips `undefined` conditions, which is the fail-open trap).

## Anatomy of a procedure

```ts
import { Channels, getPosts as getPostsService } from '@op/common';
import type { ChannelName } from '@op/common';
import { getPostsSchema } from '@op/common/client';
import { z } from 'zod';

import { postsEncoder } from '../../encoders';
import { networkAuthenticatedProcedure, router } from '../../trpcFactory';

const outputSchema = z.array(postsEncoder);

export const getPosts = router({
  getPosts: networkAuthenticatedProcedure()
    .input(getPostsSchema)
    .output(outputSchema)
    .query(async ({ input, ctx }) => {
      const posts = await getPostsService({ ...input, authUserId: ctx.user.id });

      const channels: ChannelName[] = [];
      if (input.profileId) channels.push(Channels.profilePosts(input.profileId));
      if (channels.length > 0) ctx.registerQueryChannels(channels);

      return outputSchema.parse(posts);
    }),
});
```

For an `openProcedure`, `ctx.user` may be `undefined`. Pass it through as `user` (not `authUserId`) and let the service handle the public-sentinel fold:

```ts
listProposals: openProcedure()
  .input(proposalFilterSchema)
  .output(proposalListSchema)
  .query(async ({ ctx, input }) => {
    const result = await listProposals({ input, user: ctx.user });
    ctx.registerQueryChannels([Channels.decisionProposals(input.processInstanceId)]);
    return proposalListSchema.parse(result);
  }),
```

See `services/api/src/routers/posts/getPosts.ts` and `services/api/src/routers/decision/proposals/list.ts` for canonical examples.

## File layout

- **One procedure per file**, named for the procedure (`getPosts.ts`, `createPost.ts`).
- Merge them in the domain `index.ts` with `mergeRouters`:
  ```ts
  export const postsRouter = mergeRouters(createPost, getPost, getPosts, listProfilePosts);
  ```
- Register the domain router in `services/api/src/routers/index.ts`.
- When an existing procedure file is getting unwieldy (review feedback: "listProposals is too big — split out a new procedure"), prefer adding a new procedure over piling on flags. Keep the legacy procedure calling the old code path; new code goes in the new procedure.
- **Before adding a new procedure, check whether an existing one already covers the case** — client-side concepts often collapse to one server-side type, so no backend change is needed. PR #1511 self-review: reporting a comment reused the existing `moderation.flagItem` mutation with `itemType: 'post'` (comments are posts server-side), the same async flow the proposal-header Report action already used — no new endpoint.

## Input and output schemas

### Input — from `@op/common/client`

Input schemas live in `packages/common/src/services/<feature>/schemas.ts` (or `schemas/<name>.ts` for larger features like `decision`) and re-export via `@op/common/client`. **Do not invent DTOs or ad-hoc Zod shapes in encoders or routers** — push the schema down to `@op/common`. Reviewers actively migrate hand-rolled router-only schemas down; new code should land there from day one.

```ts
// packages/common/src/services/resources/schemas.ts
import { resources } from '@op/db/schema';
import { createSelectSchema } from 'drizzle-zod';

export const resourceSchema = createSelectSchema(resources);
```

```ts
// services/api/src/routers/resources/collections/create.ts
import { collectionSchema, createCollection } from '@op/common';
//                  ^ schema imported from @op/common, not from encoders
```

**Evolve existing input schemas additively.** A new field on an already-shipped input schema should be optional, and its JSDoc/comment must state what an *absent* value means so pre-existing callers and data keep working through a defined fallback. PR #1532: `'x-phase'?: string` — "When absent, the form applies to the process's initial (submission) phase"; `getForProfile` added optional `phaseId` / `initialPhaseId` documented as legacy, phase-agnostic behavior. Don't make a new field required (it breaks old callers) or leave empty-value semantics implicit.

**Compose a list endpoint's input from the shared builders in `services/api/src/utils/index.ts`, don't re-declare cursor / limit / sort.** `paginationSchema` (`cursor: z.string().nullish()`, `limit: z.number().min(1).max(PAGE_LIMIT.max).default(25)`), `createSortable([...])`, `sortDir` and `createPaginatedOutput(itemSchema)` already exist; merge them rather than hand-listing the same three fields with a different bound each time. PR #1968 review, on the `limit` line: *"This would be a good default for most API inputs."* A hand-rolled `limit: z.number().optional()` is how one endpoint ends up unbounded while its siblings cap at 25.

```ts
const inputSchema = z.object({ profileId: z.string() }).merge(paginationSchema);
const outputSchema = createPaginatedOutput(proposalEncoder);
```

**An optional id-like string input needs `.min(1)` — `''` is not "absent".** `z.string().optional()` accepts the empty string, which then flows into the query as a real value: `WHERE phase_id = ''` instead of `IS NULL`. Where the column uses NULL as a sentinel and a `COALESCE(phase_id, '')` unique index, the two representations collide in the index but not in the application — `COALESCE('', '') = COALESCE(NULL, '') = ''`, so an insert hits `ON CONFLICT DO NOTHING` against the existing NULL row while the follow-up `WHERE phase_id = ''` finds nothing and throws a spurious `NotFoundError`. The read and delete siblings fail the same way, silently returning zero rows / `{ removed: false }`.

```ts
phaseId: z.string().min(1).optional(),   // ✅ absent means absent
phaseId: z.string().optional(),          // ❌ '' sneaks past as a distinct value
```

PR #1679 shipped this across `addCategoryReviewer`, `removeCategoryReviewer`, and `listCategoryReviewers` — **when you tighten one, tighten every sibling procedure over the same column in the same PR.** PR #1690 then folded the tightened field into the shared schema so new endpoints inherit it.

**Narrowing an enum on an output encoder is a data-compatibility change, not a cleanup.** Dropping retired values from a `z.enum([...])` makes every pre-existing DB row carrying one of them fail to decode at `.parse()` — a 500 on read, not a validation warning. Before you narrow, either confirm no production row holds the retired value or give the field a `.catch()` fallback the way sibling fields do. PR #1666: "Safe to merge **if** the team can confirm no production rows carry `reviewsPolicy: 'self_selection'` or `'random_assignment'`; those rows would now fail to decode since `config` has no `.catch()` fallback … the test helpers did create such rows against a real database, and the old API accepted them as valid inputs."

**Mirror a sibling endpoint's filter schema instead of re-listing filters.** When a new endpoint is a sibling of an existing one over the same data (a map alongside a list, an export alongside a table), derive its input from the sibling's filter schema minus the pagination fields (`.omit({ cursor: true, limit: true })`) rather than hand-listing the filters again. PR #1553 self-review: input mirrors `proposalFilterSchema` minus `cursor`/`limit`, so the map applies the same category/status/ballot filters the list does — keeps the two from silently drifting out of filter parity.

### Output — always an encoder

`.output()` is always an encoder from `services/api/src/encoders/` (or a `z.array(...)` / composition of one). End the handler with `outputSchema.parse(result)` so the response is validated and stripped to the encoder shape.

**When you add a field to an output shape, update every encoder the result flows through — the strip is silent.** tRPC's output `parse` drops any field the encoder doesn't list, so a service that now returns `previewText` renders blank on the client if the encoder still lists only `documentContent`. There's no error — the field just vanishes over the wire. After changing an output shape, trace every encoder that reads through it and add a regression test asserting the new field survives. PR #1551: "This encoder only listed `documentContent`, so tRPC output parsing was silently stripping the preview and every results-page card would have rendered blank."

**Build encoders with `createSelectSchema`** from drizzle-zod, then `.extend(...)` for computed/joined fields. The Drizzle schema is the source of truth for the row shape; an encoder that handwrites every field will drift the first time someone adds a column.

```ts
import { resources } from '@op/db/schema';
import { createSelectSchema } from 'drizzle-zod';

const resourceSelect = createSelectSchema(resources);
export const resourceEncoder = z.object({
  ...resourceSelect.shape,
  signedUrl: z.string().nullable(),  // computed at the API layer
});
```

A few encoders intentionally duplicate a `@op/common` schema's shape (e.g. `services/api/src/encoders/resources.ts` has a header comment "do not collapse this into a re-export"). That's a deliberate wire-stability choice — read the comment before flattening.

**Reuse a sibling endpoint's output schema when it renders the same client type.** When a new endpoint renders the same client type as an existing one (e.g. a map view of the same Proposal the list already returns), reuse the existing endpoint's full output schema — leave the heavy fields unset rather than defining a separate leaner client-side shape. PR #1553 self-review: output reuses the full `proposalSchema` (heavy fields simply left unset) so the map renders the same `Proposal` type the list produces — no separate client-side shape to keep in sync.

**List endpoints stay slim — return only the fields consumers actually render, and skip the expensive per-row data (document fetches, relationship counts, vote counts) they don't.** The encoder/schema is the enforcement point: a list encoder should `.omit(...)` or simply not include heavy derived fields so no query can quietly re-add the cost. PR #1563 ("Omit data from listProposals"): "We are returning too much data with the listProposals endpoint. This omits that data." PR #1553 added a slim variant with only the columns pins/hovercards need. When a caller needs a lighter payload, prefer a separate slim procedure/encoder over widening the heavy one.

For a list card that needs *some* of the heavy content, compute a **lightweight server-side preview** (e.g. `buildProposalListPreview` → `previewText`) and drop the full field from list rows entirely, keeping it only on the single-item read. PR #1551: "list rows no longer need to ship fragments at all"; `documentContent` is omitted on list rows, still present on the single-proposal read.

**Narrow relation / lateral-join column selects to exactly the fields the encoder encodes.** A `with: { … }` relation or a `LEFT JOIN LATERAL json_agg` that select-alls will drag heavyweight unencoded columns (a generated `tsvector` search column, large blobs) into both the query and the payload. Constrain the relation's `columns` to the encoder's shape. PR #1551: `proposalProfileColumns` narrows the `submittedBy`/profile relation selects to just the columns `proposalProfileSchema` encodes — dropping the generated search `tsvector` from the lateral joins and the payload.

**Keep a privileged list option out of the public input schema.** When a list endpoint has an internal-only flag (e.g. `includeDocumentContent` that returns full content), *omit it from the `.input()` Zod schema* rather than adding it as an optional field — Zod strips unknown keys, so an external tRPC client can't set it, while internal server callers pass it directly to the service. PR #1551: `includeDocumentContent` is absent from `proposalFilterSchema`, so a client can't pull full documents on the list endpoint.

### Types come from encoders, never `RouterOutput`

- An encoder is a Zod schema plus its exported `z.infer` type:
  ```ts
  export const organizationEncoder = createSelectSchema(organizations).extend({ /* ... */ });
  export type Organization = z.infer<typeof organizationEncoder>;
  ```
- Consumers (the frontend) import the type from `@op/api/encoders` (e.g. `import type { Organization } from '@op/api/encoders'`).
- **Never derive types from `RouterOutput['x']['y']`.** It couples callers to the router shape and breaks on refactor. Need a type that doesn't exist? Add/extend the encoder and export its `z.infer` type — don't reach for `RouterOutput` as a shortcut.

### Auth-sensitive fields are filtered at the encoder, not at every consumer

When a row carries fields that should only ever be returned to certain callers (phone number, email-change pending state, `is_anonymous`, internal flags), **strip them at the encoder** — that's the single point every consumer must pass through, so a leak can't be reintroduced by a future query that forgets to omit the column. PR #1297 review: "One reason for previously not adding this in prior is that it makes it way too easy to leak details related to auth to other users (including things that might be auth only like phone number). Any reason it was added here?" Resolution: "We should fix this in the encoder/schema level I think."

Practically: define a base encoder that omits the sensitive fields (`publicUserEncoder = createSelectSchema(users).omit({ phone: true, ... })`) and a separate `privateUserEncoder` for the self-only endpoints. The two encoders make the auth boundary visible in the type graph — a procedure that returns the public shape can't accidentally leak a private field, because the type itself doesn't carry it.

### Cast discipline

Cast as **close to the DB query as possible** — a single consistent cast that lives next to where data enters the typed system. Casting the same JSON column at every consumer is a recurring review-rejection pattern. If `instanceData` (or any JSON field) needs a stricter type than Drizzle infers, narrow it once at the schema/service layer and let the rest of the code be strictly typed downstream. **Don't treat JSON DB fields as untyped** — they're not typed at the DB level, but they should be typed in TypeScript.

## Authorization

The procedure tier proves the caller's auth class (network / confirmed / anonymous / none). **Resource-level authorization is still required** — assert the user can act on *this* org / profile / decision in the `@op/common` service.

- Inside an authenticated procedure, pass `authUserId: ctx.user.id` into services that take `authUserId`.
- Inside `openProcedure`, pass `user: ctx.user` (`AccessUser | undefined`) into services that take `user`. Services then resolve the public-user fold via `resolveAccessUserIds`.
- Use the assertion utilities (`assertProfileAccess`, `assertOrgAccess`, `assertProfileAdmin`) — see the `access-control` skill. They return the resolved access user so you can reuse the result without re-fetching.

## Cache invalidation = realtime channels, never manual

Invalidation is push-based. The client (`apps/app/src/components/QueryInvalidationSubscriber.tsx`) subscribes to channels and invalidates the matching query keys automatically — both for the local mutation and for changes pushed from other clients over the websocket.

- **Query** declares the channels it depends on: `ctx.registerQueryChannels([Channels.profilePosts(input.profileId)])`.
- **Mutation** declares the channels it affects: `ctx.registerMutationChannels([Channels.profilePosts(input.profileId)])`.
- Channel builders live in `packages/common/src/realtime/channels/channels.ts`.

A query and the mutations that change its data must register the **same** channel, or the UI won't refresh. If data isn't updating after a mutation, the fix is a missing/mismatched channel — **never** a manual `queryClient.invalidateQueries(...)` / `utils.x.invalidate()` on the client.

**Don't over-register on mutations either.** Reviewers will push back on excessive channel lists ("a delete doesn't need `Channels.collectionResources(id)` if nothing reads it"). Register the channels the affected queries actually subscribe to, not every channel the mutation could plausibly affect.

**`await` a server-side cache purge inside the mutation — never fire-and-forget it.** This is separate from realtime channels: when a mutation invalidates a *server-side* durable cache (e.g. the `getMyAccount` user cache), the client fires its own query invalidation the moment the mutation resolves, so a fire-and-forget server purge races that refetch and re-serves the stale value. `await` the purge before the handler returns. PR #1556: "the `await` matters … fire-and-forget would re-serve the stale cached user. Matches the awaited pattern in `completeOnboarding` and `switchProfile`."

## Drizzle queries: prefer relational (RBQ v2) over imperative

Reach for `db.query.<table>.findFirst / findMany` with `{ where, with, columns, orderBy }` before reaching for `db.select().from().where()`. The relational API is the codebase's direction (PR #1244 migrated access-user lookups to RBQ v2; reviewers ask for it on new code).

```ts
// Prefer — object-literal filters, explicit columns
const row = await tx.query.resourceCollectionItems.findFirst({
  where: { collectionId, resourceId, deletedAt: { isNull: true } },
  columns: { id: true, position: true },
});

// Over — imported eq / isNull, select-all
const [row] = await tx.select().from(resourceCollectionItems)
  .where(and(
    eq(resourceCollectionItems.collectionId, collectionId),
    eq(resourceCollectionItems.resourceId, resourceId),
    isNull(resourceCollectionItems.deletedAt),
  )).limit(1);
```

Four things to keep in mind — the `drizzle-migrations` skill has the full version with reference sites:

1. **Filters are object literals.** Use `notifiedAt: { isNotNull: true }`, `acceptedOn: { isNull: true }`, `email: { ilike: pattern }`, `role: { inArray: [...] }`. Don't import `eq` / `isNotNull` / `ilike` / `inArray` from `drizzle-orm` to use inside a `where`.
2. **Fall back to `db.select`** only when RBQ can't express the query (PostGIS, raw `sql` projections, CTEs, custom joins on computed expressions). Leave a one-line comment explaining *why*. Canonical fallback: `resolveBoundary.ts:27-40` (`ST_Contains`).
3. **Row types** come from `typeof <table>.$inferSelect`, not `InferModel<typeof <table>>`.
4. **Project columns** with `columns: { foo: true }` when you only need a couple of fields — don't pull the whole row and throw most of it away.

Writes (`db.insert` / `db.update` / `db.delete`) stay imperative; this preference is about the read path.

## Function and parameter naming

- Service / query functions: `get*` for "returns a value, pure-ish" (`getProposalsForPhase`, `getReviewsGroupedByRecommendation`). The `get` prefix differentiates from `update*` / `set*` / `create*` and removes ambiguity about whether a call mutates. Reviewers flag bare `proposalsForPhase()` as unclear.
- Naming consistency over brevity: `maxVotesPerMember` (leaves room for `maxVotesPerOrganization`), not `maxVotes`.
- No acronyms / abbreviations: write `authorization`, not `authz`; `description`, not `desc`. Reviewer: "let's just use the few extra characters to make this shortening clear."
- Don't prefix the normal case with "New" — only legacy cases get "Legacy". `DecisionHeader` and `LegacyDecisionHeader`, not `NewDecisionHeader` and `DecisionHeader`.
- For service functions with more than one parameter, **use all named parameters** in a single options object (`{ user, profileId, permissions }`). Don't mix one positional + one named object — reviewers consistently ask to switch to all-named.

## Don't

- **Don't put business logic in the router, and never touch the DB from it.** No `@op/db` import, no direct query / transaction in a router — delegate to a `@op/common` service (PR #1480: "We never pull in the DB to the router level").
- **Don't skip `.output()`** or return raw DB rows. Always encode + `parse`.
- **Don't derive types from `RouterOutput`.** Use encoder `z.infer` types from `@op/api/encoders`.
- **Don't manually invalidate queries.** Register channels on the query and the mutation.
- **Don't trust the procedure tier as authorization.** Assert the resource scope in the service.
- **Don't hand-build procedures** with `t.procedure` — use the factory matching the tier.
- **Don't invent router-only DTOs.** Push the schema down to `packages/common/src/services/<feature>/schemas/` and import from `@op/common/client`.

## Verify

Run `pnpm w:api typecheck` after changing procedures, and `pnpm w:app typecheck` if you touched encoders consumed by the frontend.
