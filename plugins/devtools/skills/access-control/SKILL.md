---
name: access-control
description: Authorization, permissions, roles, admin checks, authz, gating, and locking down endpoints — via the access-zones library and our wrappers (assertProfileAccess, assertOrgAccess, assertProfileAdmin, getProfileAccessUser, AccessBoundary, AccessTierError) across zones profile, decisions, admin. Order OR'd grant checks so the broadest (admin) short-circuits before any lookup that can throw, and make an authorization path fail with UnauthorizedError rather than propagating a NotFoundError from an internal lookup. A relationship read gates BOTH ends on one shared visibility predicate (and joined metadata — a profile named after a proposal's title — leaks what the filter hid); hide a restricted row with NotFoundError, deny with UnauthorizedError; leave a shared getter permissive when admin mutations need it and restrict at the read. Never re-derive the server's authorization rule (or which phase is current) on the client — return the decision from the endpoint. Per-field redaction (isAnonymous, email, roles) travels with the field rather than with the endpoint, so reuse the canonical serializer instead of re-selecting raw profile columns — a rule re-derived at five read sites is the rule the sixth one misses. Don't carry a legacy implicit organization grant into a new write path. Use when adding a permission check, making an endpoint or mutation admin-only, gating a button or UI by role, wiring authz on a tRPC procedure / server action / route, hiding or showing components by permission, or handling the public/anonymous caller (AccessUser | undefined).
---

## The library

The base library is the external NPM package `access-zones`. We wrap it inside `packages/common/src/services/access/` and `packages/common/src/services/assert/`. Always go through our wrappers — they load + normalize roles correctly and rethrow library exceptions as our own `UnauthorizedError`. Don't import from `access-zones` directly in feature code (the one exception is importing the `permission` bitfield constants).

## Vocabulary

- **Zone** — a permission domain. The three in active use: `profile`, `decisions`, `admin` (admin is mostly legacy, prefer the others).
- **Permission bitfield** — `permission.ADMIN | CREATE | READ | UPDATE | DELETE` plus decision-specific bits: `INVITE_MEMBERS`, `REVIEW`, `SUBMIT_PROPOSALS`, `VOTE`. Compose with `|` for "any of".
- **Built-in roles** — `Admin` (full) and `Member` (read profile, read+vote on decisions). See `services/db/seedData/accessControl.ts` for the canonical definitions.
- **`AccessUser`** — `Pick<User, 'id'>` from `@op/supabase/lib`. The caller identity the access layer needs. **Optional throughout** (`user?: AccessUser`) so a no-JWT caller can be represented as `undefined`.
- **`GLOBAL_USER_PUBLIC`** — a sentinel `authUserId` from `@op/core`. Grants made to this id apply to *everyone* (members, logged-in non-members, anonymous sessions, no-JWT visitors). It's what makes a "public" resource visible across the access ladder.

## Backend — the only patterns you should be writing

### 1. Get the caller

Inside a tRPC procedure, the tier middleware (`withNetworkAuthenticatedUser` / `withConfirmedUser` / `withAuthenticatedUser` / `withResolvedUser`) injects `ctx.user`. For `networkAuthenticatedProcedure` / `authenticatedConfirmedProcedure` / `authenticatedProcedure`, `ctx.user` is defined. For `openProcedure`, `ctx.user` is `AccessUser | undefined` and your service must handle the public-caller case. See the `api-endpoints` skill for the 4-tier model.

For server actions / service-layer code reached from outside tRPC:
- `getCurrentOrgId({ authUserId })` — current org for an authenticated caller
- `getCurrentProfileId(authUserId)` — current profile for an authenticated caller
- `getIndividualProfileId(authUserId)` — caller's personal profile

### 2. Fold the public sentinel for `openProcedure` callers

Inside a service that takes `user?: AccessUser`, never filter by `user?.id` directly — that's the fail-open trap (Drizzle silently skips `undefined` conditions). Use `resolveAccessUserIds`:

```ts
import { resolveAccessUserIds } from '@op/common/services/access';

// Always returns a non-empty array (at minimum [GLOBAL_USER_PUBLIC]).
const authUserIds = resolveAccessUserIds(user);

const rows = await db.query.profileUsers.findMany({
  where: { profileId, authUserId: { in: authUserIds } },
});
```

