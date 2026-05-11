---
name: test-conventions
description: Where Vitest lives vs Playwright, naming (.test.ts vs .spec.ts), the E2E env shim (NEXT_PUBLIC_SUPABASE_URL → :56321, separate ports 55xxx/56xxx), pnpm test vs pnpm e2e, and choosing which kind of test to add. Triggers when writing a new test, picking unit vs e2e, debugging a failing test, or deciding where a test file goes. Trigger phrases — "write a test", "add a test", "unit test", "integration test", "e2e", "playwright", "vitest", ".test.ts", ".spec.ts", "tests/e2e", "pnpm test", "pnpm e2e", "pnpm w:e2e", "supabase:setup", "describe", "expect".
---

## Three test surfaces

| Kind | Runner | Location | Suffix | Run with |
|---|---|---|---|---|
| **Unit / service-layer** | Vitest | `services/api/src/**`, `services/realtime/src/**`, `packages/common/src/**`, `services/emails/.react-email/**` | `.test.ts` | `pnpm test` (root, runs Turbo across workspaces) or `pnpm w:api test` for a single workspace |
| **E2E (browser)** | Playwright | `tests/e2e/tests/<feature>.spec.ts` | `.spec.ts` | `pnpm e2e` (root) or `pnpm w:e2e e2e` |
| **A11y baseline** | Playwright | `tests/e2e/tests/a11y-baseline.spec.ts` | `.spec.ts` | `pnpm a11y:baseline` (or `pnpm w:e2e a11y:baseline`) |

Keep the suffixes consistent — `.test.ts` files are picked up by Vitest, `.spec.ts` by Playwright. Don't mix them.

## Where to add a test

Decide by what you're testing, not by where it's easiest to write:

- **Pure logic / data shapes / service-layer functions** → Vitest, colocated with the source. Example: `packages/common/src/services/decision/votingEligibility.test.ts` next to `votingEligibility.ts`.
- **tRPC router behavior** → Vitest in `services/api/src/routers/<area>/<name>.test.ts`. Mock at the DB/external boundary, not at the router.
- **A user-visible flow that crosses the UI ↔ API ↔ DB boundary** → Playwright spec in `tests/e2e/tests/`. Use one of the existing specs as a shape reference (`tests/e2e/tests/onboarding.spec.ts`, `proposal-view.spec.ts`, etc.).
- **Accessibility regression** → add an assertion in `a11y-baseline.spec.ts`, don't fork a new spec.

If a bug fix has a service-layer cause, the test belongs in Vitest even if the symptom was UI. A Playwright spec is the right call only when the failure mode genuinely needs a browser to reproduce.

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

## Vitest specifics

- Config lives per-workspace (`packages/common/vitest.config.ts`, `services/api/vitest.config.ts`, `services/realtime/vitest.config.ts`). They share the same defaults (Node env, globals on).
- `globals: true` means you can write `describe` / `it` / `expect` without imports, but explicit `import { describe, it, expect } from "vitest"` is fine too — match the surrounding file.
- For Drizzle / DB-touching tests, prefer mocking the client at the import boundary rather than spinning up a real Postgres in Vitest. Real-DB tests belong in Playwright if they need real DB at all.

## Don't

- Don't put `.test.ts` in `tests/e2e/` — Playwright picks up `.spec.ts`; Vitest doesn't look there.
- Don't bypass the env shim by hardcoding `NEXT_PUBLIC_SUPABASE_URL` in a spec. The whole point is determinism across machines.
- Don't add a Playwright spec when a unit test would cover the bug. E2E is the most expensive feedback loop in the suite; reserve it for things that genuinely need it.
- Don't mark a task complete with `pnpm e2e` skipped citing "infrastructure issues" — see `implement-task` Step 6 on STOP signals.
