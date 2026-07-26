---
name: component-file-structure
description: React component file organization and conventions — types at top, main export next, helpers below; Suspense queries over useEffect, react-query over raw fetch, and a Suspense suffix for suspending components; single-fetch RSC + client useSuspenseQuery (server fetch seeds the dehydrated cache, no double-fetch); nuqs for URL-driven state (filters, multi-step forms, modal toggles); don't swallow errors in server components (try/catch + scoped fallback or let it throw to error.tsx); mutation errors go to onError, not call-site try/catch; reusable hooks take a navigateTo callback, not a hardcoded route; minimal 'use client' (prefer server components / TranslatedText); explicit names (no single letters or abbreviations, no "New" prefix); no any / as / non-null !; consume API types from @op/api/encoders (never RouterOutput); no Record<string, unknown> as a typed-JSON escape hatch; composition over duplication when a pattern appears twice; pass a whole object (and a single permissions object) instead of many flattened props, and decompose a ballooning prop list into composable sub-components; loading skeletons and above-the-fold layout must be SSR-able / CSS-only, not gated on a client-only library; import the React namespace explicitly (not the UMD global); no inline <style> @keyframes in JSX (SSR hydration + duplication); keep JSDoc in sync with behavior; store one-shot callback props in a ref rather than effect deps, and normalize array/object props internally so callers needn't memoize; a public prop must never silently no-op and a wrapper's props should be a superset of the hook it delegates to; never manually invalidate queries (realtime channels do it). Use when creating a new .tsx file, splitting a component, extracting a helper, naming things, deciding client vs server, deciding where types go, fetching data on the server vs the client, handling errors in RSC, picking nuqs vs useState, designing a hook's interface, designing a component's props, writing a loading skeleton, or consuming API data in a component.
---

## Order inside a file

1. **Types and interfaces** at the top.
2. **Main exported component** next — it's the headline, easy to find.
3. **Private sub-components and helpers** below.

The primary export should never be buried at the bottom under utilities.

**Don't split logic into its own file when it's used in exactly one place** — colocate or inline it into the consumer. PR #1585: "This file is only used in one place. just put these items into the file that uses them in that case." The one earned exception is a small *pure* module extracted so a unit test can import it **without** dragging the client component (and its `next-intl` / `next-navigation` deps) into the Node test env — keep that module dependency-free and note why it's separate.

**Import the `React` namespace explicitly** (`import * as React from 'react'`) whenever you reference it (`React.ComponentProps`, `React.ReactNode`, …) rather than leaning on the ambient UMD global `@types/react` exposes. The global happens to typecheck, but relying on it is fragile and inconsistent — match the sibling files, which import it explicitly. PR #1625 (a `@op/sense` component): "leaning on the UMD global is fragile … every sibling file imports it explicitly."

**Never inject a `<style>` tag with `@keyframes` (or other CSS rules) inside a component's JSX render tree.** Put keyframes / animation CSS in a stylesheet (`@op/styles`, e.g. `sense-theme.css`). An inline `<style>` in render duplicates the same `@keyframes` in the DOM for every mounted instance, and in Next.js SSR a server-injected `<style>` node triggers React hydration-mismatch warnings. PR #1624 moved a keyframe out of JSX into `@op/styles/sense-theme.css`.

**Keep JSDoc / doc comments in sync with the component's actual behavior.** When you widen a component's applicability (e.g. it now renders for any non-member, not just the promote/anon-upgrade path), update the JSDoc — a stale comment describing the old, narrower contract misleads the next reader. PR #1638.

## Type discipline