For a logged-in caller this folds in the public sentinel so they still see public-grant resources without losing their own grants; for `undefined` it returns just the public sentinel.

### 3. Assert + fetch in one call (preferred for mutations)

`assertProfileAccess` and `assertOrgAccess` fetch the access user **and** check the permission bitfield, returning the resolved access user so you can reuse it (roles, profile, org id) without an extra query. This is the canonical pattern for mutations and any code path where lacking permission means the request is invalid.

```ts
import { assertProfileAccess, assertOrgAccess } from '@op/common/services/assert';
import { permission } from 'access-zones';

const profileUser = await assertProfileAccess({
  user,
  profileId,
  permissions: { profile: permission.UPDATE },
});
// profileUser.roles, profileUser.profile available — no second fetch.

const orgUser = await assertOrgAccess({
  user,
  organizationId,
  permissions: { admin: permission.ADMIN },
});
```

Both throw `UnauthorizedError` on failure (members without permission, non-members, anonymous callers without a grant). Pass `notMemberMessage` to customize the "not a member" message; the permission-denied message is fixed.

For the common "is profile admin?" check, use the dedicated wrapper (named-params shape, **not** positional):

```ts
import { assertProfileAdmin } from '@op/common/services/assert';

await assertProfileAdmin({ user, profileId });
```

Sources: `packages/common/src/services/assert/{assertProfileAccess,assertOrgAccess,assertProfileAdmin}.ts`.

### 4. Boolean check (no throw) — branch on permission

Use when you need to branch — e.g., a list endpoint that returns more fields to admins. Two-step: load the access user, then check.

```ts
import { getOrgAccessUser, getProfileAccessUser } from '@op/common/services/access';
import { checkPermission, permission } from 'access-zones';

const profileUser = await getProfileAccessUser({ user, profileId });
const isAdmin = checkPermission(
  { profile: permission.ADMIN },
  profileUser?.roles ?? [],
);
```

