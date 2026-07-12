---
name: realtime-channels
description: Channel naming and design — the Channels.X builders in packages/common/src/realtime/channels/channels.ts (scope[:id] convention), JSDoc subscriber/broadcaster pairing, exporting a per-builder type plus the ChannelName union, when to add a channel vs reuse one, when NOT to over-channel a mutation, and the channelScope.ts helper pattern for fanning out invalidations to many subscribers. Use when adding a new channel, naming a channel, deciding whether a mutation should register an existing channel or a new one, or wiring per-profile / per-collection invalidation fan-out for a multi-tenant feature.
---

Realtime invalidation in `oneprojectorg/common` is **push-based via channels**. A tRPC query declares which channels its result depends on; a mutation declares which channels it affects; the client (`QueryInvalidationSubscriber`) subscribes to channels and invalidates the matching query keys when a mutation fires. The wiring lives on the procedures (see the `api-endpoints` skill), but the channel design lives here.

## Single source of truth: `Channels.X(...)`

All channel names are built by one of the `Channels.X(...)` functions in `packages/common/src/realtime/channels/channels.ts`. Never inline a channel string.

```ts
// ✅
ctx.registerQueryChannels([Channels.profilePosts(profileId)]);

// ❌
ctx.registerQueryChannels([`profilePosts:${profileId}`]);
```

The builders return a TypeScript `as const` literal, which the per-builder type captures via `ReturnType<typeof Channels.foo>`. That gives us:

- Compile-time enforcement of the channel format.
- A `ChannelName` union of every valid channel — `ChannelName[]` is the only valid parameter for `registerQueryChannels` / `registerMutationChannels`.
- A single grep target for "where is this channel registered."

## Naming convention: `scope[:id][:subscope]`

Every channel name follows `scope[:id]` (colon-separated). The first segment is the resource class; later segments narrow:

| Convention | Example | When |
|---|---|---|
| `<resource>:<id>` | `decisionInstance:abc` | Single resource by id |
| `<resource>s:<parentId>` | `profilePosts:xyz`, `decisionProposals:abc` | Collection of a resource scoped to a parent |
| `<resource>:<id>:<subscope>` | `postComments:abc` (already scoped by post) | When the subscope is intrinsic, drop the redundant id pair |
| `<resource>:<type>:<id>` | `profileJoinRequest:source:abc` | When direction matters (source vs target, in vs out) |
| `global` | `global` | Truly global — broadcast to every subscriber |

Pluralization carries meaning:
- `profilePosts:<profileId>` is the *list* of posts on a profile.
- `decisionProposal:<instanceId>:<proposalId>` is a *single* proposal.
- `decisionProposals:<instanceId>` is the *list* of proposals on an instance.

Use the singular for "this one record changed"; the plural for "the list of these records may have changed."

## Per-builder JSDoc — subscriber + broadcaster

Every non-trivial channel builder carries a JSDoc that names:

1. **Subscribers** — which queries read this channel.
2. **Broadcasters** — which mutations affect this channel.

```ts
/**
 * Channel for top-level posts on a profile (user, org, or decision).
 * Subscribed to by post-feed queries, broadcast to by post creation and
 * reactions on those posts.
 */
profilePosts: (profileId: string) => `profilePosts:${profileId}` as const,
```

This makes it possible to audit a channel without grepping the whole codebase. When you add a channel, write the JSDoc. When you start using an existing channel from a new query or mutation, **update the JSDoc** to list the new caller — that's how the pairing stays honest.

## Per-builder type + ChannelName union

For every `Channels.foo` builder, export a `FooChannel` type and add it to the `ChannelName` union at the bottom of `channels.ts`. The two-step keeps the union exhaustive:

```ts
export type ProfilePostsChannel = ReturnType<typeof Channels.profilePosts>;

export type ChannelName =
  | ProfilePostsChannel
  | ProfileResourcesChannel
  | ...
```

If you skip the union entry, the builder still works, but `ChannelName` no longer covers it — type errors propagate to callers in confusing ways.

## When to add a new channel

Add a new channel only when:

1. **A new query reads data not covered by any existing channel.** Then the channel is the channel that query depends on, and any mutation that touches the same data must register it.
2. **Existing channels are too coarse and you'd be invalidating unrelated queries.** E.g. if `profilePosts:<id>` covers every post on a profile, and you now have a feature that watches only one post's comment count, `postComments:<postId>` is the more specific channel.

Don't add a channel that no query subscribes to. **The mutation side exists for the query side.** Adding a channel "just in case" leaves the codebase carrying noise that pretends to be load-bearing.

