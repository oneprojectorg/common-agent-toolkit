---
name: api-endpoints
description: How to add or change a tRPC API endpoint in services/api — one procedure per file merged with mergeRouters, commonAuthedProcedure vs commonProcedure, Zod .input() from @op/types, encoder .output() (types come from encoders, never RouterOutput), thin router that delegates to @op/common services, and realtime channel registration instead of manual invalidation. Use when adding/editing a query or mutation, a router, an encoder, or wiring auth/channels on a procedure.
---

## Where things live

The API layer is `@op/api` (`services/api`). It is a **thin** tRPC layer:

- `services/api/src/routers/<domain>/` — one procedure per file, plus an `index.ts` that merges them.
- `services/api/src/encoders/` — Zod encoders + their exported types (the type source of truth).
- `services/api/src/trpcFactory.ts` — the procedure factories and `router` / `mergeRouters`.
- `services/api/src/middlewares/` — `withAuthenticated`, `withChannelMeta`, `withRateLimited`, etc.

Business logic does **not** live here. It lives in `@op/common` services (`packages/common/src/services/...`). The procedure validates, authorizes, calls the service, declares channels, and encodes the output.

## Anatomy of a procedure

```ts
import { Channels, getPosts as getPostsService } from '@op/common';
import type { ChannelName } from '@op/common';
import { getPostsSchema } from '@op/types';
import { z } from 'zod';

import { postsEncoder } from '../../encoders';
import { commonAuthedProcedure, router } from '../../trpcFactory';

const outputSchema = z.array(postsEncoder);

export const getPosts = router({
  getPosts: commonAuthedProcedure()
    .input(getPostsSchema)      // Zod, from @op/types
    .output(outputSchema)       // an encoder, always
    .query(async ({ input, ctx }) => {
      const posts = await getPostsService({ ...input, authUserId: ctx.user.id });

      const channels: ChannelName[] = [];
      if (input.profileId) channels.push(Channels.profilePosts(input.profileId));
      if (channels.length > 0) ctx.registerQueryChannels(channels);

      return outputSchema.parse(posts);
    }),
});
```

See `services/api/src/routers/posts/getPosts.ts` (query) and `createPost.ts` (mutation) for the canonical pair.

## File layout

- **One procedure per file**, named for the procedure (`getPosts.ts`, `createPost.ts`).
- Merge them in the domain `index.ts` with `mergeRouters`:
  ```ts
  export const postsRouter = mergeRouters(createPost, getPosts, listProfilePosts);
  ```
- Register the domain router in `services/api/src/routers/index.ts`.

## Pick the right procedure

From `trpcFactory.ts`:

- `commonAuthedProcedure()` — the default. Adds channelMeta → logger → rateLimited → authenticated → analytics, and injects `ctx.user`. Pass `{ rateLimit: { windowSize, maxRequests } }` to override the 10-req/10s default.
- `commonProcedure` — unauthenticated; only use for genuinely public endpoints, and add middleware explicitly.

Never hand-roll `t.procedure` in a router file — go through the factory so middleware ordering stays consistent.

## Input and output

- **`.input()`** is a Zod schema. Shared request schemas live in `@op/types`; import from there rather than redefining.
- **`.output()` is always an encoder** from `services/api/src/encoders` (or a `z.array(...)` / composition of one). End the handler with `outputSchema.parse(result)` so the response is validated and stripped to the encoder shape.

### Types come from encoders, never `RouterOutput`

- An encoder is a Zod schema plus its exported `z.infer` type:
  ```ts
  export const organizationsWithProfileEncoder = createSelectSchema(organizations).extend({ /* ... */ });
  export type Organization = z.infer<typeof organizationsWithProfileEncoder>;
  ```
- Because the same encoder is the procedure's `.output()`, the wire type and the exported type can't drift.
- Consumers import the type from `@op/api/encoders` (e.g. `import type { Organization } from '@op/api/encoders'`).
- **Never derive types from `RouterOutput['x']['y']`.** It couples callers to the router shape and breaks on refactor. Need a type that doesn't exist? Add/extend the encoder and export its `z.infer` type — don't reach for `RouterOutput` as a shortcut.
- Build encoders from the Drizzle schema with `createSelectSchema` (drizzle-zod) and `.extend(...)` the computed/joined fields. Re-export new encoders from `services/api/src/encoders/index.ts`.

## Authorization

`commonAuthedProcedure` only proves the user is logged in. **Scope checks are still required** — assert the user can act on *this* org/profile/decision. Do it in the `@op/common` service with `assertAccess` / `checkPermission`. See the `access-control` skill for the patterns; don't roll your own role check and don't gate on the client only.

## Cache invalidation = realtime channels, never manual

Invalidation is push-based. The client (`apps/app/src/components/QueryInvalidationSubscriber.tsx`) subscribes to channels and invalidates the matching query keys automatically — for both the local mutation and changes from other clients over the websocket. Your job is to wire the channels on the procedures:

- **Query** declares the channels it depends on: `ctx.registerQueryChannels([Channels.profilePosts(input.profileId)])`.
- **Mutation** declares the channels it affects: `ctx.registerMutationChannels([Channels.profilePosts(input.profileId)])`.
- Channel builders live in `packages/common/src/realtime/channels/channels.ts` (`Channels.*`).

A query and the mutations that change its data must register the **same** channel, or the UI won't refresh. If data isn't updating after a mutation, the fix is a missing/mismatched channel — **never** a manual `queryClient.invalidateQueries(...)` / `utils.x.invalidate()` on the client.

## Don't

- **Don't put business logic in the router.** Delegate to a `@op/common` service.
- **Don't skip `.output()`** or return raw DB rows. Always encode + `parse`.
- **Don't derive types from `RouterOutput`.** Use encoder `z.infer` types from `@op/api/encoders`.
- **Don't manually invalidate queries.** Register channels on the query and the mutation.
- **Don't trust `commonAuthedProcedure` as authorization.** Assert scope in the service.
- **Don't hand-build procedures.** Use `commonAuthedProcedure()` / `commonProcedure`.

## Verify

Run `pnpm w:api typecheck` after changing procedures, and `pnpm w:app typecheck` if you touched encoders consumed by the frontend.
