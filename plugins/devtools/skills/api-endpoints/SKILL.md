---
name: api-endpoints
description: tRPC procedures in services/api/src/routers — 4 procedure tiers, input schemas from @op/common/client, encoders + .output(), paginated() envelopes, webhooks, signed-URL uploads. Use when adding or changing an endpoint, encoder, router, webhook, or any upload (attachment, avatar, banner).
---

The router validates input, calls an `@op/common` service, registers channels, and encodes the output. Business logic and authorization belong in the service (see service-layer-structure and access-control). Query syntax is owned by drizzle-migrations, and channel design by realtime-channels.

## Where things live

- `services/api/src/routers/<domain>/` has one procedure per file. The domain `index.ts` combines them with `mergeRouters(...)`, and the domain router is registered in `routers/index.ts`.
- `services/api/src/encoders/`: wire Zod schemas plus their `z.infer` types, exported via `@op/api/encoders`.
- `services/api/src/trpcFactory.ts`: procedure factories, `router`, `mergeRouters`.
- `services/api/src/utils/index.ts`: `paginationSchema`, `createSortable`, `sortDir`.
- Input schemas go in `packages/common/src/services/<feature>/schemas.ts` (or `schemas/`) and are re-exported from `@op/common/client`.
- Examples: `routers/posts/getPosts.ts`, `routers/decision/proposals/list.ts`, `routers/profile/listRoles.ts`.

## Procedure tiers

| Factory | Admits | `ctx.user` |
|---|---|---|
| `networkAuthenticatedProcedure()` | confirmed in-network / allow-listed (default) | defined |
| `authenticatedConfirmedProcedure()` | any confirmed, non-anonymous account | defined |
| `authenticatedProcedure()` | any session incl. anonymous | defined |
| `openProcedure()` | no JWT required | `AccessUser \| undefined` |

- Default to `networkAuthenticatedProcedure`. Lower the tier only when `describeAccessTierGating` tests show the service still fails closed (see test-conventions).
- Never hand-roll `t.procedure`. Keep the default rate limit (10 req / 10 s) unless you have a stated reason to pass `{ rateLimit }`.
- Pass `authUserId: ctx.user.id` on authed tiers and `user: ctx.user` on `openProcedure`. The tier only proves the auth class, so the service still asserts the resource.
- If one mutation needs two permission tiers, make it two endpoints (see access-control).

## Anatomy

```ts
export const listRolesRouter = router({
  listRoles: networkAuthenticatedProcedure()
    .input(inputSchema)
    .output(paginated(roleEncoder))
    .query(async ({ ctx, input }) => {
      const result = await getRoles({ ...input });
      if (input.profileId) ctx.registerQueryChannels([Channels.profileMembers(input.profileId)]);
      return result;
    }),
});
```

- Routers never import `@op/db` and never run queries or transactions. Delegate to a service.
- Before adding a procedure, check whether an existing one already covers the case (client concepts often collapse to one server type).
- When a procedure grows flags, add a new procedure instead.

## Input

- Import schemas from `@op/common/client`. Don't write router-only DTOs or ad-hoc shapes in encoders.
- List inputs reuse the shared builders. Use `paginationInput(tier)` from `@op/common/client`, or `paginationSchema` + `createSortable([...])` from `../../utils`. Never write a bare `limit: z.number().optional()`.
- A sibling endpoint over the same data derives its filters from the sibling's schema: `proposalFilterSchema.omit({ cursor: true, limit: true })`.
- An optional id-like string is `z.string().min(1).optional()`, because `''` is not absent. When you tighten one, tighten every sibling over the same column.
- Add new fields to a shipped schema as optional, with a comment saying what absent means.
- Keep privileged options (e.g. `includeDocumentContent`) out of the public input schema. Internal callers pass them to the service directly.

## Output

- Always `.output(encoder)`. Never return raw rows.
- Lists return `paginated(item)` (`{ items, next }`) or `list(item)` from `@op/common/client`. Add metadata with `.extend({ total })` (ADR-0003).
- Build encoders from `createSelectSchema(table)` and `.extend()` them for computed fields. Some encoders duplicate deliberately (`encoders/resources.ts`); read the header comment before collapsing one.
- Output parsing strips unlisted fields silently. When a service adds a field, update every encoder it flows through and add a test that the field survives.
- Narrowing an output `z.enum` breaks decoding of existing rows. Confirm no rows hold the old values, or add `.catch()`.
- Keep list encoders slim: omit heavy fields (document content, counts) and ship a server-side preview (`buildProposalListPreview`). Add a slim procedure rather than widening the heavy one.
- When an endpoint renders the same client type as a sibling, reuse the sibling's output schema.
- Strip auth-sensitive fields (phone, email, `isAnonymous`, roles) at the encoder. Owner-only fields go on a separate `.extend()`. See access-control.
- Narrow a JSON column's type once, close to the query. Don't cast it at each consumer.
- Frontend types come from `@op/api/encoders` (`z.infer`), never `RouterOutput[...]`.

## Invalidation

- Queries call `ctx.registerQueryChannels([...])` and mutations call `ctx.registerMutationChannels([...])` with `Channels.X(...)`. Never invalidate by hand on the client. Wiring and over-registration rules are in [realtime-channels](../realtime-channels/SKILL.md).
- `await` a server-side cache purge (e.g. user cache) before returning. Fire-and-forget races the client's refetch.

## Public route handlers (webhooks, report sinks)

Next.js handlers under `apps/api/app/api/` or `apps/app/src/app/api/` run outside the tRPC middleware, so they have to provide these guarantees themselves:

- Cap body size while streaming `request.body` and cancel at the limit. A `Content-Length` check alone doesn't count. Read errors still return the handler's fixed response.
- Verify provider signatures at the boundary, and test valid, missing, tampered, wrong-token and missing-secret cases through the real parse path.
- Return the shape the provider expects (e.g. Twilio: `<Response/>` with `text/xml`).
- Never echo errors. Log via `@op/logging` (`logger.error(msg, { error })`) and return a fixed status.
- Rate-limit outbound replies to unknown senders (e.g. Inngest `rateLimit` keyed on the sender).
- A fixed reply keyword doesn't prove the sender holds the channel. Require a code you sent.

## File uploads

Every upload uses the signed-URL flow (sign, PUT direct to Supabase, record) with `assertUploadedStorageObject` on the record step. See [references/file-uploads.md](references/file-uploads.md).

See [references/lessons.md](references/lessons.md) for the PR history behind these rules.

## Verify

`pnpm w:api typecheck`, and `pnpm w:app typecheck` when encoders consumed by the app changed.

## Review checklist

- [ ] One procedure per file, merged with `mergeRouters`, registered in `routers/index.ts`
- [ ] Factory matches the intended tier; no `t.procedure`; no reflexive custom rate limit
- [ ] No `@op/db` import or query in the router; logic + assert in a service
- [ ] Input schema from `@op/common/client`; shared pagination builders; `.min(1)` on optional ids
- [ ] New input fields optional with documented absent-meaning
- [ ] `.output()` with an encoder / `paginated()`; every encoder in the path lists new fields
- [ ] Enum narrowing on output has a `.catch()` or a no-rows confirmation
- [ ] Sensitive fields stripped at the encoder; list encoders slim
- [ ] Types via `@op/api/encoders`, not `RouterOutput`
- [ ] Query + mutation register matching channels; no client-side manual invalidate
- [ ] Server cache purges awaited
- [ ] Route handlers: streaming size cap, signature tests, no echoed errors
- [ ] Uploads follow `references/file-uploads.md`