**Prefer reusing a sibling's channel over adding one.** If a new query is a derived view of the same data a sibling endpoint already lists, register that sibling's existing channel rather than a new one — the query then refreshes on the same invalidations the list already listens to, and no manual invalidation is needed (PR #1553 review: a `pins` query registered the same `decisionProposals` channel as `listProposals`, so pins refresh whenever proposals do). Only reach for a new channel when the reused one would be too coarse.

## When NOT to over-channel a mutation

A recurring review pattern (PR #1229): mutations that register every plausibly-affected channel become invalidation bombs. Register the channels the affected queries **actually** subscribe to, not every channel related to the resource.

```ts
// 🚫 Over-channeled — `Channels.collectionResources(id)` invalidates a list that
// nobody is going to see after delete; the parent fan-out is what's needed.
ctx.registerMutationChannels([
  Channels.collectionResources(collectionId),  // is this query still mounted?
  Channels.profileCollections(profileId),
]);

// ✅ Just the parent fan-out — the collection itself is gone.
ctx.registerMutationChannels([
  Channels.profileCollections(profileId),
]);
```

Reviewer (PR #1229): "Looks a bit excessive and I'm wondering if we need it. For example, if a collection is deleted I wouldn't care much about `Channels.collectionResources(collectionId)` or do we have a good case for that?"

The check: does an active query subscribe to this channel, and does this mutation actually change the data that query returns? If either answer is no, drop the channel.

## Fanning invalidation to many subscribers (`channelScope.ts`)

When a single mutation can affect many parent scopes (a resource shared across multiple profiles' collections), centralize the lookup in a `channelScope.ts` (or similar) helper inside the feature service. The router then maps the resolved ids to channels:

```ts
// packages/common/src/services/resources/channelScope.ts
export const getScopesForResource = async (
  resourceId: string,
): Promise<{ profileIds: string[]; collectionIds: string[] }> => {
  // ... query that returns every (profileId, collectionId) the resource lives in
};
```

```ts
// services/api/src/routers/resources/delete.ts
const { profileIds, collectionIds } = await getScopesForResource(id);
await deleteResource({ authUserId: ctx.user.id, id });

ctx.registerMutationChannels([
  ...profileIds.map((p) => Channels.profileResources(p)),
  ...collectionIds.map((c) => Channels.collectionResources(c)),
]);
```

Two things to notice:

- **Snapshot the scope before the mutation.** Once the resource is deleted, the join rows are gone — `getScopesForResource` won't find anything. Resolve the fan-out targets *first*, mutate *second*.
- **Helpers live in the service, not the router.** The router is thin — it asks the service "what's the scope?" and "do the work" and combines the two.

## Register channels synchronously, in the request path

`registerMutationChannels` must run **inside the request that performed the write**, not in a deferred job, an event listener, or a "fire-and-forget" promise. The realtime layer batches channels at request commit time; a registration that lands in a later tick is dropped or arrives after the client has already moved on, and the UI silently stops invalidating.

PR #1392 (`perf(decisions): cache instance and categories in Redis`) called this out on the `transitionMonitor` path: "Noting the synchronous invalidation which is important for realtime channel invalidations." That endpoint flips state *and* registers channels in the same synchronous flow — splitting the registration into a follow-up event would have broken the invalidation. Same applies to any code that's tempted to register channels from a setTimeout, a Promise without `await`, or a queued background job.

If a mutation genuinely runs work asynchronously (e.g. enqueues a job that completes minutes later), the synchronous part still registers the channels for the queued work's expected side-effects so the UI knows what to invalidate when the realtime broadcast eventually arrives.

## Bound the mutation-id dedup cache

`QueryInvalidationSubscriber` tracks already-processed mutation ids to skip duplicate broadcasts, but that structure only ever grows — a plain `Set` is an unbounded memory leak over a long-lived session. Use an insertion-ordered `Map` capped at a fixed size with FIFO eviction (evict the oldest key once the cap is hit), sized to comfortably cover the race window it protects — 500 entries in practice (PR #1336). Same shape applies to any long-lived client-side dedup/seen-set.

## Reference-count client subscriptions — tear down on the last query out

Channel registration on the client is not one-directional. The `queryChannelRegistry` (in the `QueryInvalidationSubscriber` layer) must keep a `queryKeyToChannels` inverted index alongside its channel → query-keys map, expose `unregisterQuery`, and forward TanStack `QueryCache` `removed` events into it. When a channel's last subscribing query leaves, close its Supabase Realtime subscription. A registry that only tracks channel → query-keys and never decrements leaks: every channel a query ever touched stays subscribed until the tab closes, and at thousands of concurrent users this saturates Supabase Realtime's per-project channel cap (PR #1336 self-review). Never let channels or subscriptions accumulate for the tab lifetime.

## Channel registration on procedures

This belongs in `api-endpoints`, but for symmetry:

- **Query**: `ctx.registerQueryChannels([Channels.profilePosts(input.profileId)])` — declares which channels this result depends on.
- **Mutation**: `ctx.registerMutationChannels([Channels.profilePosts(input.profileId)])` — declares which channels this mutation affects.
- The pair must match exactly (same `Channels.X(...)` call) for the client to invalidate.

If a query and a mutation should share a channel but use different identifiers (the query takes a slug, the mutation knows the id), normalize at the service layer — the mutation should fetch the id-equivalent the query depends on before registering. Don't paper over the mismatch by registering two channels.

## Test channels at the service-layer boundary

Channel registration is wiring, not behavior — there's no Vitest assertion that "this channel was registered." The check that matters is **manual + an integration test that the resulting query refreshes**. Most regressions show up as "the UI didn't update after I clicked save," not as test failures.

If you find a feature where mutations and queries are racing, the answer is almost never a manual `invalidate` — it's missing or mismatched channels. See the `api-endpoints` and `component-file-structure` skills for the rule: never manually invalidate.

## Don't

- **Don't inline channel strings.** Always go through `Channels.X(...)`.
- **Don't add a channel without subscribers.** Useless invalidation surface.
- **Don't register every channel a mutation could plausibly touch.** Register what active queries depend on.
- **Don't skip the JSDoc** on a new channel — the subscriber/broadcaster pairing is the contract.
- **Don't resolve fan-out targets after the mutation.** Snapshot first; the join rows you need may be gone by the time the mutation finishes.
- **Don't use the `global` channel** for normal-flow invalidation. It's a system-wide hammer; use a scoped channel.
