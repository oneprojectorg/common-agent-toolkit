---
name: e2e-flake-reproduction
description: Reproduce a CI-only flaky Playwright e2e test locally — repeat loops, cpulimit CPU caps on the e2e next-servers, docker pause fault flappers on the e2e Postgres, and deterministic route injection. Covers why a quiet dev machine never reproduces a CI flake (a blacksmith-4vcpu shard runs both Next servers, Supabase, Inngest, Chrome and 2 Playwright workers on 4 cores; an 18-core laptop never starves the server), why starvation alone stays green (slow is not failed — the flake class needs a transient fault, not load), and the e2e-stack repairs a stale environment forces (rebuild, migrate, reset, a wedged GoTrue). Use when a test fails only in CI, when asked to reproduce or stress-test a flake, when verifying a de-flake fix actually fixes, or when a loop of green runs must be read as evidence.
---

## Why the flake only appears in CI

CI runs the e2e suite on `blacksmith-4vcpu-ubuntu-2204` (`.github/workflows/e2e-tests.yml`). One shard has 4 vCPUs. The same 4 cores run both Next production servers (:4100 app, :4300 api), the Supabase stack, the Inngest dev server, Chrome, and 2 Playwright workers. The tests starve the servers of CPU.

A dev machine has spare cores. The servers respond in time, SSR does not time out, and transient 500s do not fire. A green loop on a quiet dev machine does not prove a fix.

## Escalation ladder

Climb in order. Stop at the rung that reproduces. Record pass/fail counts per rung.

### 1. Baseline loop

```bash
cd tests/e2e
pnpm exec playwright test tests/<spec>.spec.ts --project=e2e \
  --repeat-each=25 --retries=0 --trace=retain-on-failure --reporter=list
```

`--retries=0` counts raw failures. `--trace=retain-on-failure` keeps a trace for each hit. Match CI with `--workers=2`; add load with more.

### 2. CPU caps

Cap the servers below their CI fair share. `cpulimit` comes from this repo's Brewfile (`brew bundle install`). Find the PIDs by port, never by name:

```bash
lsof -nP -tiTCP:4100 -sTCP:LISTEN   # app next-server
lsof -nP -tiTCP:4300 -sTCP:LISTEN   # api next-server
cpulimit -p <app-pid> -l 30 &       # 0.3 core
cpulimit -p <api-pid> -l 30 &
docker update --cpus 0.5 supabase_db_common-e2e
```

Expect the loop to slow down, not to fail. Starvation alone gave 100/100 green at 0.3 core per server. Slow SSR stays inside the assertions' timeouts; a cap produces no errors. If the loop is still green here, the flake is not load-as-slowness — move to rung 3.

### 3. Transient-fault flapper

The CI flake class is a transient server failure that latches a client error surface (an SSR 500, a failed query whose error UI never retries). Produce the fault directly — pause the e2e Postgres so in-flight queries fail and the api returns 500s:

```bash
for i in $(seq 1 12); do
  sleep 14
  docker pause supabase_db_common-e2e
  sleep 6
  docker unpause supabase_db_common-e2e
done
docker unpause supabase_db_common-e2e 2>/dev/null
```

Run it beside the rung-1 loop (keep the rung-2 caps on). Size the cycle count to the loop's expected runtime. This rig reproduced `mixed-version-reviews.spec.ts:417` at 1/50 where rungs 1–2 gave 150/150 green.

A pause makes queries **hang**; a restart makes them **error**. If the CI failure is a latched 500 or a failed query, escalate the flapper to restarts — this is what reproduced the latched SSR 500 (`heading "500"` in the page snapshot) at 11/60 where pauses only produced `networkidle` hangs:

```bash
for i in $(seq 1 10); do sleep 22; docker restart -t 0 supabase_db_common-e2e; done
```

### 4. Deterministic route injection

A stochastic hit proves the class; a regression test needs determinism. Intercept the first document request and fail it, then let retries through:

```ts
let failed = false;
await context.route('**/reviews', (route) => {
  if (!failed) {
    failed = true;
    return route.fulfill({ status: 500, body: 'transient' });
  }
  return route.continue();
});
```

This converts "the first navigation latches an error surface" into a test that fails every time without the fix and passes every time with it.

## One-command rig