- No `any` to suppress errors. Find the right type.
- Avoid `as` (type assertions). Use type guards or refine inputs instead.
- Prefer `unknown` + narrowing over `any`.
- **No `!` non-null assertions.** Reviewers call this out as "fishy" — narrow with a guard or restructure so the value is `T` not `T | undefined`.
- **No `Record<string, unknown>` as an escape hatch for JSON DB columns.** Recurring review pattern (#1039, #1065): JSON columns aren't typed at the database level, but they *should* be typed in TypeScript. If `rubric`, `instanceData`, or any JSON field needs a stricter shape, define a Zod schema for it and narrow at the boundary — don't propagate `Record<string, unknown>` through the component tree.

### API types — import from encoders, never `RouterOutput`

- To type API data in a component, import the type from `@op/api/encoders` — e.g. `import type { Organization } from '@op/api/encoders'`.
- **Never derive API types from `RouterOutput`** (`RouterOutput['x']['y']`). It couples the component to the router shape and breaks the moment a procedure is refactored.
- Need a type that doesn't exist yet? It's added at the API layer by defining/extending the encoder — see the `api-endpoints` skill. Don't reach for `RouterOutput` as a shortcut.

## Data fetching

- **Always prefer Suspense queries** (`useSuspenseQuery`, `useSuspenseQueries`) over `useQuery` + `useEffect` patterns.
- **Reach for react-query (`useSuspenseQuery` / `useQuery`) over raw `fetch` + `try`/`catch`.** Raw fetches in a component duplicate everything react-query already gives you — caching, dedup, retries, error state. PR #1262 review: "We should lean into useSuspenseQuery and useQuery instead of fetch. This bakes in react-query so we get all the benefits of caching. We can avoid the try/catch there as a result."
- Wrap suspense queries with a proper `<ErrorBoundary>` — never let a thrown promise escape into a parent that doesn't handle it.
- **Scope the boundary to the toggled/optional region, not the whole subtree.** When a sub-query only fires in one mode (a map view, an expanded panel, a tab), wrap *that* subtree in its own local `<Suspense>` + `<APIErrorBoundary>`. The local `<Suspense>` keeps toggling into the mode from suspending or blanking the surrounding list; the local error boundary makes a fetch failure degrade only that region instead of bubbling to the page-level error fallback (PR #1553 self-review).
- **Name suspending components with a `Suspense` suffix.** If a component calls `useSuspenseQuery` or `useSuspenseQueries`, name it `MyComponentSuspense` (e.g. `OrganizationSearchScreenSuspense`, `DecisionOverviewSuspense`). The name signals to every caller that the component suspends and must be rendered under a `<Suspense>` / `<ErrorBoundary>` boundary — there's no other way to tell from the call site. Review feedback (#1248): "It's really nice to keep the standard of `DecisionOverviewSuspense` so it's visible to see that this component will suspend."

### Single-fetch RSC: server fetch seeds the client query cache

When a page renders the same query on the server *and* in a client subtree (the usual case for a page that loads quickly via RSC but wants client-side cache, refetches, or realtime invalidation downstream), the right shape is **one fetch on the server that seeds the dehydrated cache the client `useSuspenseQuery` hydrates from** — not two independent fetches. PR #1332 review: "Fetching `getInstance` here looks redundant with the client `useSuspenseQuery` in `DecisionOverviewContent`, but it's one fetch, not two: `utils…fetch()` renders the body as RSC **and** seeds the cache the client query hydrates from. Single fetch, no server/client divergence." PR #1417 (`perf(decisions): single-fetch /overview`) was the cleanup pass that dropped a redundant `getInstance` after this pattern was established.

```tsx
// server: page.tsx — fetch once on the server, hand off via the dehydrated cache
const utils = await getServerUtils();
const instance = await utils.decision.getInstance.fetch({ instanceId });

return (
  <HydrationBoundary state={dehydrate(utils.queryClient)}>
    {/* ServerComponent rendered with `instance` for synchronous body output… */}
    <DecisionOverview aboutSlot={<RichTextRenderer doc={instance.overview.body} />}>
      {/* …client subtree hydrates from the same query — no second network call */}
      <DecisionOverviewSuspense instanceId={instanceId} />
    </HydrationBoundary>
  </HydrationBoundary>
);
```

```tsx
// client: DecisionOverviewSuspense.tsx — re-uses the seeded cache entry
const { data: instance } = trpc.decision.getInstance.useSuspenseQuery({ instanceId });
```

Two things to avoid:

- **Don't refetch the same query in a child client component just for typing.** That's the regression PR #1417 fixed. If the parent (server or client) already has the row, pass the resolved value or use a `useSuspenseQuery` with the same key — the cache entry is already there.
- **Don't pre-render rich content in the client.** When the body of a section is server-renderable HTML/JSON (a TipTap doc, a markdown block), render it on the server and pass it down as a `ReactNode` slot prop — the prose ships as HTML with zero client JS, only the interactive islands stay client. PR #1332: "`aboutSlot` is the body pre-rendered on the **server** (RSC, in page.tsx) and passed as a slot into this client component… only LinkPreview embeds stay client islands."

### Don't swallow errors

In server components (RSC) and async loaders, surface failures — don't `.catch(() => null)` a section into silent emptiness. Two reviewer-approved shapes:

- **`try` / `catch` around the fetch** and render a small in-place fallback ("couldn't load X") scoped to that section, not the whole page. PR #1350: "switched it to surface a small 'couldn't load pinned resources' message in the section instead of silently rendering nothing. scoped to its own boundary so a failure here doesn't take down the whole overview."
- **Let it throw** and rely on the nearest `error.tsx` (or a wrapping `<ErrorBoundary>`) to render the fallback. PR #1417 review: "Let's use try/catch here." PR #1341: "I don't think we should swallow errors here."

The anti-pattern is `await fetchX().catch(() => undefined)` followed by silently rendering nothing — users can't tell whether the section is empty or broken, and the error never reaches the error reporter.

**Resource errors → navigation interrupts, not a 500.** When a page fetch fails because the resource is missing or the caller lacks access, map it onto the matching Next.js navigation interrupt instead of letting it bubble as a 500. Client subtrees: wrap the suspense query in `ResourceErrorBoundary` (over `APIErrorBoundary`), which maps 400/404 → `notFound()` and 403 → `forbidden()`. Server components / RSC loaders: pass the caught error to `handleServerError(error)`, which inspects `error.cause instanceof CommonError` (tRPC's server caller re-throws with the original CommonError as `error.cause`) and calls `notFound()` for 404, `forbidden()` for 401/403, else rethrows. A helper like this that always ends control flow (rethrows or triggers an interrupt) should be typed `: never` so the caller's type-checker knows nothing runs after it — `export function handleServerError(error: unknown): never`. PR #1526.

### URL-driven UI state uses `nuqs`

When a piece of UI state should survive a reload, be link-shareable, or be readable by the server (e.g. filters, multi-step form progress, modal open/close, sign-in mode toggle), reach for **`nuqs`** instead of `useState`. Recurring review (PRs #1304, #1323): "use nuqs here for sure (as this one is a complicated beast of a form)" / "Maybe we should just standardize to nuqs here — they support server-side parsing as well" / "Filter state lives in the URL (nuqs)."

Keep `useState` for ephemeral state nobody links to (hover, focus, currently-typed-but-unsubmitted text). Anything you'd want a back/forward button to step through, or want to deep-link to, belongs in `nuqs`.

**A component that reads URL search params must sit under a `<Suspense>` boundary.** Anything that calls `useSearchParams` — directly or through `nuqs` `useQueryState` — suspends until hydration, so every mount point must be wrapped in `<Suspense>` (document this in the component's JSDoc). Pair it with a **pre-hydration fallback that still works** — e.g. a plain `<a>` link — so the control is usable before the client bundle hydrates. PR #1556: `JoinDecisionButton` "reads/writes `?join` via nuqs, so any mount point must sit under a Suspense boundary," backed by a `JoinDecisionButtonFallback` plain link "so the button works even before hydration."

### Form validation: let the schema be the source of truth

On React Aria Components form fields (`TextField`, etc.), set `validationBehavior="aria"` so the app's Zod / TanStack Form schema is the single source of truth. The React Aria default is `validationBehavior="native"`, which enforces the browser's native constraints first — a `type="url"` field rejects a scheme-less URL (`example.com`) *before* the request ever reaches your schema, so no schema error renders and submission silently blocks. PR #1578: adding `validationBehavior="aria"` fixed the scheme-less-URL case, "matching the existing pattern already used in `ProcessSurveyModal` and `CustomFormModal`." When you fix a validation-behavior bug on one field, audit and apply the same fix to every equivalent field — the reviewer will (PR #1578: "Also needed on … `PersonalDetailsForm.tsx` url field, not sure if there are others").

### Build submission payloads from the persisted store, not ephemeral state

For a multi-step / persisted form, build the submit payload from the **persisted store** (the source of truth), not from a component's local React state. Local `values` state resets to empty on any remount — a retry after a transient failure, or a refresh — silently sending fields as `undefined`. PR #1583: `submitOrganization` built its payload from `MultiStepForm`'s ephemeral local state which "resets to `[]` on any remount," sending `orgType`/`bio` as undefined; the fix reads from the store via `getOrgCreationStepValues()` because "the store is the real source of truth."

### Wrap browser storage access so it degrades gracefully

`localStorage` / `sessionStorage` access can throw — quota overflow, private mode, blocked cookies, SSR. Wrap it so a failure logs a warning and the flow keeps working in memory instead of crashing. PR #1608: storage access is wrapped "so a quota overflow (or a browser where storage is disabled …) degrades gracefully: the form keeps working in memory and logs a warning instead of throwing." (See the `file-uploads` skill for the companion rule: never persist transient base64 `data:` URLs to storage in the first place.)

### Mutation errors go to `onError`, not the call site

When a mutation can fail, handle the failure in the mutation's `onError` callback — not in a `try` / `catch` around the `mutate()` call, and not in a sibling effect that watches for `mutation.isError`. PR #1293 review: "Should this go to the mutation's onError callback instead?" That's the one place that runs exactly once per failed mutation, has access to the typed error, and composes with `toast.error` / form-error wiring already in the codebase.

### Reusable hooks: pass the navigation callback, don't construct it

When a hook orchestrates a mutation **and** then triggers a navigation (the "do X, then go to the new resource" pattern), take a **`navigateTo`** / **`navigateAfter`** callback from the caller — don't build the route inside the hook. PR #1291 review on `useCreateProposal`: "I'd rather we pass a `navigateTo` or `navigateAfter` than construct the path in this hook." Constructing the path inside the hook hard-couples it to one consumer's URL shape and breaks the next time the same hook is needed from a different surface (e.g. an admin tool vs the public page).

```ts
// ✅ Reusable — caller decides what "after success" means.
const { mutate } = useCreateProposal({
  onSuccess: ({ proposalId }) => {
    startTransition(() => {
      router.replace(routes.decision.proposalEdit(slug, proposalId));
    });
  },
});

// ❌ Hard-coded — the hook now only works in one place.
const { mutate } = useCreateProposal({ instanceSlug: slug });  // routes itself
```

The same principle applies to copy / toasts / analytics events — make the side effects parameters of the hook, not assumptions baked into it. The hook is reusable iff it doesn't know which page is calling it.

### Use `startTransition` for non-urgent post-mutation work

After a mutation resolves, wrapping the follow-up navigation / cache wiring in `startTransition` (from `react`) keeps the click-handling responsive — React deprioritizes the transition so a slow re-render of the destination doesn't block the optimistic UI on the page the user just clicked from. PR #1291 review: "Can we use `startTransition`?" → adopted.

```ts
const [isPending, startTransition] = useTransition();

const onSuccess = ({ proposalId }: { proposalId: string }) => {
  startTransition(() => {
    router.replace(routes.decision.proposalEdit(slug, proposalId));
  });
};
```

This applies most directly to navigation, suspense-triggering state changes, and large list re-keys. `isPending` is also a clean source for a "we're working on it" indicator that doesn't lie about which step is slow.

### Observing a DOM node — callback ref into state, not `ref.current` in an effect

To attach an observer (Resize/Intersection/Mutation) or react to a DOM node's lifecycle, hold the node in state via a callback ref — `const [node, setNode] = useState<HTMLElement | null>(null)` passed as `ref={setNode}` — and depend on `node` in the effect. Don't read `ref.current` inside an effect: a `useRef` mutation doesn't re-run the effect, so it silently misses late mounts and never detaches on unmount. Keep the setter identity-stable (the bare `setNode`) so React only invokes the callback ref when the element actually mounts/unmounts, not on every render. PR #1558 self-review.

### A one-shot callback prop belongs in a ref, not the effect's deps

When an effect notifies a parent via a callback prop but should fire only **once** (a one-shot transition like "editor ready"), store the callback in a ref (updated in a separate no-dep effect) and depend the firing effect only on the *triggering value* — not the callback. Parents commonly pass inline arrow functions that get a new reference every render, so including the callback in the dep array turns a one-shot init into a repeating side-effect (re-firing focus / analytics / hydration). PR #1623: "`onEditorReady` re-fires on every parent re-render that produces a new callback reference." (This is the app-level statement of the Vercel skill's `advanced-event-handler-refs` / `advanced-use-latest` rules.)

```tsx
const onEditorReadyRef = useRef(onEditorReady);
useEffect(() => { onEditorReadyRef.current = onEditorReady; });          // keep it current
useEffect(() => { if (editor) onEditorReadyRef.current?.(editor); }, [editor]);  // fire once per editor
```

### Don't push a memoization requirement onto callers — normalize array/object props internally

When an array or object prop feeds an effect's dependency array (or is passed to a memoized child that compares by reference), don't rely on the caller to `useMemo` it — the requirement is invisible on the component's public API, and an inline literal from the parent re-fires the effect on every render. Normalize the value internally: derive a keyed `useMemo` from its scalar contents. PR #1627: a `bounds` array prop drove `fitBounds` on every parent render — "a continuous 1-second camera animation loop … that requirement isn't obvious from the API surface" — fixed by normalizing `bounds` via a keyed `useMemo` "so consumers don't need to memoize it themselves." Conversely, when *you* build an array/object in a component body and pass it to a memoized child (a `Select`, a chart), wrap it in `useMemo` with the right deps so an unrelated state change (a sibling search box keystroke) doesn't re-render the child (PR #1651).

### Cache invalidation — realtime channels, never manual

- **Never manually invalidate queries** in a component after a mutation — no `queryClient.invalidateQueries(...)`, no `utils.x.y.invalidate()`, no `refetch()` to "make it fresh."
- Invalidation is push-based via **realtime channels**. `QueryInvalidationSubscriber` (`apps/app/src/components/QueryInvalidationSubscriber.tsx`) subscribes to channels and invalidates the matching query keys automatically — both for the local mutation and for changes pushed from other clients over the websocket.
- The wiring lives on the procedures (the query and the mutation register the same channel), not in the component. If data isn't refreshing after a mutation, the fix is a missing/mismatched channel — see the `api-endpoints` skill — not a manual invalidate.

### Optimistic updates ≠ manual invalidation

Optimistic updates are still allowed — they're for instant feedback / ordering (e.g. preventing a flash of empty state). The rule above is specifically about **invalidation** (telling React Query to re-fetch). If you find yourself optimistically updating to compensate for slow realtime invalidation, the fix is upstream channel wiring, not local state.

## `'use client'` discipline

- **Only add `'use client'` when the component actually needs it** — state, effects, event handlers, refs, browser APIs, or a client-only hook. Server components are the default; a client boundary opts the whole subtree out of server rendering and ships it to the browser.
- Before adding the directive, check whether a **server-friendly alternative** exists:
  - Translations: a server component can render `<TranslatedText text="..." />` (`@/components/TranslatedText`) instead of becoming a client component just to call `useTranslations`. See the `i18n-strings` skill.
- If you add `'use client'`, push it **as far down the tree as possible** — make the small interactive leaf a client component, not its server-renderable parent.
- A small client-only component nested under an already-client parent is fine; don't over-engineer to push every leaf to the server (#1151 review: "it's such a small component under a client component that it's not worth overthinking it").

## Naming

- **No single-letter names** and **no shortened abbreviations** — they're unclear at the call site. Write `organization`, not `o` or `org`; `index` over a bespoke `i`; `response`, not `res`; `authorization`, not `authz`. Spell it out. The only accepted universal exceptions are a loop counter `i` / `j` and the translation `t()` (#1405); don't invent other self-aliased single letters like `h()`.
- Names should read on their own. A reader should never have to find the declaration to know what a variable holds.
- **Don't prefix the normal case with "New"** — only legacy cases get the modifier. `DecisionHeader` and `LegacyDecisionHeader`, not `NewDecisionHeader` and `DecisionHeader`.
- **Domain-specific names beat generic ones**: `ProposalReviewCard`, not `Item`. Reviewers flag generic names in any non-leaf component.
- Helper utilities: `get*` for "returns a value" (`getReviewsGroupedByRecommendation`), `is*` / `has*` for booleans, `assert*` for "throws on failure." Recurring review feedback: "I tend to strongly prefer these phrased more as `getReviewsGroupedByRecommendation()` — clearer and signals there's a return value."
- The exception that earns its keep: the `Suspense` suffix convention above for suspending components.

## Composition over duplication

This is the single most common review-rejection theme in the codebase. When you see *or write* the second copy of a component, extract it.

- A shared component that exists once is fine. The same component pattern existing in two places (`ManualSelectionList` and `ReviewSelectionList` with 80% overlap) is a flag — pull a shared `SelectableList` and feed it data. Recurring review (#1068): "There is quite a bit of duplication... we should reduce external dependencies and keep it composable."
- Prefer **composition via `children`** to slot props with logic branches. If a component's API is starting to grow `slot1` / `slot2` / `headerNode` / `footerNode` props, the right move is usually to flip the composition: let the parent pass children, and have the wrapper component just compose layout.
- When a file is getting "thick" (`ProposalsList.tsx` is the running gag), don't add another conditional branch — split out a sibling component. Reviewers will still merge a fat file with a note ("this file needs a refactor"), but new feature work shouldn't pile on.
- The third copy is the merge-blocker. The first occurrence is fine. The second is a flag. The third gets the PR sent back.
- **Static prose pages follow the existing Content + page + Modal shape.** When adding a public info page, factor the copy into a shared `XContent` component and surface it in both the full `/info/<slug>` page and an `XModal` — mirror the established ToS/Privacy pair (`CoCContent` → `CoCModal` + `/info/tos`), don't duplicate markup between page and modal. PR #1505.

## Prop design

- **Pass the whole object, not its flattened fields.** When you'd hand a component 3+ fields off the same entity, pass the entity. PR #1439 review on `DecisionOverview` (three flattened steward props): "Maybe just pass in the steward?" — resolved by passing the whole `steward` object.
- **Multiple permission props → one permissions object.** PR #1470 review: "This actually should have just been passed permissions originally. As soon as we start to have multiples of these permission props we should probably just pass permission objects."
- **A ballooning prop list is a decomposition smell.** PR #1450 review: "that is a lot of props :) It feels like a sign that we need to compose out of a few components." Split into composable sub-components (which also enables reuse, e.g. a standalone filter bar) — see **Composition over duplication** above.
- **A public prop must not silently do nothing for a whole category of callers.** If a prop only applies under a condition (e.g. `title` rendered only when `isPdf`), either drop the guard so it works for everyone, rename it to signal the constraint (`pdfTitle`), or document the constraint on the interface — otherwise callers pass it and get no output and no warning. PR #1626: "`title` prop is silently dropped for non-PDF content … part of the public interface with no documentation that it's PDF-only."
- **A wrapper's prop interface should be a superset of the hook it delegates to.** When a component wraps a lower-level hook, expose every meaningful hook option — accessibility props especially (`required` / `aria-required`) — through its own props too. Omitting one forces consumers into a TypeScript error or down to the raw hook even though the plumbing already exists. PR #1623 (`RichTextEditor`): "`required` prop silently absent from component API … `useRichTextEditor` accepts a `required` flag but `RichTextEditor`'s props omit it entirely."
- **Don't expose two props that emit the same value.** `onUpdate` and `onChange` both returning `editor.getHTML()` means a consumer who wires up both — assuming they fire on different events — gets every notification twice. If it's an intentional migration alias, say so in JSDoc; otherwise deprecate one. PR #1623.

## Magic numbers and inline strings

- Extract numeric constants when the meaning isn't obvious. `86_400_000` → `MILLISECONDS_PER_DAY` (or a date library — `date-fns` is in the codebase).
- Don't hardcode display strings — wrap in `t()` / `<TranslatedText>` (see the `i18n-strings` skill). Reviewers will block on untranslated UI strings.
- Hardcoded magic strings in business logic (`'yes'`, `'no'`, `'pending'`) should be enum-backed or use a Zod literal union when they cross a boundary.

## Optional vs undefined

When a prop is truly optional, prefer `prop?: T` (which resolves to `T | undefined`) over `prop: T | undefined`. Don't introduce an extra type alias (`type Cap = number | undefined`) — it's defensive and obscures the API. PR #1033 closed by **dropping** the `VoteCap` type entirely in favor of inline `maxVotesPerMember?: number`.

## Skeletons and above-the-fold layout must be SSR-able

- **Don't gate a loading skeleton (or above-the-fold layout) on a client-only library.** It should paint on first byte, not wait for client JS to load and hydrate. PR #1455 review on a masonry skeleton: "Do we really need to do the masonry here? Let's just use CSS grid for this so we can SSR it" and "Let's fix the Skeleton as we want that to appear as soon as possible rather than after we have loaded the masonry library on the client."
- **Approximate the layout with pure CSS.** For a masonry placeholder, CSS columns get you close enough without the client lib: `columns-1 md:columns-2 lg:columns-3 gap-6` on the container, with `mb-6 break-inside-avoid` on each child. Swap in the real client-only layout only once the data has loaded.
- **Mirror the real component's exact layout, not just its rough shape.** The skeleton and the resolved component must share the same sticky/border/height/grid classes and confine scroll to the same row, so the real component swaps in with no layout shift, gutter shift, or scroll-position reset (PR #1518: the `loading.tsx` shell mirrors the layout grid — `h-dvh` with scroll confined to the content row — and `DecisionHeaderBarSkeleton` mirrors the header's fixed-height sticky bar: same sticky/border/height classes). Give each tab its own `loading.tsx` so the skeleton matches that tab's layout, not a generic one.

## Performance

When writing or refactoring components, follow the `vercel-react-best-practices` skill. It's the source of truth for waterfall avoidance, bundle size, server/client data fetching, re-render and rendering performance. Cross-reference its rules (e.g. `async-parallel`, `bundle-barrel-imports`, `rerender-derived-state-no-effect`) before reaching for `useEffect`, before adding a barrel import, and before chaining `await`s.

## If statements and braces

- K&R braces, never single-line: write `if (x) { foo(); }` (or with newlines), never `if (x) foo();`.

## Re-use existing utilities before writing new ones

Before adding a helper, grep for one. Recurring review pattern: "I'm pretty sure we are already doing this for other server-side posthog events that exist already. We should re-use it." If you're tempted to write `getServerFeatureFlag` / `getDisplayName` / `getRoute*`, look first — the codebase has utilities for almost every variant of "compute X from Y."

## Verify

After edits to a component, run `pnpm w:app typecheck` to catch regressions.
