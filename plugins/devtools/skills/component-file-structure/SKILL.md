---
name: component-file-structure
description: React component file organization and conventions — types at top, main export next, helpers below; Suspense queries over useEffect and a Suspense suffix for suspending components; minimal 'use client' (prefer server components / TranslatedText); explicit names (no single letters or abbreviations, no "New" prefix); no any / as / non-null !; consume API types from @op/api/encoders (never RouterOutput); no Record<string, unknown> as a typed-JSON escape hatch; composition over duplication when a pattern appears twice; never manually invalidate queries (realtime channels do it). Use when creating a new .tsx file, splitting a component, extracting a helper, naming things, deciding client vs server, deciding where types go, or consuming API data in a component.
---

## Order inside a file

1. **Types and interfaces** at the top.
2. **Main exported component** next — it's the headline, easy to find.
3. **Private sub-components and helpers** below.

The primary export should never be buried at the bottom under utilities.

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
- Wrap suspense queries with a proper `<ErrorBoundary>` — never let a thrown promise escape into a parent that doesn't handle it.
- **Name suspending components with a `Suspense` suffix.** If a component calls `useSuspenseQuery` or `useSuspenseQueries`, name it `MyComponentSuspense` (e.g. `OrganizationSearchScreenSuspense`, `DecisionOverviewSuspense`). The name signals to every caller that the component suspends and must be rendered under a `<Suspense>` / `<ErrorBoundary>` boundary — there's no other way to tell from the call site. Review feedback (#1248): "It's really nice to keep the standard of `DecisionOverviewSuspense` so it's visible to see that this component will suspend."

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

- **No single-letter names** and **no shortened abbreviations** — they're unclear at the call site. Write `organization`, not `o` or `org`; `index`, not `i`; `response`, not `res`; `authorization`, not `authz`. Spell it out.
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

## Magic numbers and inline strings

- Extract numeric constants when the meaning isn't obvious. `86_400_000` → `MILLISECONDS_PER_DAY` (or a date library — `date-fns` is in the codebase).
- Don't hardcode display strings — wrap in `t()` / `<TranslatedText>` (see the `i18n-strings` skill). Reviewers will block on untranslated UI strings.
- Hardcoded magic strings in business logic (`'yes'`, `'no'`, `'pending'`) should be enum-backed or use a Zod literal union when they cross a boundary.

## Optional vs undefined

When a prop is truly optional, prefer `prop?: T` (which resolves to `T | undefined`) over `prop: T | undefined`. Don't introduce an extra type alias (`type Cap = number | undefined`) — it's defensive and obscures the API. PR #1033 closed by **dropping** the `VoteCap` type entirely in favor of inline `maxVotesPerMember?: number`.

## Performance

When writing or refactoring components, follow the `vercel-react-best-practices` skill. It's the source of truth for waterfall avoidance, bundle size, server/client data fetching, re-render and rendering performance. Cross-reference its rules (e.g. `async-parallel`, `bundle-barrel-imports`, `rerender-derived-state-no-effect`) before reaching for `useEffect`, before adding a barrel import, and before chaining `await`s.

## If statements and braces

- K&R braces, never single-line: write `if (x) { foo(); }` (or with newlines), never `if (x) foo();`.

## Re-use existing utilities before writing new ones

Before adding a helper, grep for one. Recurring review pattern: "I'm pretty sure we are already doing this for other server-side posthog events that exist already. We should re-use it." If you're tempted to write `getServerFeatureFlag` / `getDisplayName` / `getRoute*`, look first — the codebase has utilities for almost every variant of "compute X from Y."

## Verify

After edits to a component, run `pnpm w:app typecheck` to catch regressions.
