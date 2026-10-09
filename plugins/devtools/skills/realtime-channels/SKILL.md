---
name: realtime-channels
description: Realtime invalidation — Channels.X in packages/common/src/realtime/channels/channels.ts, registerQueryChannels/registerMutationChannels, channelScope.ts fan-out, no-replay gaps. Use when data doesn't refresh after a mutation, when adding or reusing a channel, or when a client waits on a job.
---

This skill is the sole owner of channel wiring and invalidation. A query declares the channels its result depends on, and a mutation declares the channels it affects. `QueryInvalidationSubscriber` (`apps/app/src/components/`) subscribes to them and invalidates matching query keys, both locally and across clients.

## Wiring

```ts
// query
ctx.registerQueryChannels([Channels.profilePosts(input.profileId)]);
// mutation
ctx.registerMutationChannels([Channels.profilePosts(input.profileId)]);
```

- Always build names with `Channels.X(...)`. Never inline a channel string.
- The query and the mutation must produce the same `Channels.X(id)`. If one side knows the slug and the other the id, normalize in the service. Don't register both.
- Register synchronously, inside the request that wrote. A registration from a setTimeout, an un-awaited promise, a listener or a queued job is dropped. For async work, register the expected channels in the synchronous part.
- Never fix staleness with a client `utils.x.invalidate()` / `queryClient.invalidateQueries`. Compare the query's and the mutation's channel lists. If they match, delete the manual call. If they don't, fix the channel.

## Channel builders (`channels.ts`)

- Naming is `scope[:id]`. Use the singular for one record (`decisionProposal:<instanceId>:<proposalId>`) and the plural for a list (`decisionProposals:<instanceId>`, `profilePosts:<profileId>`). Add a direction segment when it matters (`profileJoinRequest:source:<id>`).
- Builders return `as const` template literals. Export `type FooChannel = ReturnType<typeof Channels.foo>` and add it to the `ChannelName` union, or callers get confusing type errors.
- Each non-trivial builder has a JSDoc naming its subscribers (queries) and broadcasters (mutations). Update it when you add a caller.
- Don't use `Channels.global()` for normal invalidation.

## Choosing channels

- A query registers every input that can change its output, including gates on other tables (phase, visibility, membership) that someone else's mutation publishes, such as `decisionInstance`.
- Reuse a sibling's channel for a derived view of the same data (e.g. map pins register `decisionProposals`). Add a new channel only when no existing one covers the data, or when the existing one is too coarse.
- Don't add a channel that no query subscribes to.
- A mutation registers only channels that active queries subscribe to and whose data it actually changes. A deleted collection doesn't need `collectionResources(id)`.
- A channel that fires on a common mutation multiplies the cost of the read behind it. If that read is unpaginated and feeds a surface left open, fix the read (see service-layer-structure).

## Fan-out (`channelScope.ts`)

When one mutation affects many parents, the service exports a resolver and the router maps its result to channels:

```ts
const scopes = await getScopesForResource(input.id);   // BEFORE the write
await deleteResource({ authUserId: ctx.user.id, id: input.id });
ctx.registerMutationChannels([
  ...scopes.collectionIds.map((id) => Channels.collectionResources(id)),
  ...scopes.profileIds.map((id) => Channels.profileResources(id)),
]);
```

- Snapshot the scope before mutating, because the join rows may be gone afterwards.
- The resolver lives in the service. The router only combines it with the channel call.

## No replay

Supabase Realtime doesn't replay. Broadcasts sent before the client subscribes, or during a reconnect, are lost.

- If a query waits on a background job that can finish before the subscription is live, the client needs a re-read on subscribe, not a longer timeout. Making that app-wide is its own change.
- Workflows broadcast intermediate states, or send a heartbeat. Otherwise a client's silence timeout turns into a total-duration cap.
- A client timeout doesn't stop the job. Make sure its result can still be reached afterwards.

## Client registry

- `queryChannelRegistry.ts` (`packages/common/src/realtime/channels/`) reference-counts subscriptions: it keeps a `queryKeyToChannels` index and `unregisterQuery` on `QueryCache` `removed`, and closes a channel when its last query leaves. Don't let subscriptions accumulate.
- Dedup sets of seen mutation ids are capped FIFO maps (`MAX_REMEMBERED_KEYS = 500`), never an unbounded `Set`.

## Testing

No unit test asserts that a channel was registered. Verify by hand, or with an integration test that the query refreshes after the mutation.

See [references/lessons.md](references/lessons.md) for the PR history behind these rules.

## Review checklist

- [ ] Channel names via `Channels.X(...)`; no string literals
- [ ] Query and every mutation that changes its data register the same `Channels.X(id)`
- [ ] Query covers gates/config on other tables, not just its main table
- [ ] Mutation registers only channels with live subscribers it actually affects
- [ ] Registration is synchronous in the request path
- [ ] Fan-out scope resolved before the write, via a service `channelScope.ts`
- [ ] New builder has JSDoc (subscribers/broadcasters), a `FooChannel` type, and a `ChannelName` union entry
- [ ] No manual client invalidation added on top of (or instead of) channels
- [ ] Clients waiting on jobs handle no-replay (re-read on subscribe / intermediate broadcasts)
- [ ] No `global` channel for normal flows
