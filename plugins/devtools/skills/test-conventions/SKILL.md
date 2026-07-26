---
name: test-conventions
description: Test conventions — Vitest for unit / service-layer / integration tests (.test.ts, run with pnpm test) vs Playwright for end-to-end (.spec.ts, run with pnpm e2e), the E2E env shim, and the describeAccessTierGating helpers for access-tier gating coverage on tRPC endpoints. Use when writing a new test, deciding between unit vs integration vs e2e, picking the right file suffix or location, naming a describe / it block, adding gating coverage to a new procedure, waiting on async state in Playwright without a flaky hardcoded sleep (use auto-retrying assertions), debugging a failing test, or fixing missing env vars in Playwright runs.
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

## Playwright specifics

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