`getOrgAccessUser` / `getProfileAccessUser` are **memoized per-request** (`AsyncLocalStorage`-backed, via `withRequestCache` middleware — PR #1220). Calling them twice in the same procedure hits the DB once. Don't try to outsmart it by passing the fetched user around through every helper — just call again where it's needed.

Beneath that per-request `memoize()` sits a second, **durable** `cache()` layer (`cache({ type: profileUser | orgUser, skipMemCache: true })`): the memoize collapses same-request calls, the durable cache survives across requests. When you add a new access-user loader, mirror `getOrgAccessUser` exactly (durable `cache()` + retained `memoize()`), and — critically — wire cache invalidation into **every** mutation that changes what it caches (roles, membership), e.g. `invalidateProfileUserCacheForRole`. A durable cache with a missed invalidation site serves stale grants; grep the mutation sites before shipping (PR #1339 self-review).

### 5. Domain-specific assertions for instances and collections

Some features wrap the lower-level assertions into domain-aware ones (and return useful context):

```ts
import { assertInstanceProfileAccess } from '@op/common/services/access';

// Profile-level check with org-level fallback (for nested instance resources).
const profileUser = await assertInstanceProfileAccess({
  user,
  instance,
  profilePermissions: { profile: permission.UPDATE },
  orgFallbackPermissions: { admin: permission.ADMIN },
});
```

When you need the same (fetch + assert + return useful ids) shape in a new domain, **add a new `assertXAccess` utility** in `packages/common/src/services/assert/` rather than re-inlining the pattern. Reviewers consistently push back on inlined fetch-then-check code that should be a named assertion.

### 6. Permissions on read

For read endpoints, prefer `permission.READ` over `permission.ADMIN` even for admin-only views — admins inherit READ, and a future role refactor might expose a non-admin role that can read but not write. PR #1208: "I like this being `permission.READ`" — gives room for non-admin readers later without changing the gate.

### 7. Personal-profile owners have no role row — don't gate them with the throwing assert

A user's ownership of their **personal** profile is just the `users.profileId` pointer — there is **no role row** on that profile. So the throwing `assertProfileAccess` (and anything built on it) `403`s the owner of their own personal profile, because it finds no roles to check. For an action a personal-profile owner must be able to perform on their own profile (e.g. avatar / banner upload), use the non-throwing primitive `getProfileAccessRoles` plus an explicit own-profile check (`user.profileId === profileId`), then `checkPermission` — don't reach for the throwing assert. PR #1612 (nourmalaeb): "personal-profile owners have no role row on their own profile … so every personal upload would 403. Used `getProfileAccessRoles` (the non-throwing primitive it wraps) … then `checkPermission` after the own-profile check." This is also why `assertProfileAccess` itself can't go inside a `Promise.all` where a personal-profile owner is a valid caller.

## One mutation, two permission tiers → two endpoints

When a single mutation serves two use cases that need *different* permission tiers, add a dedicated endpoint for the looser case instead of loosening the shared endpoint's tier (which silently exposes the stricter case too). PR #1580: opening `profile.addRelationship` down a tier to allow proposal likes/follows also let anyone create org↔individual relationships — the fix reverted `profile.addRelationship` to `networkAuthenticated` and added a separate `decision.addProposalRelationship` on the confirmed tier. Corollary: **gate a lighter engagement action at the same bar as its heavier sibling on the same resource, never stricter** — likes/follows shouldn't be held to a higher permission than commenting (PR #1580: the like guard was narrowed to match the comment path's `SUBMIT_PROPOSALS` on the decision).

## Be conservative when broadening user / profile reads

Adding a field to the `user` / `profile` encoder, or to a "list users" service, is a place where auth-sensitive data leaks if it's not deliberate. Email, phone, `is_anonymous`, role lists, and similar fields are the recurring offenders. PR #1297 review: "One reason for previously not adding this in prior is that it makes it way too easy to leak details related to auth to other users (including things that might be auth only like phone number). Any reason it was added here?"

Before adding a field that exposes another user to the caller:

1. **Filter at the encoder / schema layer**, not at the service. The encoder is the wire boundary; if the field shouldn't reach an unrelated viewer, it shouldn't be on the encoder unconditionally.
2. **If it's owner-only, encode it conditionally** — `services/api/src/encoders/posts.ts` returns extra owner-only fields based on the caller. The pattern is to encode the public shape by default and `.extend({ /* owner-only */ })` when the caller matches.
3. **Default to the narrower shape** if you're unsure. A follow-up to add the field later is cheap; a leak that ships behind a deploy is not.

The procedure tier doesn't protect against this — `networkAuthenticatedProcedure` still lets every in-network user fetch every other user's row. The encoder + service do the filtering.

## A relationship read gates **both** ends — define the predicate once

Every entity a query returns *or accepts as an id* has to satisfy the same visibility predicate the canonical single-row read enforces. When a read joins two rows of the same table — a relationship, an edge, a parent/child pair — the predicate applied to one end and not the other is the single most-repeated authorization defect in review. PR #1789 hit it twice in one file: the first pass filtered `moderationDetachedAt` on the pinned proposal and applied draft / visibility / moderation-flag predicates only to the far-end join; the second pass had them the other way around.

Write the predicate as a function of the table reference and apply it to every end:

```ts
const needsNoAccessException = (t: typeof proposals): SQL =>
  and(
    isNull(t.deletedAt),
    isNull(t.moderationDetachedAt),
    ne(t.status, ProposalStatus.DRAFT),
    eq(t.visibility, Visibility.VISIBLE),
    noActiveModerationFlag('proposal', t.id),
  )!;
```

Four things that thread makes concrete:

- **Decision-level read access does not imply access to every row inside the decision.** `getProposal` also restricts drafts, `HIDDEN` proposals and flagged ones, so "the caller can read this decision" is not the predicate — list the far end only when it needs none of those exceptions.
- **Joined metadata leaks the thing you hid.** `createProposal` names a proposal's profile after the proposal's title (`name: proposalTitle`) and derives the slug from it too, so returning the linked *profile* hands out the title of a proposal the caller would 404 on. Audit what rides along with an id, not just the id.
- **Throw `NotFoundError` for a restricted resource, not `UnauthorizedError`** — the same choice `getProposal` makes, so a restricted proposal's existence never leaks through the error type. This is not in tension with the rule below about authorization paths failing with authorization errors: that one is about an *internal lookup* failing (a stale phase id) and surfacing as a 404 on a resource the caller can reach; this one is about deliberately hiding existence from a caller who must not learn the row is there. Deny → `UnauthorizedError`; hide → `NotFoundError`.
- **Don't tighten the shared low-level getter** when admin mutations legitimately need to operate on restricted rows. `getLinkedProposal` stays permissive because `mergeProposals` / `unmergeProposal` are `decisions: ADMIN` and must resolve hidden or flagged proposals; the restriction belongs to the read call site, with a comment saying so. Adding the filter in the getter would have broken unmerge for exactly the rows that need it most.

Order the checks so the failure type stays deterministic: when the existence probe rides in the same `Promise.all` as the authorization assert, the assert's rejection preempts the parallel read, so an unauthorized caller always gets the authorization error rather than racing a `NotFoundError`.

## A redaction rule re-derived at every read site will be missed by the next one

Row-level filtering is only half the surface. The other half is **per-field redaction** — the rules that hide a submitter's identity, an email, a reviewer's name — and it fails in a distinctive way: every existing read applies it correctly, so nothing looks wrong, and the *new* read is the one that leaks. On `dev` today, `isAnonymous` is resolved independently in `getProposal.ts`, `listProposals.ts`, `listAllProposals.ts`, `listProposalLocations.ts` and `listProposalSubmitters.ts` — five hand-rolled copies of the same `profileUsers → authUser.isAnonymous` walk. PR #1856 added a sixth read path (contributing ideas on a merged-into proposal), reached for the profile's `name` and `avatarImage` directly, and shipped the anonymous submitter's identity to anyone with proposal read access.

So before a new query returns a person, an author, or a submitter:

- **Find the canonical serializer for that entity and reuse it**, rather than re-selecting the raw columns. A new join that reads `profiles.name` where every sibling read goes through a redacting projection is the finding.
- **Redaction rules travel with the field, not with the endpoint.** `isAnonymous`, `email`, and role lists have to be re-applied on every path that surfaces them, which is the argument for one shared helper over five correct copies — the sixth copy is the one that ships.
- **When you notice the copies, extract them** even if your change only needed the sixth. This is the case where *composition over duplication* and a security boundary point the same way.

## Don't carry a legacy implicit grant into a new path

Older decision instances grant access by organization membership — an org gains a capability on a process without anyone assigning it. That fallback still exists for the instances that depend on it, and copying it into a new write path silently extends it to processes that were never meant to have it. PR #1848 review on `assignPhaseReviews`: *"Legacy. We shouldn't need this anymore and want to not replicate this pattern? We don't want to allow this kind of permission on new processes where an org automatically gains access."* PR #1862 (`refactor(decisions): drop the instance org fallback from active-process writes`) is the direction of travel.

When you copy an access pattern from a neighbouring service, check whether the thing you copied is the current model or the compatibility shim. If it's the shim, gate it on the legacy condition explicitly instead of applying it unconditionally, and say in the PR body which instances still need it.

## Authorization errors — `UnauthorizedError` and `AccessTierError`

Two distinct error types model the two failure modes:

- **`UnauthorizedError`** (403) — the caller is authenticated (or anonymous, or the public sentinel) but lacks the resource permission. Thrown by `assertAccess`, `assertProfileAccess`, `assertOrgAccess`, `assertProfileAdmin`. Defined in `packages/common/src/utils/error/index.ts`.
- **`AccessTierError`** — the caller couldn't even reach the endpoint at its declared tier (e.g. no-JWT request hitting a `networkAuthenticatedProcedure`). Thrown by the tier middlewares. Carries `callerTier: 'none' | 'anon' | 'user' | 'network'`. Status code is 401 when `callerTier === 'none'`, else 403.

When wrapping `access-zones` calls in feature code, **rethrow `AccessControlException` as `UnauthorizedError`** so Common owns the error model (review feedback on #1245). Don't let external library exceptions leak into your service signatures — Common error types are what the API surface and the client error boundaries expect.

## Order the grant checks so the broadest one short-circuits first

An authorization expression that ORs several grants together evaluates them all unless you stop it. When one of those grants needs a *lookup* to compute — and that lookup can throw — a caller who was already authorized by a cheaper grant gets an error instead of their data.

```ts
// ❌ getPhaseReviewSettings() runs for admins too, and throws NotFoundError
//    when currentStateId names a phase that no longer exists.
const openReviewsForReviewers =
  instance.access.review && instance.currentStateId != null &&
  getPhaseReviewSettings({ instance, phaseId: instance.currentStateId }).openReviews;

// ✅ Admins never reach the phase lookup.
const openReviewsForReviewers =
  !instance.access.admin && instance.access.review && …
```

PR #1694: profile admins receive `ALL_TRUE_ACCESS` (so `review: true` is set for them too), which pulled the admin path into a phase-settings resolution it never needed. "An admin accessing this endpoint when `currentStateId` is set to a stale or unrecognised phase ID would now receive an unexpected 'Phase not found' error rather than the allowed read."

**And an authorization path must fail with an authorization error.** Adding the admin short-circuit fixed admins but left the same throw live on the reviewer branch — a non-admin reviewer on an instance whose `currentStateId` points at a removed phase got `NotFoundError('Phase', phaseId)`, which surfaces to the client as a 404 on a valid proposal id: "clients receiving that error would interpret it as 'proposal not found' rather than 'access denied'." When a lookup inside an authorization decision can fail for reasons unrelated to the caller's identity, treat the failure as *no grant* (fall through to the deny path and its `UnauthorizedError`), not as a propagated `NotFoundError`. PR #1694 follow-up.

## Frontend — gating UI

Use the declarative `<AccessBoundary>` component for permission-based rendering. It reads from `UserProvider` context — no extra fetch:

```tsx
import { AccessBoundary } from '@/components/AccessBoundary';

<AccessBoundary
  required={{ profile: { admin: true } }}
  profileId={id}
  fallback={<Unauthorized />}
>
  {children}
</AccessBoundary>
```

- `required` accepts a single condition or an **array** (OR-combined). Each condition is `{ [zone]: { [action]: true } }` — only `true`-valued actions are required.
- An empty `{}` denies (a typo can't accidentally pass — PR #1016).
- Source: `apps/app/src/components/AccessBoundary.tsx`.

If you need a boolean in code (to enable/disable a button, etc.), reach for the same `useUser()` context — don't roll your own role check.

**Gate the individual action, not the whole container.** Wrap only the privileged menu items (e.g. Delete / moderation actions) in `<AccessBoundary>` — render the menu itself, and any non-privileged action (e.g. Report), for every viewer. PR #1511: the menu always renders; moderation actions like Delete stay gated to those roles, while Report is shown to everyone. Hiding the entire menu when one action is gated denies non-privileged viewers actions they're allowed to take.

**Gate an owner-or-admin action on the owner-or-admin flag, not on admin alone.** When the server already authorizes an action for the resource's owner (e.g. `deleteProposal` lets the submitter delete), the UI gate must be `canManage || isEditable` — not `canManage` (admin) by itself. A non-admin owner — including anonymous / non-network users, who are *never* admins — otherwise never sees a menu the server would happily serve them. PR #1568: the proposal menu in `ViewProposalsList` was gated on admin alone while the sibling `VotingProposalsList` correctly used `canManageProposals || proposal.isEditable`; owners lost the menu until the two were aligned. When two sibling lists render the same action menu, keep their gating conditions identical so one can't silently diverge.

**Don't re-derive the server's authorization decision on the client — return it from the API.** A client-side "mirror" of a service gate drifts the moment the server gate gains a condition, and it drifts *open*. PR #1822 added this to `ReviewPage`:

```tsx
// Client-side mirror of the service's `canReadPhaseReviews` gate.
const canSeeReviewCounts =
  isAdmin || (canReview && getPhaseReviewSettings({ phases }, currentPhase.phaseId).openReviews);
```

The server gate it mirrors (`canReadPhaseReviews`) is strictly stronger — it also requires `currentStateId != null` and `isPhaseAtOrBefore(...)` ("no peeking past the current phase"), neither of which the mirror reproduces. Reviewer: *"Shouldn't this just be returned from the backend as opposed to duplicating the logic? I'm hesitant to do much of the extracting of current phase and parsing the capabilities on the frontend."* Two anti-patterns travel together here and both belong on the server: **re-deriving which phase is current** by scanning `instanceData.phases` for `currentStateId`, and **re-implementing a permission rule** over the raw flags. Ship the decision as a field on the endpoint's output (the encoder is the place to add it) and let the UI render a boolean. Reading `instance.access.review` / `instance.access.admin` — flags the server already computed — is fine; recomputing the *rule* over them is not.

For a component that can render both inside and outside a `UserProvider` (e.g. an avatar shown in the onboarding tree), reach for `useMaybeUser()` — it returns `undefined` when no provider is mounted — instead of `useUser()`, which throws. Absence of a user is a valid state there, not a bug (PR #1519).

When a name/avatar links to a walled-garden route (`/profile/[slug]`, `/org/[slug]`) on a surface reachable by public or non-network-member viewers, gate the link itself with `useCanLinkToProfile` — a viewer who can't reach the target only hits a login/forbidden wall. Compose the flag (`const linked = withLink && canLinkToProfile && Boolean(slug)`) and render plain text when it's false rather than a dead link (PR #1519).

## Don't

- **Don't roll your own role check.** No `if (user.role === "admin")`, no manual array scanning, no string comparison against role names. Use `assertProfileAccess` / `assertOrgAccess` / `checkPermission`.
- **Don't import `access-zones` directly** in feature code (except the `permission` bitfield constants) — go through `@op/common/services/access` and `services/assert` so role normalization stays consistent and library exceptions are rethrown as Common errors.
- **Don't gate on the client only.** Every mutation that touches another user's data must assert on the server. Client gating is for UX, not security.
- **Don't skip a check on a "private" procedure.** If the data is scoped to a user/org/profile, assert the scope explicitly — the procedure tier only proves the caller's auth class.
- **Don't let `undefined` reach Drizzle filters.** Always fold through `resolveAccessUserIds(user)` for `openProcedure` callers; otherwise the filter disappears and the query returns everything.
- **Don't pass loose `{ id: string }` objects** where the access utilities expect a `User`. Type the parameter explicitly so a typo or wrong-type object fails at compile time, not in production.
- **Don't invent a new zone.** If you think you need one, raise it before adding code — zones touch the seed data and role definitions in `services/db/seedData/accessControl.ts`.

## Quick reference

| Need | Use | File |
|---|---|---|
| Fetch + assert profile permission (returns roles + profile) | `assertProfileAccess({ user, profileId, permissions })` | `services/assert/assertProfileAccess.ts` |
| Fetch + assert org permission (returns roles + org user) | `assertOrgAccess({ user, organizationId, permissions })` | `services/assert/assertOrgAccess.ts` |
| Profile admin shortcut | `assertProfileAdmin({ user, profileId })` | `services/assert/assertProfileAdmin.ts` |
| Profile + org-fallback assert | `assertInstanceProfileAccess({ user, instance, profilePermissions, orgFallbackPermissions })` | `services/access/index.ts` |
| Boolean profile permission check | `checkPermission({ profile: permission.ADMIN }, profileUser.roles)` | `access-zones` |
| Load profile-access user (request-cached) | `getProfileAccessUser({ user, profileId })` | `services/access/index.ts` |
| Load org-access user (request-cached) | `getOrgAccessUser({ user, organizationId })` | `services/access/index.ts` |
| Fold public sentinel into authUserId filter | `resolveAccessUserIds(user)` | `services/access/index.ts` |
| Hide UI from non-admins | `<AccessBoundary required={{ profile: { admin: true } }} />` | `components/AccessBoundary.tsx` |
| Permission bitfield | `permission.ADMIN \| CREATE \| READ \| UPDATE \| DELETE` (+ decision bits) | `access-zones` |
| Throw for permission-denied | `throw new UnauthorizedError('...')` | `utils/error/index.ts` |
