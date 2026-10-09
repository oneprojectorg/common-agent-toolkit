---
name: component-file-structure
description: "React component conventions for apps/app .tsx: file order, useSuspenseQuery + APIErrorBoundary, RSC single-fetch via createServerUtils, nuqs URL state, 'use client' limits, props, skeletons, mutation UX. Use when creating/splitting a component, fetching data in a component, or adding a hook."
---

Conventions for React components in `apps/app`. Common's `CLAUDE.md` owns the basics: file order, suspense over `useEffect`, error boundaries. This skill adds to it.

Other owners (link, do not restate):
- Naming, types, errors, guards, logging, composition: `code-conventions`.
- Cache refresh after a mutation: `realtime-channels`.
- Strings: `i18n-strings`. Tokens, a11y, `@op/sense`: `sense-conventions`.
- React performance (waterfalls, bundles, re-renders, memo, effects): `vercel:react-best-practices`.

Past review incidents, one line each: [references/lessons.md](references/lessons.md).

## File layout

- Order: types, then the main export, then private sub-components and helpers.
- Never declare a component inside another component's body. React remounts it on every render, so state resets and focus drops. Move it to module level and pass what it closed over as props.
- Do not put logic used in one place in its own file. Exception: a small pure module that a unit test imports without the client component.
- `import * as React from 'react'` when you reference `React.*`. Do not rely on the UMD global.
- No `<style>` or `@keyframes` in JSX. Put animation CSS in `@op/styles` `theme.css`.
- Name a component that calls `useSuspenseQuery` / `useSuspenseQueries` with a `Suspense` suffix (`OrganizationSearchScreenSuspense`).
- Keep JSDoc in sync with behaviour when you widen what a component does.

## Data fetching

- Use `useSuspenseQuery`, or `useSuspenseQueries` for several reads at once. Use react-query, not raw `fetch` with `try`/`catch`.
- Every suspending subtree has `<Suspense>` plus `<APIErrorBoundary>` (`@/utils/APIErrorBoundary`). Scope both to the optional region (a tab, a map view, a decorative suffix). Ask: if this query alone fails, how much of the page should disappear?
- `APIErrorBoundary` matches `error.data?.httpStatus`, then `default`, and otherwise re-throws. Use `{ default: () => null }` to drop a widget silently.
- An error boundary around a non-suspense `useQuery` catches nothing (`throwOnError` defaults to false). Handle the settled error state instead.
- "State unknown" is `data === undefined`, not `isError`. Otherwise a pending first fetch renders controls that look settled and are interactive.
- Choose a loading default that matches the settled state, or suspend. A flag computed from `undefined` data flashes.
- Two async results folded into one state track status per request. One success must not hide the other's failure.
- Never filter or sort a paged list on the client. Put the filter in the endpoint's input schema (`api-endpoints`).
- Do not override global query defaults (`retry`, `staleTime`) without a reason specific to that call.
- Before you add an `invalidate()`, check whether the query and the mutation already share a channel (`realtime-channels`).

### RSC single fetch

The server fetch seeds the dehydrated cache, and the client `useSuspenseQuery` hydrates from it. That is one network call.

```tsx
// page.tsx (server)
import { HydrationBoundary, createServerUtils, dehydrate } from '@op/api/server';

const { utils, queryClient } = await createServerUtils();
await utils.decision.getInstance.fetch({ instanceId });

return (
  <HydrationBoundary state={dehydrate(queryClient)}>
    <DecisionOverviewSuspense instanceId={instanceId} />
  </HydrationBoundary>
);
```

- Do not refetch the same query in a child only to get types. Pass the value, or use the same query key.
- Render server-renderable rich content (TipTap or markdown) on the server and pass it down as a `ReactNode` prop.
- Do not swallow server errors. Either `try`/`catch` and render a fallback scoped to the section, or let the error reach `error.tsx`. A best-effort prefetch can catch and `logger.warn` when the client refetches under its own boundary.
- Missing resource or no access: on the server, `handleServerError(error)` (`@/utils/handleServerError`, typed `: never`). On the client, wrap in `ResourceErrorBoundary`.

## Mutations and actions

- Handle failures in the mutation's `onError`, not in a `try`/`catch` around `mutate()`.
- Show the user localized copy, not `error.message` (`i18n-strings`).
- Disable the trigger while `isPending`.
- A toggle that opens a confirm dialog keeps a pending value until confirm or cancel.
- Do not enable an action until its payload has loaded.
- The enablement predicate covers every condition the server rejects on. When you add a rejection to a service, update every surface that offers the action.
- Mirror a server batch cap (`max(500)`) in the control that builds the batch. Import the constant from `@op/common`.
- The server reports a state transition (for example it returns `didPublish`). Do not infer one from cached client state.
- An irreversible dialog derives its counts from live data on every render. A retry submits what the list holds now.
- Build a multi-step form's submit payload from the persisted store, not from local state.
- A hook that mutates and then navigates takes a `navigateTo` / `onSuccess` callback. It does not hard-code a route. Wrap follow-up navigation in `startTransition`.
- A nested action inside a clickable card calls `stopPropagation`, not only `preventDefault`.

