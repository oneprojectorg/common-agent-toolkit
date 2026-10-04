---
name: component-file-structure
description: React component file organization and conventions — types at top, main export next, helpers below, and never a component declared inside another component's render body (remount + focus loss); Suspense queries over useEffect, react-query over raw fetch, a Suspense suffix for suspending components, and a decorative suspense child needs its OWN error boundary or its failure takes down the whole panel; loading-state defaults must match the settled state (no flash) and skeleton bar counts must match real content; disable a control while its mutation is in flight, give a confirm-dialog toggle a pending value, and never enable an action whose payload is still loading; apply a permission guard to every element it governs (name AND avatar) and link an entity through one canonical route; never offer an action the server will refuse (the enablement predicate covers every condition the mutation rejects on) and mirror a server-side batch cap in the control that builds the batch; never infer a state TRANSITION from cached client state (an analytics milestone or survey trigger reads a `didPublish` the mutation returns — a stale or empty cache otherwise reports a launch that did not happen) and check whether the consumer already deduplicates before hand-rolling a once-per-session ref; an editor that round-trips stored data refuses records carrying keywords its writer cannot emit rather than silently dropping them on save, and decides renderability once so a field it hides is also out of `required`; derive a header's count from the collection the list actually renders; key a status-label map on the enum rather than Record<string, string> plus a `??` fallback that renders the raw value; single-fetch RSC + client useSuspenseQuery (server fetch seeds the dehydrated cache, no double-fetch); an error boundary around a non-suspense useQuery catches nothing (throwOnError defaults false) and APIErrorBoundary re-throws without a matching status code or a `default`; never filter a paged list on the client (the count, the empty state and the next page all inherit the lie — the filter belongs in the endpoint's input schema) and don't override a global react-query default (retry, staleTime) without a reason local to that call; nuqs for URL-driven state (filters, multi-step forms, modal toggles) — a URL param is untrusted input, so clamp/validate it on read (an input's maxLength does nothing for a shared link), keep a renamed query value's old spelling as an alias or every existing bookmark silently lands on the default, strip a one-shot flag on read with a replace-history update (refresh, Back and a shared link all replay it), let nuqs `createSerializer` own the encoding, and give every reachable param value an exit affordance at every breakpoint; register into a shared context with an instance-unique key and unregister in the effect's cleanup; an effect that writes imperative DOM state owns the branch that clears it, and a trailing `{...rest}` spread clobbers an internal ref; render the zero value instead of hiding the count, and make a route segment's source required at the type level so no one can build `/decisions/undefined/...`; "state unknown" is `data === undefined`, not `isError`, or a pending first fetch renders settled-looking interactive controls; two async results folded into one state must track per-request status or the first success masks the other's failure; don't swallow errors in server components (try/catch + scoped fallback or let it throw to error.tsx); mutation errors go to onError, not call-site try/catch; reusable hooks take a navigateTo callback, not a hardcoded route; minimal 'use client' (prefer server components / TranslatedText); explicit names (no single letters or abbreviations, no "New" prefix); no any / as / non-null !; consume API types from @op/api/encoders (never RouterOutput); no Record<string, unknown> as a typed-JSON escape hatch; composition over duplication when a pattern appears twice; pass a whole object (and a single permissions object) instead of many flattened props, decompose a ballooning prop list into composable sub-components, and treat show/hide boolean props as the composition smell they are; loading skeletons and above-the-fold layout must be SSR-able / CSS-only, not gated on a client-only library; import the React namespace explicitly (not the UMD global); no inline <style> @keyframes in JSX (SSR hydration + duplication); keep JSDoc in sync with behavior; store one-shot callback props in a ref rather than effect deps, and normalize array/object props internally so callers needn't memoize; a public prop must never silently no-op and a wrapper's props should be a superset of the hook it delegates to; never manually invalidate queries (realtime channels do it). A second surface onto an existing view (a sheet beside a route) inherits the route's analytics event, its scope check and its deep-link handling, and the query param it claims must not already be in use; a nested action inside a clickable card needs stopPropagation, not just preventDefault; a displayed count and the limit it counts against measure the same value; a bound you lower has to accept the rows already stored; error state keyed on a regenerable draft id goes stale. Browser storage is shared across tabs while a module-level write guard is not, so clear it on the cross-tab auth event rather than in the tab that signed out; an irreversible dialog re-derives its counts from live data because a retry after a refetch submits the set the list holds now; and a sanitizer that strips an embed's only element returns a truthy empty string that renders as a sized blank — branch on the sanitized output and fall back. Use when creating a new .tsx file, splitting a component, extracting a helper, naming things, deciding client vs server, deciding where types go, fetching data on the server vs the client, handling errors in RSC, picking nuqs vs useState, designing a hook's interface, designing a component's props, writing a loading skeleton, or consuming API data in a component.
---

## Order inside a file

1. **Types and interfaces** at the top.
2. **Main exported component** next — it's the headline, easy to find.
3. **Private sub-components and helpers** below.

The primary export should never be buried at the bottom under utilities.

**Don't split logic into its own file when it's used in exactly one place** — colocate or inline it into the consumer. PR #1585: "This file is only used in one place. just put these items into the file that uses them in that case." The one earned exception is a small *pure* module extracted so a unit test can import it **without** dragging the client component (and its `next-intl` / `next-navigation` deps) into the Node test env — keep that module dependency-free and note why it's separate.

**Never declare a component inside another component's render body.** A `const ToggleButton = (props) => …` in a function body is a *new component type* on every render, so React unmounts the entire old subtree and mounts a fresh one instead of updating it — state resets and, most visibly, focus is dropped. The bug bites hardest on a component that re-renders constantly: PR #1702's `RichTextEditorToolbar` re-renders on every cursor move and keystroke, so "pressing Bold … would re-render the toolbar, unmount the old `ToggleButton`, and drop focus before the roving-tabindex logic can restore it." Move the helper to module level (below the main export, per the ordering above) and pass what it was closing over as a prop.

**Import the `React` namespace explicitly** (`import * as React from 'react'`) whenever you reference it (`React.ComponentProps`, `React.ReactNode`, …) rather than leaning on the ambient UMD global `@types/react` exposes. The global happens to typecheck, but relying on it is fragile and inconsistent — match the sibling files, which import it explicitly. PR #1625 (a `@op/sense` component): "leaning on the UMD global is fragile … every sibling file imports it explicitly."

**Never inject a `<style>` tag with `@keyframes` (or other CSS rules) inside a component's JSX render tree.** Put keyframes / animation CSS in `@op/styles` (`theme.css` — PR #1756 collapsed the package to `tokens.css` + `theme.css`, so the old per-surface stylesheets are gone). An inline `<style>` in render duplicates the same `@keyframes` in the DOM for every mounted instance, and in Next.js SSR a server-injected `<style>` node triggers React hydration-mismatch warnings. PR #1624 moved a keyframe out of JSX into the shared stylesheet.

**Keep JSDoc / doc comments in sync with the component's actual behavior.** When you widen a component's applicability (e.g. it now renders for any non-member, not just the promote/anon-upgrade path), update the JSDoc — a stale comment describing the old, narrower contract misleads the next reader. PR #1638.

## Type discipline

- No `any` to suppress errors. Find the right type.
- Avoid `as` (type assertions). Use type guards or refine inputs instead.
- Prefer `unknown` + narrowing over `any`.
- **No `!` non-null assertions.** Reviewers call this out as "fishy" — narrow with a guard or restructure so the value is `T` not `T | undefined`.
- **No `Record<string, unknown>` as an escape hatch for JSON DB columns.** Recurring review pattern (#1039, #1065): JSON columns aren't typed at the database level, but they *should* be typed in TypeScript. If `rubric`, `instanceData`, or any JSON field needs a stricter shape, define a Zod schema for it and narrow at the boundary — don't propagate `Record<string, unknown>` through the component tree.

### Key a label map on the enum, so the compiler catches the next member

A status-label lookup typed `Record<string, string>` accepts any key, so adding a member to the enum it is supposed to cover compiles clean — and a `?? status` fallback under it then renders the raw database value (`awaiting_author_revision`) in a badge, in English, in production. Type the map as `Record<ProposalReviewAssignmentStatus, string>` (or key it on both enums when a cell is a product of two) and the missing entry is a build error the day the enum grows. PR #1848, still open on `ReviewAssignmentsPanel.tsx`.

The `??` is the load-bearing half of the defect: an exhaustive map needs no fallback, and writing one guarantees the gap goes unnoticed. If a fallback genuinely has to exist, make it visibly generic copy that goes through `t()` — never the raw key.

### API types — import from encoders, never `RouterOutput`

- To type API data in a component, import the type from `@op/api/encoders` — e.g. `import type { Organization } from '@op/api/encoders'`.
- **Never derive API types from `RouterOutput`** (`RouterOutput['x']['y']`). It couples the component to the router shape and breaks the moment a procedure is refactored.
- Need a type that doesn't exist yet? It's added at the API layer by defining/extending the encoder — see the `api-endpoints` skill. Don't reach for `RouterOutput` as a shortcut.

## Data fetching

- **Always prefer Suspense queries** (`useSuspenseQuery`, `useSuspenseQueries`) over `useQuery` + `useEffect` patterns.
  - When a component fires several reads at once, reach for `useSuspenseQueries` explicitly rather than stacking single hooks and trusting the transport to batch them. PR #2136: *"These requests are probably batched either way, but it's usually better to explicitly do so with useQueries or useSuspenseQueries."*
- **Reach for react-query (`useSuspenseQuery` / `useQuery`) over raw `fetch` + `try`/`catch`.** Raw fetches in a component duplicate everything react-query already gives you — caching, dedup, retries, error state. PR #1262 review: "We should lean into useSuspenseQuery and useQuery instead of fetch. This bakes in react-query so we get all the benefits of caching. We can avoid the try/catch there as a result."
- Wrap suspense queries with a proper `<ErrorBoundary>` — never let a thrown promise escape into a parent that doesn't handle it.
- **Scope the boundary to the toggled/optional region, not the whole subtree.** When a sub-query only fires in one mode (a map view, an expanded panel, a tab), wrap *that* subtree in its own local `<Suspense>` + `<APIErrorBoundary>`. The local `<Suspense>` keeps toggling into the mode from suspending or blanking the surrounding list; the local error boundary makes a fetch failure degrade only that region instead of bubbling to the page-level error fallback (PR #1553 self-review).
- **A `<Suspense>` handles the pending state, not the error state — decorative suspense children need their own error boundary that degrades to `null`.** `useSuspenseQuery` *throws* on failure, and the throw sails past the local `<Suspense>` to the nearest error boundary, which is usually the one wrapping the whole feature. PR #1689: a decorative "assigned categories" suffix on each reviewer card had a local `<Suspense>` but no boundary, so any failure of that one cosmetic query would "replace the entire 'Proposals to review' tab panel with 'We couldn't load proposals' — even though `listReviewAssignments` completed successfully … a non-critical decorative suffix failure would silently block all reviewers from accessing their queue." Ask, for every suspending child: if this query alone fails, how much of the page should disappear? If the answer is "just this bit," it needs its own boundary.

### Don't filter a paged list on the client

A filter applied to the page the server already returned is not a filter on the result set. The count above the list is wrong, the empty state fires while later pages hold matches, and every scroll re-runs it. PR #1923 shipped one as a patch and the review named the real fix: *"This works to patch what is there now, but it seems like we're actually patching something that is a really bad approach since it's doing the filter client side. This should definitely be happening on the back end, that way we can take into account pagination and reduce overfetching … Maybe we actually need to just attack the real problem which is that it needs to happen at the API level."* It merged as a non-regression stopgap with a follow-up for all the client-side filtering at once — which is the escape hatch, not the pattern. New filters go in the endpoint's input schema (see `api-endpoints`).

### Don't override a global query default without a local reason

`retry`, `staleTime`, `refetchOnWindowFocus` are set once for the app. A per-query override pins that query to today's value, so when the global changes the overridden one silently doesn't follow. PR #1817: *"Any reason to specify `retry: false` here? It's the global default so if we shift that it won't follow so wondering if that is so specific to this call."* The author's answer is the usual one — *"We initially set this because we probably didn't have the `enabled` part. It can go now"* — an override that outlived the condition it was written for.

The same thread carries the follow-on: *"On a side-note, we swallow errors a little further down, so I wonder if we should at least be trying to solve for transient errors either with retries or with error states."* Disabling retries and swallowing the error leaves a transient failure indistinguishable from an empty result. Pick one — surface the error, or let it retry.

### Pick the loading-state default that matches the settled state

A boolean derived from data that hasn't arrived yet renders with the wrong answer and then flips — a visible flash. `(reviewerCategories?.length ?? 0) !== 1` is `true` while the query is in flight, so a reviewer scoped to exactly one category saw the category tag on every card for a beat before it vanished (PR #1692). Two fixes, in order of preference:

1. **Promote the query to `useSuspenseQuery`** so nothing renders until it settles and the enclosing boundary shows the skeleton.
2. **Initialize to the conservative value** — the one that's correct for the common settled case, or the one whose wrong-guess is invisible (hide, not show) — and let the resolved data turn it on.

The general shape: derive the flag from `isLoading` explicitly rather than letting `undefined` fall through a comparison and answer for you.

**"State unknown" means `data === undefined`, not `isError`.** A guard that only recognises an initial *error* leaves the pending first fetch looking like a settled empty answer: existing likes and follows render as unpressed but still-interactive controls, so a click sends an add for something already added. `const stateUnknown = userRelationships === undefined` is the whole fix — it covers the pending first fetch *and* subsumes the initial-error case, while a failed **refetch** correctly keeps the controls live because the cached list survives it. PR #1770.

Grade the consequence honestly when you write this up: the insert there was `onConflictDoNothing` and the add/remove decision re-read the cache at click time, so the redundant write was a server no-op and the real symptom was a count one too high until the next reconciliation — narrower than the review's "unintended removal", and worth saying so.

### Guard a control while its mutation is in flight

Between `mutate()` and the refetch that removes the row, the button is still mounted and still clickable. A double-click or a slow network fires the mutation twice; the second one fails server-side and raises an error toast for an operation that actually succeeded. Disable the trigger on `isPending` (`isDisabled={removeReviewer.isPending}`). PR #1683: "the chip remains visible and clickable … the server will likely surface an error, which triggers the toast even though the first remove succeeded."

**A controlled toggle that opens a confirmation dialog needs a pending value.** If `isSelected` reads straight off the persisted state, the toggle snaps back to OFF the instant the modal opens — the click looks like it did nothing. Track a local `pendingValue`, render `persisted || pending`, and clear it on both confirm and cancel. PR #1696.

**A server-side cap needs its client-side counterpart, or Select-all becomes an error dialog.** When an input schema bounds a batch (`max(500)` on an id array), the control that builds that batch has to respect the same bound — otherwise "Select all" on a larger set produces a request that can only fail, and the failure surfaces as a raw Zod payload in a toast. PR #1848: nothing capped the selection, so the cap was discoverable only by hitting it. Import the constant from `@op/common` rather than repeating the number (see `service-layer-structure` on `constants.ts`), disable or truncate at the cap, and say what the limit is before the user reaches it.

**Don't enable an action whose payload is still loading.** A confirm button wired to data that arrives asynchronously will, if pressed early, hand the mutation an empty fallback (`?? {}`) — the hook early-returns, the modal doesn't close, and the flow *looks* like it completed while nothing changed. Gate the control on the payload being present, not just on the dialog being open. PR #1725: "the restore race should be fixed before merging because confirming a historical-version restore can silently leave the proposal unchanged … the restore controls are enabled immediately and pass an empty fallback into a hook that silently returns before closing the restoration UI."

### Don't offer an action the server will refuse

An entry point's enablement predicate has to cover **every** condition the mutation rejects on, not just the one the feature was designed around. Miss one and the UI presents a working affordance that cannot succeed: the user opens the dialog, fills it in, confirms, and gets an error — every time, for that entity, forever. PR #1831: the proposal admin menu offered the merge flow whenever the proposal had no *outgoing* merge edge, but `mergeProposals` also rejects a proposal that has other proposals merged *into* it, "leaving an action that cannot succeed for this proposal state."

When you add a rejection to a service, grep for the surfaces that gate on the old condition and widen them in the same PR. The reverse (a client rule the server doesn't enforce) is the `access-control` failure — see *never re-derive the server's authorization rule on the client* there. Between the two: the server decides, the client must not offer less-strictly than the server enforces, and neither side gets to be the only one that knows the rule.

### A state transition is the server's to report — don't infer one from cached state

An analytics milestone, a survey trigger, a "you just did X" toast: each of these is about a *transition*, and a client only has a snapshot. Reading a cached query to decide whether the transition happened gets it wrong twice over — the cache can be stale (another admin already published, so a successful no-op update reports a launch that wasn't) and it can be empty (no data yet, so the branch takes whichever way the `undefined` falls). PR #2092 shipped both on `LaunchProcessModal`.

The fix is the shape to copy: `updateDecisionInstance` already computed `isBeingPublished = status === PUBLISHED && existing.status === DRAFT` for its own server-side event, so it returns that as `didPublish` and the modal reads `data.didPublish` in `onSuccess`. The extra `getInstance` query added to guess at the pre-state is deleted outright — there is no cached state left to go stale. Extend the output schema per-procedure (`encoder.extend({ didPublish: z.boolean() })`) rather than widening the shared encoder. This is the analytics-shaped statement of the `access-control` rule about not re-deriving a server decision on the client.

The same PR carries the companion lesson about **hand-rolled client-side deduplication**: a `trackedInstanceId` ref lived in two components, so the two copies never saw each other's writes. The resolution was to delete the deduplication, not to share it — PostHog controls survey display frequency itself, so a repeated event does not mean a repeated prompt, and the guard was making the browser event mean something different from the server's. Before you build a once-per-session guard, check whether the consumer already solves it.

### A displayed count and the limit it counts against measure the same value

A character counter rendering `value.length` beside a validator checking `value.trim().length` disagrees on any padded input: the author sees 101/100 and the form saves anyway, or sees room left and gets rejected. PR #2158. Pick one measurement — usually the validator's — and let the counter read it, so the number on screen is the number being enforced.

**And a limit you lower has to accept the values already stored.** The same builder shipped tighter heading and description caps than the service schema had enforced, so an existing form with a 100-character heading loaded fine and refused to save — an admin making an unrelated edit had to shorten participant-facing copy first. When you tighten a bound, either grandfather stored values (validate on change, not on load) or migrate them; a new bound applied only at the write path turns existing rows into hostages.

**Error state keyed on a regenerable id goes stale.** That builder kept per-field problems from the last failed save and filtered them by field id; removing a field and adding another could reuse the id, so an old length error surfaced under a new empty question. Recompute or clear problems when the draft changes rather than carrying a snapshot forward.

### An editor that round-trips stored data refuses what it cannot write back

A parser that reads a stored structure into form state, and a builder that writes form state back, are two halves of a lossy conversion, and the loss is silent: the save path replaces the whole stored value, so every field the parser ignored is deleted by a user who only edited a title. PR #2096's custom-form builder considered a field editable on its basic type alone, while `minimum`, `maxLength`, `pattern`, `minItems` and `format` — real participant-facing validation rules — were dropped on save.

Preserving unknown keys through the round trip is the nicer outcome and it means the builder owns constraints it has no UI for. **Refusing is the honest option until it does**: treat any keyword the writer does not emit as unsupported and route that record into the existing refuse-to-edit path, at the field level *and* at the top level (`additionalProperties`). Whichever you pick, the test is a record carrying a keyword the UI can't express.

The sibling defect in the same PR is worth naming because it reads as the *opposite* bug: a renderer that hides a field it cannot draw, while leaving that field in the schema's `required` list, rejects every submission and hides the error too. Decide renderability once, up front, in one `canRenderField` predicate, and validate against a definition whose `required` contains only what was drawn — one decision, used by both the filter and the validator.

### Apply a guard to every element it governs

When a permission or capability flag controls whether something is a link, it has to reach **every** linked element for that entity — the name *and* the avatar *and* the surrounding card. Applying it to one and not the sibling reintroduces exactly the access the flag exists to prevent, and the diff looks fine because the guard is visibly present. PR #1695: "the `canLinkToProfile` guard is applied to the name link but silently dropped for the avatar. `ProfileAvatarLink` renders an `<a>` whenever `href` is non-null, so public/non-member viewers who should see a plain avatar will now get a clickable avatar link."

The same shape shows up as inconsistent destinations: linking one entity two ways from adjacent elements (avatar → `/profile/{slug}`, name → `/org/{slug}`) works but reads as two different things. Pick the canonical route and use it for every link to that entity. PR #1567.
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

**An error boundary around a non-suspense query catches nothing.** `useQuery` / `useMutation` default to `throwOnError: false` in react-query v5 (and `apps/app` sets no global override), so they never throw during render — an `<APIErrorBoundary>` wrapped around them sits there catching a throw that can't happen. Two consequences worth knowing before reaching for a boundary as the fix:

- **Know what `APIErrorBoundary` does with an unmatched error.** It keys fallbacks on `error.data?.httpStatus` and, with neither a matching code nor a `default`, **re-throws** — so a bare wrap escalates to the page boundary instead of containing anything. `{ default: () => null }` is how you drop a widget silently (`ReviewProgressStats`, `ReviewAssignmentsList`); an inline message is the other precedent (`ProposalsList`). A `null` *value* in the map is falsy and falls through to `default`/re-throw, which is not the same thing.
- **A non-throwing failure surfaces as the wrong message, and that's the real bug.** PR #1750: the export status query had no error handling, so a failed fetch left `status` undefined → `isRunning` stayed true → the silence timer fired *"Export timed out. Please try again."* while the workflow had written the file perfectly well. Routing that to a boundary requires `throwOnError: true` on the query — a behaviour change (fallback instead of toast), not a wrapper. Fix the state machine's unknown-vs-failed distinction first; add the boundary because a *suspense* query can throw, not as a substitute for handling a settled error.

### URL-driven UI state uses `nuqs`

When a piece of UI state should survive a reload, be link-shareable, or be readable by the server (e.g. filters, multi-step form progress, modal open/close, sign-in mode toggle), reach for **`nuqs`** instead of `useState`. Recurring review (PRs #1304, #1323): "use nuqs here for sure (as this one is a complicated beast of a form)" / "Maybe we should just standardize to nuqs here — they support server-side parsing as well" / "Filter state lives in the URL (nuqs)."

Keep `useState` for ephemeral state nobody links to (hover, focus, currently-typed-but-unsubmitted text). Anything you'd want a back/forward button to step through, or want to deep-link to, belongs in `nuqs`.

**A URL param is untrusted input — validate it on read, not just on the input.** A field's `maxLength` bounds typing and pasting; it does nothing for a value that arrives in the URL. PR #1788: `search` came straight off `useQueryState('q')`, so a shared link carrying an over-cap `?q=` reached the endpoint unbounded, failed input validation, and dropped the whole list into its error fallback — search field included, leaving a reload as the only way back. Clamp (or reject) **at the read**, not at the point where you build the request params:

```ts
const [urlSearch, setSearch] = useQueryState('q', parseAsString.withDefault(''));
const search = urlSearch.slice(0, PROPOSAL_SEARCH_MAX_LENGTH);
```

Clamping on read means every downstream consumer inherits the bound — the debounce, the query params, a map's location filter, the has-active-filter flag — and the field displays the term actually being searched. The same applies to any URL-sourced value the server will validate: an enum, an id, a page number.

**Renaming a URL param value breaks every existing link.** Query values are a public contract: bookmarks, shared links, and external references all carry the old one. PR #1773 renamed a tab value from `other` to `completed`, and the old value fell through the switch to the `active` default — so an existing "completed decisions" bookmark silently opened the Active tab. Keep the retired value as an alias mapping to the new branch (`other: 'completed'`) rather than relying on a default to absorb it.

**A one-shot flag in the URL is not one-shot — strip it on read.** A URL param is a re-enterable entry point: refresh, bookmark, Back and a shared link all replay it. So a param meaning "this just happened" keeps meaning it forever. PR #1828 put `?new=true` on the proposal editor to title it *"Create proposal"*; a draft can sit for days, and the editor's own Share button hands the flagged URL to a co-author, who is then told they're creating a proposal that already exists. The fix is to snapshot the flag into state on mount and immediately remove it from the URL with a **`history: 'replace'`** update — `replace` rather than `push` specifically so Back can't land on the flagged URL again — keeping the semantic guard (`isDraft`) as belt-and-braces so a hand-typed `?new=true` still can't mislabel a submitted proposal.

**Let `nuqs` do the serializing.** Don't hand-roll param encoding, separator parsing, or a second definition for "clear this param". `createSerializer` takes the same parser map you read with, so writing and stripping the flag go through one definition:

```ts
const serializeNewProposalParam = createSerializer({
  [PROPOSAL_EDITOR_NEW_PARAM]: proposalEditorNewParser,
});

export function withNewProposalParam(href: string): string {
  return serializeNewProposalParam(href, { [PROPOSAL_EDITOR_NEW_PARAM]: true });
}
```

PR #1828 review: *"Parsing this separator value out feels like something that nuqs should do for us"* — and passing `null` through the same serializer deletes the param, so the write and the strip stop being two hand-maintained code paths.

**Every param value a link can carry needs its exit affordance at every breakpoint.** If `?view=map` is reachable, the control that gets back to the list has to render wherever that URL can be opened — PR #1807 shipped a map mode whose only toggle was hidden below `sm`, so a mobile visitor following the link had no way back. Resolution: a floating switch that renders below `sm`, matching the browse list.

**A component that reads URL search params must sit under a `<Suspense>` boundary.** Anything that calls `useSearchParams` — directly or through `nuqs` `useQueryState` — suspends until hydration, so every mount point must be wrapped in `<Suspense>` (document this in the component's JSDoc). Pair it with a **pre-hydration fallback that still works** — e.g. a plain `<a>` link — so the control is usable before the client bundle hydrates. PR #1556: `JoinDecisionButton` "reads/writes `?join` via nuqs, so any mount point must sit under a Suspense boundary," backed by a `JoinDecisionButtonFallback` plain link "so the button works even before hydration."

### A second surface onto an existing view inherits everything the first one owes

Adding a sheet, a drawer or a modal that shows what a route already showed is a routing change disguised as a component, and it silently drops whatever the route was doing around the render. PR #2136 / #2176 added a proposal side sheet to the list and lost three things the full page had:

- **The analytics event.** `proposal_viewed` fired on the page; a normal desktop click now opens the sheet instead, so the most common read path stopped being recorded.
- **The scope check.** The page resolved the proposal under the current decision's route; the sheet fetched whatever id `?proposalPanel=` named, so an accessible proposal from *another* decision rendered over this decision's list, with its "open full page" link pointing somewhere else.
- **The deep link.** A desktop reader can share the resulting URL. On a phone the provider mounted neither the sheet nor a redirect, so the recipient got the bare list.

Before you ship the second surface, list what the first one does around the content — events, scoping, pending/error states, polling — and port or deliberately decline each one.

**And check the query param you reach for isn't already taken.** The same provider claimed `?proposal=`, which the anonymous-submission promotion flow already used to remember the submitted id, so finishing a submission popped an unrelated sheet and closing it destroyed the promotion flow's return target. Grep the route's params before naming a new one.

**A nested action inside a clickable card needs `stopPropagation`, not just `preventDefault`.** In the voting view, "Read full proposal" opened the sheet *and* bubbled to the card handler, toggling that proposal's ballot selection — so reading a proposal voted on it. `preventDefault` only cancels the navigation.

### Zero is a value — render it

A count that renders at 3 and vanishes at 0 reads as a bug, not as a design. Either the surface shows the metric or it doesn't; make that call once and apply it consistently. PR #1822 review: *"Aren't we either showing the counts or not? We would equally want to see a zero if there are no reviews … If we wanted to hide it when it was zero then maybe it should be consistently hidden then. Seems very confusing not to and might look more like a bug than a feature."* Resolution: show `0 Reviews`, per the designs. The same instinct catches an empty-state guard derived from a *filtered* total — a control disabled on `total === 0` for a filtered view is disabled while the instance has plenty of rows.

**A count in a header is derived from the collection the list renders — not from a neighbouring one.** Two collections that overlap for the common case diverge on the edge case, and the header then contradicts the rows directly under it. PR #1848: the panel header counted *eligible* reviewers while the table also rendered reviewers with review history who had since lost the `REVIEW` permission (`isEligible: false`), so it read "3 reviewers" above four rows. Derive the number from the same array you `.map()`, or from a total the server computed for that exact set.

**A route segment's source must be required at the type level wherever the link is built.** An optional slug interpolated into a path produces `/decisions/undefined/proposal/<id>/reviews` — a live link to nowhere, with no error anywhere. PR #1820 fixed it by making the slug required on the admin surfaces so the undefined link can no longer be constructed. Prefer that over a runtime `if (!slug) return null` at the one call site you remembered.

### Combining two async results: don't let one success mask the other's failure

When a screen fires two independent requests and folds them into one piece of state, a single non-null check makes the *first* success look like completion. PR #1798: the review screen launches a proposal translation and a rubric translation; either response alone made the combined `translated` state non-null, which hid the only retry banner — so when the rubric succeeded and the proposal failed, the proposal pane stayed untranslated with no "View original" control to reset it and try again. Track per-request status and derive the UI from all of them, or the partial-failure path becomes unreachable rather than merely degraded.

### Form validation: let the schema be the source of truth

The app's Zod / TanStack Form schema is the single source of truth for field validation. Watch for anything that enforces a *browser-native* constraint first: a `type="url"` field rejects a scheme-less URL (`example.com`) before the request ever reaches your schema, so no schema error renders and submission silently blocks with no visible reason. PR #1578 fixed exactly that case, and the durable half is the follow-up: **when you fix a validation-behavior bug on one field, audit every equivalent field in the codebase** — the reviewer will ("Also needed on … `PersonalDetailsForm.tsx` url field, not sure if there are others").

(The original fix was React Aria's `validationBehavior="aria"`. React Aria is no longer in the app — the design system is Base UI via `@op/sense` — so the prop is gone; the failure mode isn't.)

### Build submission payloads from the persisted store, not ephemeral state

For a multi-step / persisted form, build the submit payload from the **persisted store** (the source of truth), not from a component's local React state. Local `values` state resets to empty on any remount — a retry after a transient failure, or a refresh — silently sending fields as `undefined`. PR #1583: `submitOrganization` built its payload from `MultiStepForm`'s ephemeral local state which "resets to `[]` on any remount," sending `orgType`/`bio` as undefined; the fix reads from the store via `getOrgCreationStepValues()` because "the store is the real source of truth."

### Wrap browser storage access so it degrades gracefully

`localStorage` / `sessionStorage` access can throw — quota overflow, private mode, blocked cookies, SSR. Wrap it so a failure logs a warning and the flow keeps working in memory instead of crashing. PR #1608: storage access is wrapped "so a quota overflow (or a browser where storage is disabled …) degrades gracefully: the form keeps working in memory and logs a warning instead of throwing." (See the `file-uploads` skill for the companion rule: never persist transient base64 `data:` URLs to storage in the first place.)

### Browser storage is shared across tabs — a module-level guard is not

A `let persistenceEnabled = true` that a sign-out flips lives in one tab's module instance. The `localStorage` key it guards is shared by every tab on the origin, so the second tab never sees the flip, finishes a pending write, and puts the previous account's `getMyAccount` payload back under the same cache buster — available to whoever opens the browser next. PR #2057, flagged as a security finding and confirmed: *"The switch is per tab while the cache key is shared, so a second tab could write the account back."*

The fix is to take the signal that *is* cross-tab. Supabase broadcasts `SIGNED_OUT` to every tab over a `BroadcastChannel`, so the root auth-state listener ends persistence and erases the key wherever it fires — which also covers the local sign-out performed on an invalid session. Generalise it: when state is scoped to the origin rather than to the tab, the thing that clears it has to be scoped the same way. Prove it with a two-page spec (see `test-conventions`); a one-tab test passes on the broken build.

The related half of that thread is about *where* the erase sits rather than whether it is wrapped: a `try`/`catch` around the removal that logs and continues lets sign-out and navigation proceed with the payload still on disk. Run the erase where an exception rejects the mutation instead, and resist adding handling for failures the API does not have — `removeItem` does not throw on quota, and a browser that throws `SecurityError` on `removeItem` threw it on `setItem` too, so nothing was ever persisted there.

### A retry submits what the list holds now, not what the dialog showed

A confirmation dialog captures counts when it opens; a failed submission that refetches changes the underlying selection underneath it. PR #2180: when a submit failed because a selected proposal had left the eligible pool, the refetch dropped it from the live selection while the composer stayed open showing the original counts — so pressing retry published a different set of winners than the admin confirmed, with no indication anything had changed.

Any dialog whose action is irreversible has to re-derive its summary from the live data on every render, or close and make the user re-confirm when the underlying set changes. A snapshot taken at open time is only safe for an action that cannot be retried.

### A sanitized string that is empty is still truthy

An allowlist sanitizer can remove *everything* and hand back `''` — or hand back a wrapper with nothing in it. The call site usually branches on the original HTML being non-empty, so it renders the sized container and nothing inside: a video-shaped blank. PR #2178's `LinkPreview` sanitized Iframely embeds that consist only of an `<iframe>`, stripped the iframe, and drew an empty player where a perfectly good thumbnail was available.

Branch on the **sanitized** output, and have a fallback for "sanitization removed the content" that is distinct from "there was no content". The same PR carries the sizing counterpart: keeping an embed's aspect ratio while discarding the wrapper that carried its `padding-top` offset renders some card embeds too short and clips their bottom content — when you reconstruct a provider's markup, carry every property that contributed to its box, not the one you recognised.

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

### Registering into a shared context: unique key in, unregister on the way out

An effect that registers something into a provider (a translation surface, a sample of content, a scroll target) needs **an instance-unique key** and **an unregister in its cleanup**. Two P1s in the same window came from the two halves of that:

- No cleanup — the inactive proposal surface unmounts and its key stays in the registry forever (#1811, `TranslationDetectionContext`).
- Non-unique key — every `ResourcesList` registered under the literal `resources`, so the last collection to mount silently replaced every earlier sample (#1799).

Key on something the instance owns (an id, a slug, a `useId()`), and return the matching `unregister` from the effect. A registry that only ever grows is the same defect class as the channel-subscription leak in the `realtime-channels` skill.

### An effect that writes imperative state owns the branch that clears it

When an effect sets an inline style, an attribute, or a listener based on a condition, the `else` is not "do nothing" — it's "undo what a previous run wrote." PR #1813 shipped both halves of this in one component: the effect skipped its `paddingBlock` assignment when the condition went false but never cleared the value already on the node, and a `findScrollParent` measurement taken once on mount permanently bound the listener to `window` when the real ancestor only became scrollable after async content loaded. If the input can change, the effect has to be able to run backwards; if the measurement depends on content, it can't be a one-shot.

**And never spread `{...rest}` after an internal `ref`.** A trailing spread that carries a `ref` replaces yours, which silently disables everything the ref powers — observers, measurements, the padding effect, the dimming (#1813). Put the spread first, or compose the two refs explicitly.

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
- **The tell that you've written one is a double refetch for the actor.** `AssignProposalsDialog` calls `utils.decision.listPhaseReviewAssignments.invalidate(...)` in `onSuccess` while `listPhaseReviewAssignments` already registers `Channels.reviewAssignments` and `assignReviews` publishes to it — so the person who clicked refetches twice and everyone else refetches once (#1848, still on `dev`). Before adding an `invalidate` call, check whether the query and the mutation already name the same channel; they usually do, and then the call is pure cost.

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
- **Booleans that hide or show a region are the specific smell.** `showScore`, `showBudget`, `isAdmin`, `withActions` — each one adds a branch inside the component for something the *caller* already knows, and they accumulate faster than anyone notices because each is individually reasonable. Lift the region out and let the call site pass it (or not). PR #1859 review, flagged across several PRs at once rather than against one diff: *"We are starting to pass a lot of boolean props into components rather than lifting the composable elements up. Not flagging it as a blocker or issue but something I am noticing across a few PRs now and it's a bit of a code smell."* The accepted counter-argument in that thread was narrow and worth knowing: a **static, non-data-driven** table whose column set is fixed at design time can carry a couple of them without earning a composition rewrite. If the set of things being toggled is open-ended, that defence doesn't apply.
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
- **Count the bars.** A multi-line skeleton primitive takes a `lines` prop for a reason — swapping three single-line placeholders for `<SkeletonText lines={10} />` renders 30 bars where the real content is three short labels, so the page collapses when the data lands. Match the bar count to the content the slot actually holds (PR #1693).

## Performance

When writing or refactoring components, follow the `vercel-react-best-practices` skill. It's the source of truth for waterfall avoidance, bundle size, server/client data fetching, re-render and rendering performance. Cross-reference its rules (e.g. `async-parallel`, `bundle-barrel-imports`, `rerender-derived-state-no-effect`) before reaching for `useEffect`, before adding a barrel import, and before chaining `await`s.

## If statements and braces

- K&R braces, never single-line: write `if (x) { foo(); }` (or with newlines), never `if (x) foo();`.

## Re-use existing utilities before writing new ones

Before adding a helper, grep for one. Recurring review pattern: "I'm pretty sure we are already doing this for other server-side posthog events that exist already. We should re-use it." If you're tempted to write `getServerFeatureFlag` / `getDisplayName` / `getRoute*`, look first — the codebase has utilities for almost every variant of "compute X from Y."

## Verify

After edits to a component, run `pnpm w:app typecheck` to catch regressions.
