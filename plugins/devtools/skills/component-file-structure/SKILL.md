---
name: component-file-structure
description: React component file organization and conventions — types at top, main export next, helpers below; Suspense queries over useEffect and a Suspense suffix for suspending components; minimal 'use client' (prefer server components / TranslatedText); explicit names (no single letters or abbreviations); no any / as; consume API types from @op/api/encoders (never RouterOutput); never manually invalidate queries (realtime channels do it). Use when creating a new .tsx file, splitting a component, extracting a helper, naming things, deciding client vs server, deciding where types go, or consuming API data in a component.
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

### API types — import from encoders, never `RouterOutput`

- To type API data in a component, import the type from `@op/api/encoders` — e.g. `import type { Organization } from '@op/api/encoders'`.
- **Never derive API types from `RouterOutput`** (`RouterOutput['x']['y']`). It couples the component to the router shape and breaks the moment a procedure is refactored.
- Need a type that doesn't exist yet? It's added at the API layer by defining/extending the encoder — see the `api-endpoints` skill. Don't reach for `RouterOutput` as a shortcut.

## Data fetching

- **Always prefer Suspense queries** over `useQuery` + `useEffect` patterns.
- Wrap suspense queries with a proper `<ErrorBoundary>` — never let a thrown promise escape into a parent that doesn't handle it.
- **Name suspending components with a `Suspense` suffix.** If a component calls `useSuspenseQuery` or `useSuspenseQueries`, name it `MyComponentSuspense` (e.g. `OrganizationSearchScreenSuspense`). The name signals to every caller that the component suspends and must be rendered under a `<Suspense>` / `<ErrorBoundary>` boundary — there's no other way to tell from the call site.

### Cache invalidation — realtime channels, never manual

- **Never manually invalidate queries** in a component after a mutation — no `queryClient.invalidateQueries(...)`, no `utils.x.y.invalidate()`, no `refetch()` to "make it fresh."
- Invalidation is push-based via **realtime channels**. `QueryInvalidationSubscriber` (`apps/app/src/components/QueryInvalidationSubscriber.tsx`) subscribes to channels and invalidates the matching query keys automatically — both for the local mutation and for changes pushed from other clients over the websocket.
- The wiring lives on the procedures (the query and the mutation register the same channel), not in the component. If data isn't refreshing after a mutation, the fix is a missing/mismatched channel — see the `api-endpoints` skill — not a manual invalidate.

## `'use client'` discipline

- **Only add `'use client'` when the component actually needs it** — state, effects, event handlers, refs, browser APIs, or a client-only hook. Server components are the default; a client boundary opts the whole subtree out of server rendering and ships it to the browser.
- Before adding the directive, check whether a **server-friendly alternative** exists:
  - Translations: a server component can render `<TranslatedText text="..." />` (`@/components/TranslatedText`) instead of becoming a client component just to call `useTranslations`. See the `i18n-strings` skill.
- If you add `'use client'`, push it **as far down the tree as possible** — make the small interactive leaf a client component, not its server-renderable parent.

## Naming

- **No single-letter names** and **no shortened abbreviations** — they're unclear at the call site. Write `organization`, not `o` or `org`; `index`, not `i`; `response`, not `res`. Spell it out.
- Names should read on their own. A reader should never have to find the declaration to know what a variable holds.
- (The exception that earns its keep: see the `Suspense` suffix convention above for suspending components.)

## Performance

When writing or refactoring components, follow the `vercel-react-best-practices` skill. It's the source of truth for waterfall avoidance, bundle size, server/client data fetching, re-render and rendering performance. Cross-reference its rules (e.g. `async-parallel`, `bundle-barrel-imports`, `rerender-derived-state-no-effect`) before reaching for `useEffect`, before adding a barrel import, and before chaining `await`s.

## If statements

- K&R braces, never single-line: write `if (x) { foo(); }` (or with newlines), never `if (x) foo();`.

## Verify

After edits to a component, run `pnpm w:app typecheck` to catch regressions.