## URL state (nuqs)

- State that should survive a reload, be shareable, or step with Back uses `nuqs` `useQueryState`. Ephemeral UI state uses `useState`.
- A URL param is untrusted input. Clamp or validate it where you read it: `urlSearch.slice(0, PROPOSAL_SEARCH_MAX_LENGTH)`.
- When you rename a param value, keep the old value as an alias.
- Remove a one-shot flag (`?new=true`) on read with `history: 'replace'`.
- Let nuqs parsers serialize. Do not hand-roll separator parsing.
- Every reachable param value has an exit control at every breakpoint.
- Before you claim a new param name, grep the route for it.
- A component that reads search params sits under `<Suspense>` and has a fallback that works before hydration.
- A second surface onto a route (a sheet or a drawer) takes over the route's analytics event, its scope check and its deep-link handling.

## Props

- Pass the whole entity, not three or more of its fields. Pass several permission flags as one permissions object.
- A long prop list, or booleans that show or hide a region (`showScore`, `withActions`), means you should compose: let the caller pass the region.
- A public prop never silently does nothing for some callers. Rename it, document it, or make it work for everyone.
- A wrapper's props are a superset of the hook it wraps (for example `required`).
- Do not expose two props that emit the same value.
- Make a route segment's source required at the type level (no `/decisions/undefined/...`).
- Key a label map on the enum (`Record<Status, string>`), with no `??` raw-value fallback.

## Rendering details

- Render zero. A count is either always shown or always hidden.
- A header count comes from the same array the list maps over.
- A displayed count and its limit measure the same value (for example both use `trim()`).
- When you lower a bound, it still accepts stored values.
- Recompute error state keyed on an id that can be regenerated when the draft changes.
- An editor that round-trips stored data refuses records with keywords it cannot write back. Decide renderability once, so a hidden field is also out of `required`.
- Branch on the sanitized output. An empty sanitized string is still truthy.
- A permission guard reaches every element it governs (the name and the avatar). Link each entity through one canonical route.
- `'use client'` only when the component needs state, effects, handlers, refs or browser APIs. Push it to the smallest leaf. For strings, a server component uses `getTranslations` (`i18n-strings`).

## Effects, refs, storage

- An effect that registers into a shared context uses an instance-unique key and unregisters in cleanup.
- An effect that writes imperative DOM state also clears it on the other branch. Never put a trailing `{...rest}` spread after your own `ref`.
- Observe a DOM node through a callback ref into state (`ref={setNode}`), not `ref.current` in an effect.
- A one-shot callback prop goes in a ref, not in effect deps. Normalize array or object props internally, so callers do not need to memoize. Details: `vercel:react-best-practices`.
- Wrap `localStorage` access so that a failure degrades to memory with a warning. Storage is shared across tabs, so clear it on the cross-tab auth event (`SIGNED_OUT`), not with a per-tab flag.

## Skeletons

- Skeletons and above-the-fold layout are SSR-able and use only CSS. Do not gate them on a client-only library.
- A skeleton mirrors the real layout classes (sticky, height, grid) so nothing shifts. Each tab has its own `loading.tsx`.
- Match `SkeletonText lines` to the real content.

## Verify

`pnpm w:app typecheck`.

## Review checklist

- [ ] File order is correct. No component declared inside another. Suspending components have the `Suspense` suffix
- [ ] Suspense queries have scoped `<Suspense>` + `<APIErrorBoundary>`. No boundary around a non-suspense query
- [ ] RSC uses `createServerUtils()` + `HydrationBoundary`. No duplicate client fetch. No swallowed server errors
- [ ] No client-side filtering or sorting of paged data. No unexplained query-default overrides
- [ ] Mutation errors go in `onError`. Triggers are disabled while pending. The enablement predicate matches every server rejection
- [ ] No `toast.error(error.message)`
- [ ] URL params are read with nuqs, clamped or validated on read, and renamed values keep aliases
- [ ] No flattened entity props, no show/hide boolean props, no props that silently do nothing
- [ ] Counts render zero and come from the rendered collection. Label maps are keyed on the enum
- [ ] `'use client'` is only where needed, on the smallest leaf
- [ ] Effects clean up registrations and imperative state. No `{...rest}` after `ref`
- [ ] Skeletons are CSS-only, mirror the layout, and have the right line counts
- [ ] Every new `invalidate()` is justified against `realtime-channels`
