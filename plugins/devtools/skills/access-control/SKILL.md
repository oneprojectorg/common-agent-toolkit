---
name: access-control
description: Authorization via access-zones — assertProfileAccess, assertOrgAccess, assertInstanceProfileAccess, checkPermission, resolveAccessUserIds, <AccessBoundary>, UnauthorizedError. Use when gating an endpoint, service or UI on roles/permissions, handling public callers, or exposing user/profile fields.
---

The library is the `access-zones` npm package, wrapped in `packages/common/src/services/access/` and `services/assert/`. Always go through the wrappers, which normalize roles and rethrow library errors as Common errors. The only direct `access-zones` imports allowed are `permission` and `checkPermission`. Inside `@op/common`, import the wrappers relatively (`../access`, `../assert`). Elsewhere, import them from `@op/common`.

## Vocabulary

- Zones: `profile`, `decisions`, `admin` (mostly legacy). Don't invent a new zone without raising it first, because zones touch `services/db/seedData/accessControl.ts`.
- Bits: `permission.ADMIN | CREATE | READ | UPDATE | DELETE`, plus the decision bits `INVITE_MEMBERS`, `REVIEW`, `SUBMIT_PROPOSALS`, `VOTE`.
- Built-in roles (`services/db/seedData/accessControl.ts`): `Admin` (ACRUD on all zones), `Member` (profile `READ`; decisions `READ|UPDATE|SUBMIT_PROPOSALS|VOTE`), `Public`.
- `AccessUser` is `Pick<User, 'id'>`, and it's optional throughout (`user?: AccessUser`) for no-JWT callers.
- `GLOBAL_USER_PUBLIC` (`@op/core`) is a sentinel auth user id. Grants to it apply to everyone.

## Backend API

| Need | Use |
|---|---|
| Throw unless profile permission | `assertProfileAccess({ user, profileId, permissions, notMemberMessage? })` → `NormalizedRole[]` |
| Throw unless org permission | `assertOrgAccess({ user, organizationId, permissions })` → org user |
| Profile admin | `assertProfileAdmin({ user, profileId })` |
| Per-profile-type policy over many profiles | `assertProfileTypeAccess({ user, profileIds, policies })` |
| Instance profile with org fallback | `assertInstanceProfileAccess({ user, instance, profilePermissions, orgFallbackPermissions })` |
| Non-throwing roles | `getProfileAccessRoles({ user, profileId })`, `getProfileAccessUser`, `getOrgAccessUser` |
| Branch on a bit | `checkPermission({ profile: permission.ADMIN }, roles)` |
| Public-caller filter ids | `resolveAccessUserIds(user)` (always includes `GLOBAL_USER_PUBLIC`) |
| Caller context outside tRPC | `getCurrentProfileId`, `getCurrentOrgId`, `getIndividualProfileId` |

- Use the throwing `assert*` whenever a missing permission makes the request invalid. Use `checkPermission` only for real branching, such as returning extra fields to admins.
- Never filter by `user?.id`. Drizzle drops `undefined` conditions, so the query fails open. Fold with `resolveAccessUserIds(user)` and `authUserId: { in: ids }`.
- Fold the public sentinel at the level where the grant is made (the decision instance, not each proposal). Keep `resolveAccessUserIds` and the public-union logic inside the access package. Don't hand-build membership checks in feature services.
- Before writing a bespoke check, reach for an existing domain assert (`assertInstanceProfileAccess`, `<feature>Auth.ts`) or an explicit owner check. Never write a third hand-rolled variant. New fetch+assert shapes become a named `assertXAccess`.
- Access-user loaders are memoized per request (`withRequestCache`) and also durably cached. A new loader mirrors `getOrgAccessUser`, and every mutation that changes roles or membership invalidates its cache (e.g. `invalidateProfileUserCacheForRole`).
- Gate reads on `permission.READ`, even when the view is admin-only.
- Personal-profile owners have no role row on their own profile. For owner actions there, check `user.profileId === profileId` together with `getProfileAccessRoles` + `checkPermission`, not the throwing assert.
- Type access parameters explicitly. Don't pass loose `{ id }` objects, and never compare role names.

## Rules that recur in review

