---
name: test-conventions
description: "Vitest (.test.ts / .unit.test.ts) and Playwright (.spec.ts) in common: @op/common/testing data managers, describeAccessTierGating, the E2E env shim, fixtures, flaky waits. Use when writing or fixing a test, seeding fixtures, or debugging pnpm test / pnpm e2e."
---

CLAUDE.md owns the basics: the `.unit.test.ts` vs `.test.ts` split, `pnpm test`, `pnpm w:common test:unit|test:integration`, `pnpm test:supabase:start`.

## Where a test goes

| What you test | Runner | Location |
|---|---|---|
| Pure logic, service functions | Vitest | next to the source (`votingEligibility.unit.test.ts`) |
| DB helpers, low-level DB utils | Vitest integration | next to the helper; call it directly against the DB to cover permutations cheaply |
| tRPC router behaviour | Vitest integration | `services/api/src/routers/<area>/<name>.test.ts` |
| A flow across UI ↔ API ↔ DB | Playwright | `tests/e2e/tests/<feature>.spec.ts` |
| Accessibility regression | Playwright | add to `a11y-baseline.spec.ts`; run `pnpm a11y:baseline` |

- A bug with a service-layer cause gets a Vitest test, even if the symptom is in the UI. Use Playwright only when the failure needs a browser.
- `.spec.ts` is Playwright, `.test.ts` is Vitest. Never put `.test.ts` in `tests/e2e/`.
- One test file per source unit. A second file for the same unit is named `<unit>.<aspect>.test.ts`.
- A config change that moves files between Vitest projects can empty one project. Check what each project still runs, and add a smoke test to an emptied one.
- A new a11y violation fails the `a11y-known-violations` check. Fix it. Add an entry to `tests/e2e/a11y-baseline/known-violations.json` only as deliberate, accepted debt. Never delete entries to silence the check.

## Naming

- `describe` and `it` read as a sentence that says what passes: `it('shows the creator their draft when viewing the phase it was created in')`, not `it('no-JWT caller on non-public instance')`.
- If you cannot say the test in one sentence, it tests two things. Split it.
- Merge `it` blocks that share expensive setup into one `it` with several assertions.

## Seeding: the `@op/common/testing` harness

Factories and data managers live in `packages/common/testing` (`helpers/Test*DataManager.ts`, `data/`).

| Entry | Holds | Imported by |
|---|---|---|
| `@op/common/testing` | Supabase helpers, `Test*DataManager` classes, `data/` fixtures | Vitest tests (loads `setup.ts`, needs a Vitest runtime) |
| `@op/common/testing/data` | `data/` fixtures only | Playwright specs |
| `@op/common/testing/vitest` | config-time options | `vitest.config.ts` files |
| `@op/common/testing/mocks/deepl` | `mockTranslateText` spy | tests that assert on translation calls |

- **Seed through the service layer.** `TestDecisionsDataManager` calls `createProposal`, `createDecisionInstance`, `advancePhase`, `joinOrganization` from `@op/common`. New Vitest fixtures go through a data manager, not a fresh `db.insert`.
- **In e2e, seed through `@op/common/testing/data`.** If the factory lacks a field, extend the factory. Push back on any per-spec `db.insert` in review.
- **The `data/` factories insert rows directly**, so they skip derived writes the services make: unique slugs, phase-default `HIDDEN` visibility, `proposalCategories` link rows, location sync, `parseProposalData` validation, per-instance access roles, `decisionProcessTransitions`, `rootProfileId`/`rootPostId` on posts, moderation and notification rows. An assertion that depends on one of these needs the service path or a factory extension.
- If a spec must inline a production constant or algorithm, comment what it mirrors (`"Mirrors what createDecisionRole in @op/common writes"`).
- Thread a new optional param through the shared factory rather than building a parallel fixture.

## Fixtures and helpers

- **No casts in fixtures or helpers** (`as X`, `as unknown as X`, `as never`). A cast hides the contract drift the test exists to catch. Use the file's existing type guard, or add an optional param to the factory. `as const` is not a type assertion; keep it (see `code-conventions`).
- **Make two sources disagree.** When the test proves which source a value came from, seed the losing source with an obviously wrong value (`stale-<n>@example.test`).
- **A fixture shortcut keeps production's validation.** Run the encoder or validator, or validate the input before insert.
- **Helpers throw like production.** A helper that no-ops on an unknown id hides the typo. Reuse the real assertion (`assertInstancePhase` → `NotFoundError`).
- **Use `randomUUID()` from `node:crypto`**, not `Math.random()`. CodeQL scans test helpers.
- **Validate a test-only env override** (parse to the expected type) before it reaches a shell command.

## What a test must prove

