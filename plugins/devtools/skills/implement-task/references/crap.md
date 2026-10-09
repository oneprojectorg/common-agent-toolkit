# CRAP gate (Fallow)

Owner of the metric in common: `configs/fallow/README.md` and `scripts/lib/fallow-crap.mjs`. This page is the agent's working summary.

## Formula

```
CRAP = cognitive² × (1 − coverage)³ + cognitive
```

- **cognitive**, not cyclomatic: it charges for nesting and forgives flat forms (a 20-arm `switch` scores 1).
- **coverage**: statement coverage over the function's line span, read from `coverage/coverage-final.json` (closures included).
- Bands (`fallow-crap.mjs`): `CLEAN` < 15, `AT_RISK` ≥ 30. At 0% coverage, cognitive 5 already scores 30.
- Fallow's own `crap` column in the file-scores section is a different number (cyclomatic + static reachability). `pnpm health` says so inline. Ignore it.

## Running it

```bash
pnpm test:coverage            # needs Docker + `pnpm w:api test:supabase:start`; several minutes
pnpm health --base origin/dev
```

- Exit non-zero ⇔ a file this change touched (committed since merge base, staged, unstaged or untracked) has a function at CRAP ≥ 30, or fallow's complexity findings regress against `configs/fallow/health-baseline.json`. The verdict names each offending function with its cognitive score and coverage.
- A file already over 30 before your change still fails: touching it is when you fix it.
- `CRAP: STALE` (exit 0) means a changed file was edited after the coverage report. That is not a pass. Re-run `pnpm test:coverage`.
- No coverage report → exit 1 with "No merged coverage". Run `pnpm test:coverage`.
- `pnpm health --json` **always exits 0** (it is a report for CI). Never use it as the gate.

## Scope

Scored: `{apps,packages,services}/*/src/**/*.{ts,tsx}`, minus test scaffolding. Held out (`UNMEASURABLE` in `fallow-crap.mjs`; read the constant, don't infer it): `apps/app` (covered by uninstrumented Playwright) and `packages/sense` (Storybook only). For functions there, estimate coverage as exercised branches ÷ total branches (0 if no test reaches it) and apply the same ≥30 rule. Files absent from the coverage report are dropped, not scored.

## Rule

1. No changed function may score ≥ 30.
2. Primary signal is the delta: don't raise the CRAP of a function you touched. Reduce it when cheap.
3. Iterate until `pnpm health --base origin/dev` exits 0 with `CRAP: OK`:
   - **Add a test** that reaches the uncovered branches first. Coverage is cubed: cognitive 12 drops from 156 to 24 going from 0% to 60%.
   - **Split or flatten** when the test is expensive: early returns instead of nested conditionals, extract nested arms, lift loop bodies. Cognitive is squared.
4. Any edit after scoring (including `/simplify` and review fixes) invalidates the numbers. Re-run both commands before opening the PR.
5. A function you can't bring under 30 needs a one-line reason in the commit message and PR body (e.g. "retry arms need a live queue"). "Nothing here is risky" is not a reason.

## After the PR opens

CI (`.github/workflows/tests.yml` → `pr-metrics.yml`) runs `pnpm test:coverage`, then `pnpm health --json` against the PR base with dev's saved per-file scores, and `scripts/pr-metrics.mjs` posts a sticky comment marked `<!-- pr-metrics:comment -->`. It starts as "measuring…" and is filled in when the run ends.

```bash
gh pr view --json comments --jq '.comments[] | select(.body | contains("<!-- pr-metrics:comment -->")) | .body'
```

Its `## CRAP metrics` table lists Function, File, Cognitive, Coverage, CRAP, and, when dev's scores were usable, **Base** and **Change**: each file's worst CRAP at the merge base and how far it moved. "now over 30" marks a file the change pushed across the line. Fix every positive Change on a function you touched, and every crossing. No Change column means no usable base scores, or the PR's tests failed. Fix the tests first.

The PR body does not repeat these numbers. CI owns them.
