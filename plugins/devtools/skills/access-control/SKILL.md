---
name: access-control
description: Authorization, permissions, roles, admin checks, authz, gating, and locking down endpoints — via the access-zones library and our wrappers (assertProfileAccess, assertOrgAccess, assertProfileAdmin, getProfileAccessUser, AccessBoundary, AccessTierError) across zones profile, decisions, admin. Use when adding a permission check, making an endpoint or mutation admin-only, gating a button or UI by role, wiring authz on a tRPC procedure / server action / route, hiding or showing components by permission, or handling the public/anonymous caller (AccessUser | undefined).
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

## Be conservative when broadening user / profile reads

Adding a field to the `user` / `profile` encoder, or to a "list users" service, is a place where auth-sensitive data leaks if it's not deliberate. Email, phone, `is_anonymous`, role lists, and similar fields are the recurring offenders. PR #1297 review: "One reason for previously not adding this in prior is that it makes it way too easy to leak details related to auth to other users (including things that might be auth only like phone number). Any reason it was added here?"

Before adding a field that exposes another user to the caller:

1. **Filter at the encoder / schema layer**, not at the service. The encoder is the wire boundary; if the field shouldn't reach an unrelated viewer, it shouldn't be on the encoder unconditionally.
2. **If it's owner-only, encode it conditionally** — `services/api/src/encoders/posts.ts` returns extra owner-only fields based on the caller. The pattern is to encode the public shape by default and `.extend({ /* owner-only */ })` when the caller matches.
3. **Default to the narrower shape** if you're unsure. A follow-up to add the field later is cheap; a leak that ships behind a deploy is not.

The procedure tier doesn't protect against this — `networkAuthenticatedProcedure` still lets every in-network user fetch every other user's row. The encoder + service do the filtering.

## Authorization errors — `UnauthorizedError` and `AccessTierError`

Two distinct error types model the two failure modes:

- **`UnauthorizedError`** (403) — the caller is authenticated (or anonymous, or the public sentinel) but lacks the resource permission. Thrown by `assertAccess`, `assertProfileAccess`, `assertOrgAccess`, `assertProfileAdmin`. Defined in `packages/common/src/utils/error/index.ts`.
- **`AccessTierError`** — the caller couldn't even reach the endpoint at its declared tier (e.g. no-JWT request hitting a `networkAuthenticatedProcedure`). Thrown by the tier middlewares. Carries `callerTier: 'none' | 'anon' | 'user' | 'network'`. Status code is 401 when `callerTier === 'none'`, else 403.

When wrapping `access-zones` calls in feature code, **rethrow `AccessControlException` as `UnauthorizedError`** so Common owns the error model (review feedback on #1245). Don't let external library exceptions leak into your service signatures — Common error types are what the API surface and the client error boundaries expect.

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