- **A regression test fails before the fix, for the bug's reason.** If it passes on the unpatched code, it does not cover the bug.
- **Assert the module's behaviour, not a Zod schema you passed in.** Ask what code under test would have to break for the case to fail. If none, delete it.
- **Cover each side of a value-selected branch** (count 1 and 2, below and above a threshold), with values that differ.
- **Pin a dependency's undocumented shape** that a guard reads (e.g. a `CHANNEL_ERROR` that arrives with no `err`).
- **Cover a shared derivation at each consumer**, or test it at the shared resolver and assert each surface calls it.
- **Test the intersection** when a change makes two behaviours coexist, not each half alone.
- **When you rework query order or hydration**, seed distinct sort keys and a nested relation, and assert both survive.
- **When you change an endpoint's output**, assert the new field survives the `.output()` parse (see `api-endpoints`).
- **Cover a boundary the mocks erase** with one integration case: a value two systems format differently (GoTrue stores a phone without `+`, Twilio sends `+`), or provider semantics a test double skips (`@inngest/test` does not run `debounce` or `singleton`).
- **Test a new request entry point through its real parse path**: raw body in, status code out (valid, missing signature, tampered body, missing secret).
- **Use a real parser** (`csv-parse/sync`, strict) to read a structured artifact in an assertion. Do not hand-roll one.
- A comment that says what a test covers must match its assertions.

## Access-tier gating (`describeAccessTierGating`)

Every new tRPC procedure, and every tier change, gets the gating matrix from `services/api/src/test/helpers/gating`:

```ts
import { accessTierGatingCell, describeAccessTierGating } from '../../test/helpers/gating';

describeAccessTierGating('myEndpoint', {
  noJwt: accessTierGatingCell('no JWT is rejected at the network tier', async (ctx) => { /* expectFailsAccessTierGate(…) */ }),
  anonJwt: accessTierGatingCell('anonymous JWT is rejected', async (ctx) => { /* … */ }),
  userJwt: accessTierGatingCell('out-of-network user is rejected', async (ctx) => { /* … */ }),
  networkJwt: accessTierGatingCell('network user passes the gate', async (ctx) => { /* expectPassesAccessTierGate(…) */ }),
});
```

- All four cells are required (compile error otherwise).
- `expectFailsAccessTierGate` asserts the gate rejected the caller. `expectPassesAccessTierGate` asserts the caller passed the gate; the call can still fail later.
- `describeDecisionAccessTierGating` (`gating/decision.ts`) is the decision-specific variant. `createGatingCallers` builds the callers.
- **Add a no-leak test** for an endpoint that filters by visibility: seed a `HIDDEN` record with real data and assert an admitted non-admin sees nothing derived from it.

## Playwright

- **Env shim.** `tests/e2e/playwright.config.ts` overrides `.env.local` with the E2E Supabase on 563xx (`NEXT_PUBLIC_SUPABASE_URL`, `DATABASE_URL`, `S3_ASSET_ROOT`, `E2E=true`, `NODE_ENV=test`, dummy TipTap values). Never hardcode these in a spec.
- **Supabase ranges:** 543xx dev (`pnpm w:db start`), 553xx Vitest integration (`pnpm test:supabase:start`), 563xx e2e (`pnpm w:e2e supabase:setup`). `ECONNREFUSED 127.0.0.1:56321` means the e2e Supabase is not running.
- **E2E runs a production build** (`pnpm build:e2e`, then `pnpm e2e`; `pnpm e2e:ui` for one spec). Agents cannot run `build:e2e` (the `pnpm build*` deny); ask the user or rely on CI. Never mark a task done with e2e skipped for "infrastructure issues".
- **Wait for a signal, never a delay.** No `waitForTimeout`, `sleep` or `setTimeout`. Use auto-retrying assertions (`await expect(locator).toBeVisible()`). Do not wait for `networkidle`.
- **Select by role or `data-testid`**, never by DOM structure (`.locator('..')`). Add a `data-testid` or a useful `aria-label` to the component.
- **Shared browser state needs two pages.** A per-origin invariant (`localStorage`, persisted cache) needs a second page in the same context to prove another tab cannot write it back.

## Vitest

- Config is per workspace (`packages/common`, `services/api`, `services/realtime`, `apps/app`, …). `globals: true`; match the file's import style.
- `it.concurrent` is fine for independent cases.

Past review incidents: [references/lessons.md](references/lessons.md).

## Review checklist

- [ ] Right runner and location; suffix matches the Vitest project the test needs
- [ ] `describe`/`it` names read as sentences
- [ ] Fixtures come from `@op/common/testing` data managers or factories; no per-spec `db.insert`
- [ ] No `as` casts in fixtures or helpers; helpers throw like production
- [ ] Precedence tests seed the losing source with a wrong value
- [ ] Regression test fails on the unpatched code
- [ ] Both sides of each new value-selected branch are covered
- [ ] New or re-tiered tRPC procedure has `describeAccessTierGating`; visibility filters have a no-leak test
- [ ] No case only exercises a Zod schema
- [ ] Playwright: no fixed waits or `networkidle`; role/testid selectors; no hardcoded env
- [ ] `randomUUID()`, not `Math.random()`, in helpers