Wrap rungs 2–3 in one script so a reproduction run is repeatable by anyone. Shape (a working copy lived at `tests/e2e/reproduce-flake.sh` in the common monorepo):

```bash
#!/usr/bin/env bash
# args: spec path (default mixed-version-reviews), repeats per test (default 30)

# 1. preflight: exit with the fix command if a piece is missing
#    curl :4100 and :4300 | cpulimit on PATH | supabase_db_common-e2e running

# 2. caps (rung 2)
APP_PID="$(lsof -nP -tiTCP:4100 -sTCP:LISTEN | head -1)"
API_PID="$(lsof -nP -tiTCP:4300 -sTCP:LISTEN | head -1)"
cpulimit -p "$APP_PID" -l 30 & cpulimit -p "$API_PID" -l 30 &
docker update --cpus 0.5 supabase_db_common-e2e

# 3. restart flapper (rung 3), backgrounded, guarded by a stop file
( while [ -f "$STOP" ]; do sleep 22; docker restart -t 0 supabase_db_common-e2e; done ) &

# 4. teardown on EXIT/INT/TERM — always, even on Ctrl-C:
#    rm stop file; kill flapper + cpulimits; kill -CONT both server PIDs;
#    docker update --cpus 0; docker unpause; docker start

# 5. the loop
pnpm exec playwright test "$SPEC" --project=e2e \
  --repeat-each="$REPEATS" --workers=4 --retries=0 \
  --trace=retain-on-failure --reporter=list

# 6. on failure: list the newest test-results/ dirs and say that a page
#    snapshot containing `heading "500"` is the latched CI failure
```

The teardown trap is the part not to skip: a killed `cpulimit` leaves its target SIGSTOPped, and a flapper that outlives the loop keeps restarting the database under the next person's run. Run the script on the pre-fix checkout to reproduce, then on the fix branch to verify the fix holds under the same abuse. Expected yield at these defaults: roughly 1 failed run in 6, a mix of latched-500 failures and seeding-time connection errors.

## Read the failure shape, not the color

A reproduced failure must match the CI failure's mechanism before it counts. Compare the local `error-context.md` page snapshot against the CI trace. Two failures on the same line can be different bugs:

- **Latched error surface**: `goto` returns, the error UI renders, the ready element never appears. A re-navigation helper fixes this.
- **`networkidle` hang**: the page renders fully, but a stalled request keeps `goto` from returning at all. A re-navigation helper never gets control; only a longer test timeout or `waitUntil: 'domcontentloaded'` plus a ready-locator fixes this.
- **Rig artifact**: the test dies in seeding or sign-in (`CONNECTION_CLOSED`, `ECONNREFUSED`, a GoTrue 500) because the flapper cut its database connection. A real first-attempt failure, but not the CI mechanism — do not count it as a reproduction.

## Environment repairs a stale e2e stack forces

Each of these presented as a test failure first. Check them before blaming the test:

| Symptom | Cause | Fix |
|---|---|---|
| Every run fails in seeding: `column ... does not exist` | e2e DB predates the branch's migrations | `pnpm w:e2e supabase:migrate` |
| Migrate fails: `column ... already exists` | Migration journal out of sync | `pnpm w:e2e supabase:reset`, migrate, seed |
| `Failed to create test user: {}` / `invalid response was received from the upstream server` | GoTrue wedged after a db reset | `pnpm w:e2e supabase:stop` then `supabase:start` |
| Tests exercise stale app code | `.next` build predates the checkout | `pnpm build:e2e`, restart `pnpm start:e2e` |

A branch switch that changes app code (check `git diff --name-only <old> <new> -- apps packages services`) requires the rebuild row. New files under `services/db/migrations` require the migrate row.

## Scope and teardown

Touch only the e2e stack: ports 4100/4300, Supabase 56321/56322, container `supabase_db_common-e2e`. Never the shared dev server on :3100 or the dev/test Supabase instances.

Tear down when done:

```bash
pkill -f "cpulimit -p"
docker unpause supabase_db_common-e2e 2>/dev/null
docker update --cpus 0 supabase_db_common-e2e   # 0 removes the limit
```

A `cpulimit` killed mid-cycle can leave its target SIGSTOPped — follow with `kill -CONT <pid>` on the server PIDs.
