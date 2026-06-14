---
name: api-endpoints
description: How to add or change a tRPC API endpoint in services/api — one procedure per file merged with mergeRouters, the 4-tier procedure model (networkAuthenticatedProcedure / authenticatedConfirmedProcedure / authenticatedProcedure / openProcedure), Zod .input() from @op/common/client schemas, .output() via encoders, schemas live in @op/common (never hand-rolled DTOs), types consumed via @op/api/encoders (never RouterOutput), thin routers that delegate to @op/common services, and realtime channel registration instead of manual invalidation. Use when adding/editing a query or mutation, a router, an encoder, picking the right procedure factory, or wiring auth/channels.
---

## Where things live

- `services/api/src/routers/<domain>/` — one procedure per file, plus an `index.ts` that merges them with `mergeRouters`.
- `services/api/src/encoders/` — Zod encoders (frontend-facing wire shapes) + their exported `z.infer` types. Built from `createSelectSchema(<drizzle table>)`, extended where needed.
- `packages/common/src/services/<feature>/schemas.ts` (or `schemas/`) — **input** Zod schemas + service-layer DTO schemas, re-exported via `@op/common/client`. **This is where new schemas go**; do not invent ad-hoc shapes in encoders. Single-file is the default; a `schemas/` directory is used when the file would otherwise be unwieldy (`packages/common/src/services/decision/schemas/` is the canonical example).
- `services/api/src/trpcFactory.ts` — the procedure factories (the 4-tier model below) and `router` / `mergeRouters`.
- `services/api/src/middlewares/` — `withNetworkAuthenticatedUser`, `withConfirmedUser`, `withAuthenticatedUser`, `withResolvedUser`, `withRequestCache`, `withChannelMeta`, `withRateLimited`, etc.

Business logic does **not** live here. It lives in `@op/common` services (`packages/common/src/services/...`). The procedure validates, declares channels, calls the service, and encodes the output. Authorization is asserted in the service — see the `access-control` skill.

## The 4-tier procedure model

`commonAuthedProcedure` was renamed in PR #1240. There are now four factories, each declaring the endpoint's auth posture at the type level:

| Factory | Caller admitted | Use when |
|---|---|---|
| `networkAuthenticatedProcedure()` | Closed-network: confirmed `@oneproject.org` / allow-listed user. **Replaces `commonAuthedProcedure`.** | The endpoint requires an in-network user (most internal mutations and reads today). |
| `authenticatedConfirmedProcedure()` | Any confirmed, non-anonymous account (real email/phone). | Endpoint requires a real account but not network membership. |
| `authenticatedProcedure()` | Any user, **including anonymous Supabase sessions**. No network gating; auth is deferred to the service. | Endpoint mutates on behalf of a logged-in user (anonymous or not). Pair with explicit service-layer assertions. |
| `openProcedure()` | No JWT required. Resolves `ctx.user` *if present*, otherwise leaves it `undefined`. | Public reads of public-by-design resources (e.g. public decisions). Service must `resolveAccessUserIds` and gate every fetch. |

Pass `{ rateLimit: { windowSize, maxRequests } }` to override the 10 req / 10 s default. The factories already compose `withRequestCache` → `withChannelMeta` → `withLogger` → `withRateLimited` → (tier middleware) → `withAnalytics`.

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

### Output — always an encoder

`.output()` is always an encoder from `services/api/src/encoders/` (or a `z.array(...)` / composition of one). End the handler with `outputSchema.parse(result)` so the response is validated and stripped to the encoder shape.

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

### Types come from encoders, never `RouterOutput`

- An encoder is a Zod schema plus its exported `z.infer` type:
  ```ts
  export const organizationEncoder = createSelectSchema(organizations).extend({ /* ... */ });
  export type Organization = z.infer<typeof organizationEncoder>;
  ```
- Consumers (the frontend) import the type from `@op/api/encoders` (e.g. `import type { Organization } from '@op/api/encoders'`).
- **Never derive types from `RouterOutput['x']['y']`.** It couples callers to the router shape and breaks on refactor. Need a type that doesn't exist? Add/extend the encoder and export its `z.infer` type — don't reach for `RouterOutput` as a shortcut.

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

## Drizzle queries: prefer relational (RBQ) over imperative

Reach for `db.query.<table>.findFirst / findMany` with `{ where, with, columns, orderBy }` before reaching for `db.select().from().where()`. The relational API is the codebase's direction (PR #1244 migrated access-user lookups to RBQ v2; reviewers ask for it on new code).

```ts
// Prefer
const row = await tx.query.resourceCollectionItems.findFirst({
  where: { collectionId, resourceId },
});

// Over
const [row] = await tx.select().from(resourceCollectionItems)
  .where(and(eq(..., ...), eq(..., ...))).limit(1);
```

Imperative `db.select().from()` is fine when you need a SQL feature RBQ doesn't expose (CTEs, custom joins on computed expressions, raw subqueries) — but it's the exception, not the default.

## Function and parameter naming

- Service / query functions: `get*` for "returns a value, pure-ish" (`getProposalsForPhase`, `getReviewsGroupedByRecommendation`). The `get` prefix differentiates from `update*` / `set*` / `create*` and removes ambiguity about whether a call mutates. Reviewers flag bare `proposalsForPhase()` as unclear.
- Naming consistency over brevity: `maxVotesPerMember` (leaves room for `maxVotesPerOrganization`), not `maxVotes`.
- No acronyms / abbreviations: write `authorization`, not `authz`; `description`, not `desc`. Reviewer: "let's just use the few extra characters to make this shortening clear."
- Don't prefix the normal case with "New" — only legacy cases get "Legacy". `DecisionHeader` and `LegacyDecisionHeader`, not `NewDecisionHeader` and `DecisionHeader`.
- For service functions with more than one parameter, **use all named parameters** in a single options object (`{ user, profileId, permissions }`). Don't mix one positional + one named object — reviewers consistently ask to switch to all-named.

## Don't

- **Don't put business logic in the router.** Delegate to a `@op/common` service.
- **Don't skip `.output()`** or return raw DB rows. Always encode + `parse`.
- **Don't derive types from `RouterOutput`.** Use encoder `z.infer` types from `@op/api/encoders`.
- **Don't manually invalidate queries.** Register channels on the query and the mutation.
- **Don't trust the procedure tier as authorization.** Assert the resource scope in the service.
- **Don't hand-build procedures** with `t.procedure` — use the factory matching the tier.
- **Don't invent router-only DTOs.** Push the schema down to `packages/common/src/services/<feature>/schemas/` and import from `@op/common/client`.

## Verify

Run `pnpm w:api typecheck` after changing procedures, and `pnpm w:app typecheck` if you touched encoders consumed by the frontend.
