---
name: test-conventions
description: Test conventions — Vitest for unit / service-layer / integration tests (.test.ts, run with pnpm test) vs Playwright for end-to-end (.spec.ts, run with pnpm e2e), the E2E env shim, and the describeAccessTierGating helpers for access-tier gating coverage on tRPC endpoints. Use when writing a new test, deciding between unit vs integration vs e2e, picking the right file suffix or location, naming a describe / it block, adding gating coverage to a new procedure, waiting on async state in Playwright without a flaky hardcoded sleep (use auto-retrying assertions), selecting an element by testid/role instead of structural DOM traversal, seeding through the service layer instead of hand-writing rows (Vitest calls @op/common directly via TestDecisionsDataManager; Playwright can't import it, so extend the shared @op/test factories rather than inserting per spec — and know which derived writes a raw insert skips), writing a test data helper that throws like production rather than no-opping, using a real parser instead of a hand-rolled reader in the assertion path, testing the intersection of two behaviours a change makes coexist rather than each half, keeping `as const` in fixtures (it is a const assertion, not a type assertion a review bot should strip), debugging a failing test, or fixing missing env vars in Playwright runs.
---

## Three test surfaces

| Kind | Runner | Location | Suffix | Run with |
|---|---|---|---|---|
| **Unit / service-layer / integration** | Vitest | `services/api/src/**`, `services/realtime/src/**`, `packages/common/src/**`, `services/emails/.react-email/**` | `.test.ts` | `pnpm test` (root, runs Turbo across workspaces) or `pnpm w:api test` for a single workspace |
| **E2E (browser)** | Playwright | `tests/e2e/tests/<feature>.spec.ts` | `.spec.ts` | `pnpm e2e` (root) or `pnpm w:e2e e2e` |
| **A11y baseline** | Playwright | `tests/e2e/tests/a11y-baseline.spec.ts` | `.spec.ts` | `pnpm a11y:baseline` (or `pnpm w:e2e a11y:baseline`) |

Keep the suffixes consistent — `.test.ts` files are picked up by Vitest, `.spec.ts` by Playwright. Don't mix them.

## Where to add a test

Decide by what you're testing, not by where it's easiest to write:

- **Pure logic / data shapes / service-layer functions** → Vitest, colocated with the source. Example: `packages/common/src/services/decision/votingEligibility.test.ts` next to `votingEligibility.ts`.
- **tRPC router behavior** → Vitest in `services/api/src/routers/<area>/<name>.test.ts`. The default is integration tests against a real Postgres (the workspace test setup boots an isolated Supabase on the `55xxx` range) — that's how we caught the recurring "mock said pass, prod said fail" class.
- **DB access helpers / low-level utils that touch the DB** → integration test directly against the helper (#1086 review pattern: "I mean an integration test that calls the helper directly against the DB. In the same category as the integration tests we already have, just with a narrower scope than an API test. The win is that we can exhaust permutations of EntityType × policy × admin/non-admin cheaply"). Example: `voteDataAggregator.test.ts`.
- **A user-visible flow that crosses the UI ↔ API ↔ DB boundary** → Playwright spec in `tests/e2e/tests/`. Use one of the existing specs as a shape reference (`tests/e2e/tests/onboarding.spec.ts`, `proposal-view.spec.ts`, etc.).
- **Accessibility regression** → add an assertion in `a11y-baseline.spec.ts`, don't fork a new spec.

If a bug fix has a service-layer cause, the test belongs in Vitest even if the symptom was UI. A Playwright spec is the right call only when the failure mode genuinely needs a browser to reproduce.

**A11y known-violations ledger.** The a11y CI bot (`a11y-known-violations`) diffs each PR's a11y scan against the baseline ledger at `tests/e2e/a11y-baseline/known-violations.json`. Any NEW violation blocks merge until you either fix it or add an explicit entry to that file — the bot comments e.g. `New (3) ⚠️ Either fix or add an entry to tests/e2e/a11y-baseline/known-violations.json`, such as a serious `link-in-text-block` on `/info/columbus-addendum`. Prefer fixing; adding a ledger entry is a deliberate acknowledgement of accepted debt, not a rubber stamp — don't silence the bot by deleting existing entries (PR #1505 / #1521).

**A regression test must reproduce the exact path.** A regression test must fail before the fix and pass after — and for the *exact* reason of the bug. If the obvious test passes both before and after the fix, it isn't exercising the buggy path; engineer the scenario that forces it (PR #1558 self-review: the grid-mode test passed either way, so the regression test used a location-field template to put the sentinel behind the pin query's Suspense boundary and force the late-mount attach). If you can't construct a case that fails on the unpatched code, you haven't proven the fix.

**Cover query internals and wire shape when you change them.** When you rework a query's ordering or relation-hydration internals, add regression tests that pin *distinct* sort-key values and assert the returned order survives the re-order step, and seed a nested relation and assert its hydrated shape is preserved (PR #1516 — the two-step page-then-hydrate rewrite). When you change an endpoint's output shape, add a test asserting the new field survives tRPC's output `parse` — it silently strips any field the encoder doesn't list, so a card renders blank with no error (PR #1551; see the `api-endpoints` skill).

## Naming `describe` and `it` blocks — read like a sentence

Recurring review pattern: `it()` and `describe()` should read like a sentence describing the assertion, not a snippet of jargon.

- ✅ `it('shows the creator their draft when viewing the phase it was created in', ...)`
- ❌ `it('no-JWT caller on non-public instance', ...)` (review: "Otherwise I'm not really sure if this should pass or fail when I have no JWT.")

When you write a test you can't summarize in a sentence, the test is probably testing two things — split it.

**One test file per source unit** is the default. If you've added `listProposalsBallot.test.ts` *and* `listProposalsPhaseScoped.test.ts` for the same `listProposals.ts`, reviewers will ask you to either merge them into `listProposals.test.ts` or rename to `listProposals.ballot.test.ts` / `listProposals.scoped.test.ts` so the source file is unambiguous (PR #1084).

## Test data reuse

- Use the shared `testData.createProposal` / `createOrganization` / etc. helpers — don't reinvent setup. If a helper needs a new parameter (`status`), thread it through rather than building a parallel fixture.
- Merge near-identical `it` blocks for performance. Reviewer (#1084): "Can we merge this into 'shows the creator their draft when viewing the phase it was created in' for performance?" Test setup is expensive; one `it` with two assertions is better than two `it`s with the same setup.

## Seed through the service layer, not around it

Reviewer note on #1799: **"Use the service layers in the e2e tests."** A row you insert by hand is a row production never wrote. The test then pins a shape the app doesn't produce — and the derived writes the service would have made are simply absent, so the spec exercises a path that doesn't exist in the product.

**Vitest integration tests: call the real service.** `services/api/src/test/helpers/TestDecisionsDataManager.ts` is the pattern — *"Uses service-layer calls from @op/common to set up fixtures without tRPC/session overhead"* — importing `createProposal`, `createDecisionInstance`, `advancePhase`, `joinOrganization` from `@op/common` and calling them with a `user`. New fixtures for a service-layer or router test go through that manager, not through fresh `db.insert` calls.

**Playwright e2e can't import `@op/common` today**, so it uses the shared `@op/test` factories in `tests/core/` (`createOrganization`, `createDecisionInstance`, `createProposal`, `createReviewScenario`, …). Two blockers, both recorded in the source: `packages/common` has no `"type": "module"`, which breaks CJS/ESM interop under Playwright's Node runtime (`tests/core/src/decision-data.ts`), and `@op/common` services import `db` from `@op/db/client`, whose first line is `import 'server-only'` — Vitest neutralises that with `vi.mock('server-only', () => ({}))` in its setup, and Playwright's runner has no equivalent. So in e2e the rule is one step removed: **seed through the shared factory, extend the factory when it lacks a field, and never hand-roll inserts in a spec.** A per-spec `db.insert` is the thing to push back on in review.

**Know what the factory doesn't write.** These are the real gaps between `@op/test`'s factories and their `@op/common` counterparts, and each one has silently mis-scoped a spec:

| Skipped by the raw insert | Consequence in the test |
|---|---|
| Title-derived unique slug (`generateUniqueProfileSlug`) | Slug/URL assertions pin `proposal-<uuid>`, a shape production never emits |
| Phase-default `visibility: HIDDEN` | Specs patch it back with a follow-up `db.update` "simulating what createProposal does" |
| `proposalCategories` link rows | A `category` set only inside the `proposalData` JSON is invisible to every read that joins the link table |
| Location sync + boundary-category derivation | Map, location filter and district tagging find nothing |
| `parseProposalData` validation, access asserts | The test creates data (and in phases) production would reject |
| Per-instance `accessRoles` (`createDefaultDecisionRoles`) | The factory attaches the *global* seeded Admin role, so permission resolution takes a different branch and role pickers see zero process roles |
| `decisionProcessTransitions` | Every "published" instance has no scheduled transitions, which is what the phase monitor reads |
| `rootProfileId` / `rootPostId` on posts | These are the authorization gate; NULL sends reads down the *legacy* branch, so the spec covers the old auth path, not the current one |
| Moderation submission rows, notification events, cache invalidation | Anything downstream of content submission never happens |

So: if you're about to write an insert because the factory doesn't cover your case, add it to the factory. If you genuinely must inline a production constant or algorithm in a spec, comment it with what it has to stay in sync with — `tests/core` does this (`"Mirrors what createDecisionRole in @op/common writes, without importing it"`, `"Must match production's categoryTermUri"`), which is what makes the drift findable later.

**Reach for the file's existing type guard before an `as` cast.** When a test needs to narrow a fixture (`proposalData`, an instance's JSON config), the file usually already has the helper — #1789 replaced an `as` cast with the file's own `seedProposalCollab`, which narrows with a type guard. That several neighbouring tests still use the cast is not a justification: *"the pattern I copied was the local convention rather than an oversight"* — the helper is the right target for those too, in their own PR.

## Access-tier gating tests (`describeAccessTierGating`)

PR #1225 added a generic gating matrix for tRPC endpoints in `services/api/src/test/helpers/gating/index.ts`. Use it whenever you add or change the procedure tier of an endpoint.

```ts
import { describeAccessTierGating, accessTierGatingCell } from '../../test/helpers/gating';

describeAccessTierGating('myEndpoint', {
  noJwt:      accessTierGatingCell('no JWT is rejected at the network tier',  async (ctx) => { ... expectFailsAccessTierGate(..., 'none') ... }),
  anonJwt:    accessTierGatingCell('anonymous JWT is rejected at the network tier', async (ctx) => { ... expectFailsAccessTierGate(..., 'anon') ... }),
  userJwt:    accessTierGatingCell('out-of-network user JWT is rejected', async (ctx) => { ... expectFailsAccessTierGate(..., 'user') ... }),
  networkJwt: accessTierGatingCell('network user is admitted past the gate', async (ctx) => { ... expectPassesAccessTierGate(...) ... }),
});
```

- All four `GatingCells` keys are required — forgetting one is a compile error.
- `expectFailsAccessTierGate` asserts the gate **rejected** the caller (matches on `cause.callerTier` and the matching 401/403 status code).
- `expectPassesAccessTierGate` asserts the gate **let the caller through** — the call may still fail later (resource not found, deeper authorization), but not at the tier gate.

When you migrate an endpoint down the ladder (e.g. `networkAuthenticatedProcedure` → `authenticatedProcedure`), the gating tests are what prove the deeper authorization still fails closed for out-of-network callers.

**Add a no-leak test, not just a gating matrix.** Gating proves *who gets past the gate*; it does not prove *what a record that passes the gate reveals*. For any endpoint that filters records by visibility, add a positive no-leak test alongside the gating matrix: seed a HIDDEN record with real data (coordinates, a pin, a private field) and assert a non-admin caller who IS admitted still sees nothing derived from it (PR #1553 review: "a HIDDEN proposal that has coordinates must not leak a pin to a non-admin member … this is the coverage that guards the no-leak invariant"). Valid-but-hidden data is the case that catches a filter that only checks existence, not visibility.

## The E2E env shim

`tests/e2e/playwright.config.ts` `Object.assign`s a fixed set of env vars on top of `.env.local`:

```ts
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:56321
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:56322/postgres
TIPTAP_SECRET=e2e
NEXT_PUBLIC_TIPTAP_APP_ID=e2e
E2E=true
NODE_ENV=test
```

That guarantees E2E always points at the isolated Supabase instance on ports 563xx, not at your dev stack. Three Supabase ranges to keep straight:

| Range | What | Started by |
|---|---|---|
| `543xx` | Dev (workspace dev servers) | `pnpm w:db start` |
| `553xx` | Test | (rare; some workspace test scripts) |
| `563xx` | E2E | `pnpm w:e2e supabase:setup` |

If a Playwright spec fails with "ECONNREFUSED 127.0.0.1:56321", you haven't booted the e2e Supabase. Run `pnpm w:e2e supabase:setup` once, then re-run.

## E2E builds prod, not dev

The Playwright suite runs against a **pre-built production build**, not the dev server. That's why `pnpm build:e2e` and `pnpm start:e2e` exist (defined at the repo root with `E2E=true` and the 563xx URLs baked in). Don't try to run e2e against `pnpm w:app dev` — the env shim won't match.

The supplied flow:

```bash
pnpm w:e2e supabase:setup    # boot the isolated Supabase (first time only)
pnpm build:e2e               # build apps/app + apps/api with E2E env
pnpm e2e                     # run the specs
```

`pnpm e2e:ui` opens the Playwright UI runner — useful for debugging a single spec.

## Test helpers mirror production strictness

A test data-manager helper that no-ops on an id it can't find turns a typo into a confusing assertion failure three steps later — the test reads "expected `openReviews: true`, got `false`" and nothing points at the wrong `phaseId`. Have the helper throw the same error production would (`assertInstancePhase` → `NotFoundError`) so the mistake surfaces where it was made. PR #1694: "If `phaseId` doesn't match any entry in the phases array, the `map` returns all phases unchanged and `openReviews` is never written … Consider throwing when the phase isn't found, mirroring how `assertInstancePhase` behaves in production code."

Corollary: a helper is production code with a different caller. Reuse the real assertion rather than reimplementing a looser version of it.

**Don't hand-roll a parser in the assertion path.** A test that reads a CSV (or any structured artifact) with a bespoke reader puts untested code between the artifact and the assertion — if the reader is wrong, the suite passes over a malformed file or fails over a correct one, and either way it blames the code under test. PR #1750 replaced ~48 lines of hand-rolled CSV reading with `csv-parse/sync`; the reviewer's whole comment was "We should include a CSV parser." The "it's only one dependency for one test" instinct is usually wrong when the writer's sibling package is already a dependency — and leaving the parser **strict** (no `relax_column_count`) is the point: a row whose width disagrees with the header now fails the test instead of silently shifting every column.

**Test the intersection, not each half.** When a change makes two behaviours coexist, the case worth pinning is the one where both are live at once. PR #1796 made modals full-screen on mobile and added specs for a short dialog with a footer and an overflowing dialog without one — so the combination that the sticky layout actually has to survive, a tall scrolling dialog with **both** a sticky header and a sticky footer, went untested: "add a tall dialog containing both sticky elements so regressions that obscure, displace, or make the footer unreachable cannot pass this suite."

**`as const` in a fixture is not a type assertion — don't remove it.** Review bots flag `method: 'manual' as const` as a convention violation (PRs #1788, #1797); it isn't, and dropping it widens the literal until it no longer satisfies the union. See `code-conventions` for the distinction and for how to close that thread with evidence.

## Playwright specifics

- **Never navigate the DOM structurally to reach an element.** `.locator('..').locator('..').getByRole('button')` encodes the exact nesting depth of a component you don't control — one wrapper `<div>` added by a library upgrade and the chain either misses or silently matches a different button, failing with no useful message. Add a `data-testid` (or an `aria-label` that's worth having anyway) to the element in the component and select on that. PR #1699: "Adding a `data-testid="open-reviews-toggle"` … would make this selector stable and self-documenting without requiring DOM-path knowledge in the test."
- **A comment describing what a test covers must match its assertions.** A block commented "asserts the name, the recommendation badge, and the score" with only two `expect`s tells the next reader the badge is protected when it isn't — a refactor that drops it passes. Either add the missing assertion or narrow the comment. PR #1699.
- **Never a hardcoded `sleep` / `setTimeout` / `waitForTimeout` to wait for async state** (e.g. a DB write) to become visible before asserting. A fixed delay is inherently flaky — too short on a loaded CI runner, wasted time on a fast machine. Wait for a concrete signal instead: rely on Playwright's built-in auto-retrying assertions (`expect(locator).toBeVisible()` polls for you), or poll for the actual condition. PR #1639 dropped a raw 600 ms delay after review: "The test would be more reliable waiting for a concrete signal … or simply relying on Playwright's built-in auto-retrying assertions." (Don't reach for `networkidle` as the fix — see the next bullet.)
- **Don't wait for `networkidle`** — discouraged in the official Playwright docs ([reference](https://playwright.dev/docs/api/class-page#page-wait-for-load-state-option-state)). Use `load` or wait for a specific element / response (review feedback on #1073).
- Prefer locator-based assertions (`expect(page.getByRole('button', { name: 'Save' })).toBeVisible()`) over CSS selectors.

## Vitest specifics

- Config lives per-workspace (`packages/common/vitest.config.ts`, `services/api/vitest.config.ts`, `services/realtime/vitest.config.ts`). They share the same defaults (Node env, globals on).
- `globals: true` means you can write `describe` / `it` / `expect` without imports, but explicit `import { describe, it, expect } from "vitest"` is fine too — match the surrounding file.
- For tests against a real Postgres, use the `services/api/src/test/helpers` factories (`createGatingCallers`, etc.) — they bring up the isolated instance and tear it down via `onTestFinished`.
- `it.concurrent` is in use for gating cells — fine to adopt where tests are independent.

## Don't

- Don't put `.test.ts` in `tests/e2e/` — Playwright picks up `.spec.ts`; Vitest doesn't look there.
- Don't bypass the env shim by hardcoding `NEXT_PUBLIC_SUPABASE_URL` in a spec. The whole point is determinism across machines.
- Don't add a Playwright spec when a unit / integration test would cover the bug. E2E is the most expensive feedback loop in the suite; reserve it for things that genuinely need it.
- Don't mark a task complete with `pnpm e2e` skipped citing "infrastructure issues" — see `implement-task` Step 7 on STOP signals.
- Don't ship a new tRPC procedure without `describeAccessTierGating` coverage. Gating is the regression-prone surface; the matrix is cheap.