- **OR'd grants**: `check(A) || check(B)` denies only callers missing both. Write the conjunction explicitly, and gate on the bit the eligible roles actually share today (`Member` holds `decisions: UPDATE` and profile `READ`).
- **Order grants**: let the broadest grant (admin) short-circuit before any lookup that can throw.
- **Fail as a denial**: if a lookup inside an authorization path fails (e.g. a stale `currentStateId`), treat it as no grant and throw `UnauthorizedError`, not a propagated `NotFoundError`.
- **Deny vs hide**: deny with `UnauthorizedError`. Hide a restricted row (draft, hidden, flagged) with `NotFoundError`, as `getProposal` does.
- **Relationship reads gate both ends**: write the visibility predicate once as a function of the table ref and apply it to every end. Decision read access doesn't imply access to every proposal. Joined metadata leaks too (a proposal profile's `name` is the proposal title).
- **Shared getters stay permissive** when admin mutations need restricted rows. Apply the restriction at the read call site and add a comment.
- **Assert and probe together**: when an existence probe runs in `Promise.all` with the assert, the assert's rejection wins, so unauthorized callers get the deterministic error.
- **Client-writable ids aren't authorization resources**: derive protected names (docs, paths, rooms) from immutable ids (`proposal-${proposal.id}`) instead of reading back a stored column.
- **Omitted fields are writes**: a partial update that replaces stored JSON can skip an immutability guard when the field is absent. Guard that case too.
- **Second paths repeat every precondition**: a second path to the same resource repeats all of the primary path's preconditions (e.g. the results-phase lock), not just the shared helper in the middle.
- **Two tiers means two endpoints**: if one mutation needs two permission tiers, add an endpoint for the looser case. Gate a lighter engagement action (like/follow) at the same bar as its heavier sibling (comment), never stricter.
- **Legacy org grants stay legacy**: don't copy the legacy implicit org-membership grant into new write paths. Gate it on the legacy condition.
- **"Least privileged" defaults**: test every grant that makes a role privileged (profile admin as well as decisions admin). Don't derive the default from a reordered first page.
- **Field redaction travels with the field**: reuse the canonical helper (`isAnonymousAuthor` / `proposalAuthorRelation` in `decision/proposalAuthor.ts`) and never re-select raw `profiles.name` / `avatarImage` for authors. When you notice copies, extract them.
- **Broadening user/profile reads**: strip email, phone, `isAnonymous` and roles at the encoder. Owner-only fields go on a conditional `.extend()` (`encoders/posts.ts`). Default to the narrower shape. A procedure tier doesn't filter fields.

## Errors

- `UnauthorizedError` (403): the caller lacks the resource permission.
- `AccessTierError`: thrown by tier middleware. `callerTier` is `none | anon | user | network`, and the status is 401 when `none`, otherwise 403.
- Rethrow `AccessControlException` as `UnauthorizedError`. All of these live in `packages/common/src/utils/error/index.ts`.

## Frontend

```tsx
<AccessBoundary required={{ profile: { admin: true } }} profileId={id} fallback={<Unauthorized />}>
```

- `<AccessBoundary>` (`apps/app/src/components/AccessBoundary.tsx`) reads `UserProvider`. `required` takes one condition or an OR-array, and `{}` denies. For booleans, use `useUser()`. Outside a provider, use `useMaybeUser()`.
- Gate the individual privileged action, not the whole menu (Report stays visible).
- Owner-or-admin actions use the owner-or-admin flag (`canManage || isEditable`), and sibling lists use identical conditions.
- Never re-derive a server rule or the current phase on the client. Return the decision as an encoder field. Reading server-computed flags (`instance.access.admin`) is fine.
- Links to walled-garden routes are gated with `useCanLinkToProfile`, and render as plain text when they aren't linkable.
- Client gating is UX only. Every mutation asserts on the server.

See [references/lessons.md](references/lessons.md) for the PR history behind these rules.

## Review checklist

- [ ] Every service mutation asserts resource access via a wrapper; no `access-zones` imports beyond `permission`/`checkPermission`
- [ ] Public callers folded via `resolveAccessUserIds`; no `user?.id` in a `where`
- [ ] Throwing `assert*` used when denial invalidates the request
- [ ] OR'd permission expressions are intentional; conjunction written explicitly
- [ ] Admin short-circuits before throwing lookups; auth-path lookup failures → `UnauthorizedError`
- [ ] Restricted rows hidden with `NotFoundError`; both ends of relationship reads gated
- [ ] Protected names derived from immutable ids; partial-update guards cover omitted fields
- [ ] Second paths to a resource repeat all preconditions of the first
- [ ] No legacy org-fallback grant copied into new writes
- [ ] New person/author reads reuse the redacting helper; sensitive fields stripped at the encoder
- [ ] Role caches invalidated on every role/membership mutation
- [ ] UI gates individual actions, matches server owner-or-admin rule, and doesn't re-derive server rules
