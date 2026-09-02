# common-agent-toolkit

Claude Code plugin marketplace for the [One Project `common`](https://github.com/oneprojectorg/common) monorepo.

One install gives engineers the full agent harness for this codebase: 21 in-house skills, a vendored copy of Vercel's `react-best-practices` skill, and the protected-branch hooks.

## Install

Once per machine, add the marketplace and install the plugin:

```text
/plugin marketplace add git@github.com:oneprojectorg/common-agent-toolkit.git
/plugin install devtools@common-agent-toolkit
```

Both commands run inside Claude Code. The marketplace add clones this repo to `~/.claude/plugins/cache/`; the install wires the skills and hooks into Claude Code via the cached copy. Works with private GitHub repos through your existing `gh` / SSH auth.

## Updating

```text
/plugin marketplace update common-agent-toolkit
```

Pulls the latest from this repo and re-syncs installed plugins. No re-install needed.

To refresh the vendored Vercel skill from upstream:

```bash
bash scripts/sync-vercel.sh
```

Then commit the resulting diff.

## Installing via `npx skills`

The plugin is also discoverable by [vercel-labs/skills](https://www.npmjs.com/package/skills) (`npx skills`), which reads the `skills` array declared in `plugins/devtools/.claude-plugin/plugin.json`:

```bash
npx skills add oneprojectorg/common-agent-toolkit --all
```

Or install a subset by name with `-s`. This route only installs `SKILL.md` content — it does not wire up the `PreToolUse` hooks, so engineers who need the protected-branch guards still need the `/plugin marketplace add` path above.

## What's in the toolkit

### Skills

| Skill | What it covers |
|---|---|
| `agent-setup` | How to replicate the OP Bot agent — the Multica platform agent (runtime, model, `instructions`, the 22 bound skills) and the local Claude Code harness that mirrors it (this plugin, `settings.json`, the `block-ai-coauthor` hook, PostHog + claude.ai MCP servers, the `multica` CLI). |
| `access-control` | Authorization via the `access-zones` library and our wrappers (`assertProfileAccess`, `assertOrgAccess`, `assertProfileAdmin`, `<AccessBoundary>`, `AccessTierError`), ordering OR'd grant checks so the broadest short-circuits before a lookup that can throw, gating **both** ends of a relationship read on one shared visibility predicate (joined metadata leaks what the filter hid), hiding a restricted row with `NotFoundError` while denying with `UnauthorizedError`, never re-deriving the server's authorization rule on the client, reusing the canonical serializer so a per-field redaction (`isAnonymous`) isn't re-derived — and missed — at the next read site, and not carrying a legacy implicit org grant into a new write path. |
| `api-endpoints` | Adding / editing tRPC endpoints — the 4-tier procedure model (`networkAuthenticated` / `authenticatedConfirmed` / `authenticated` / `open`), encoder pattern, schemas in `@op/common`, realtime channels, filtering auth-sensitive fields at the encoder so they can't leak from a future query, `.min(1)` on optional id-like inputs so `''` can't collide with a NULL sentinel, and enum-narrowing as a data-compatibility change. |
| `asana-api` | Talking to Asana directly via the REST API. |
| `branch-and-pr` | Branching and pull-request workflow. |
| `code-conventions` | Cross-cutting review patterns — composition over duplication, naming (no acronyms, `get`/`assert` prefixes, descriptive names over destructure-local ones), scope discipline (one task per PR — disclosing a bundled fix is not a substitute for unbundling it), enumerating every arm a guard must cover (both join ends, both graph directions, the set branch *and* the clear branch), not shipping a guard for a failure you haven't observed here, `as const` is not a type assertion and a wrong bot finding is rebutted with the mechanism, no nested ternaries, derive lists from the source of truth, type escape-hatch avoidance, casts at the DB boundary, Common error types, comment restraint (comments decay — and when you remove a mechanism its comments are part of the diff), resolving (or explicitly deferring) the debt a migration carries over, fallback discipline (a `??` onto a stale snapshot can't tell "cleared" from "unresolved"; a uniqueness fallback has to loop; never re-case text a person wrote; a shallow spread replaces nested subtrees), classifying a transient error by its source and dropping the cache a failed attempt read, deleting the branch the guard above made unreachable, and picking a CI workflow's trigger by trust level. |
| `component-file-structure` | Conventions for organizing a React component file — no component declared inside another's render body, Suspense suffix, react-query over raw fetch, a decorative suspense child needs its own error boundary, single-fetch RSC + client `useSuspenseQuery` hydration, an error boundary around a non-suspense `useQuery` catches nothing, `nuqs` for URL-driven state (validate URL params on read; alias a renamed query value; strip a one-shot flag with a `replace` update; `createSerializer` owns the encoding), register into a shared context with a unique key and unregister on cleanup, an effect that writes imperative DOM state owns the branch that clears it, render the zero value instead of hiding the count, don't swallow errors in RSC, mutation errors in `onError`, in-flight guards on mutation controls, loading defaults that match the settled state, never offering an action the server will refuse, mirroring a server-side batch cap in the control that builds it, deriving a header count from the collection the list renders, keying a label map on the enum rather than `Record<string, string>` plus `??`, boolean show/hide props as a composition smell, reusable hooks take a `navigateTo` callback, `startTransition` for non-urgent post-mutation work, no `Record<string, unknown>`, composition over duplication, optional vs undefined. |
| `dev-environment` | Local dev stack — docker layout, port map, `.env.local` vs `.env.docker`, Supabase Studio + Mailpit, Storybook on `pnpm w:sense dev`, driving the running app from Playwright, and the two gotchas that look like app bugs (a clean checkout needs one `pnpm build` before Storybook; a stray lockfile above the monorepo moves Turbopack's workspace root). |
| `drizzle-migrations` | Drizzle ORM workflow for schema edits + the relational-query (`db.query.X`) preference for reads, including giving `findFirst` a filter that identifies exactly one row. A data backfill ships as a standalone ops script, not a migration; a unique index must cover every column its JS guard covers; prefer a concrete per-entity edge table over a polymorphic one no foreign key can constrain; and keep a relationship row whose absence still has to be displayed. |
| `file-uploads` | Signed-URL upload flow for files/images (sign → PUT-direct-to-Supabase → record), the server-side trust boundaries (stored-MIME re-check, size cap, anti-hijack path prefix), shared upload constants in `@op/common` `utils/storage.ts`, and the `@op/common/client` import boundary for client components. |
| `i18n-strings` | Wrapping user-facing strings with translations in `apps/app` — including the accessibility-facing ones (`aria-label`, `placeholder`, `alt`), hook-owned toast copy, and validation diagnostics composed in `@op/common` — plus `getTranslations` for metadata, the i18n `useRouter`, deleting orphaned keys, why a missing key renders raw with no interpolation, why `toast.error(error.message)` puts database ids and Zod payloads in front of a user, and how to tell a real U+FFFD dictionary corruption from an RTL rendering artifact. |
| `implement-task` | End-to-end implementation flow for a claimed Asana task, including the CRAP metrics block every PR description ends with. |
| `pickup-task` | Pick up the next available Agent task from Asana and claim it atomically. |
| `pr-description` | Conventions for PR bodies — short, concise, and to the point (usually one paragraph): describe only what the reviewer can't get from the diff, and spend the words on architectural considerations. No test-plan checklist, no diff walk-through, no implementation narration; mermaid diagrams (ERD, sequence, flowchart) when structure is the point, stacked-PR references when they earn the space, and a required CRAP metrics table (complexity vs. coverage per changed function) as the last block before the Asana link. |
| `realtime-channels` | Naming + design of `Channels.X` builders — `scope[:id]` convention, JSDoc subscriber/broadcaster pairing, when to add a channel vs reuse one, registering every input that changes a query's output (not just its main table), the `channelScope.ts` helper pattern for fanning invalidations across multi-tenant resources, registering channels synchronously in the request path (never from a deferred callback), not stacking a manual `invalidate` on top of a channel the query already registers, and the fact that a broadcast published before the client's subscription lands is lost forever (Supabase does not replay). |
| `release` | Open the dev → main release PR (invokable as `/release`). |
| `sense-conventions` | Building UI with `@op/sense` (shadcn/ui in its Base UI style, themed by `@op/styles`) — per-component imports, `cn` from `@op/sense/lib/utils`, semantic colour classes and the sense type scale, logical properties for RTL, no arbitrary values (or stock off-scale size utilities) anywhere including stories, a design decision behind any net-new primitive, the Tailwind v4 silent-drop traps (`duration-450` emits no CSS), the four accessibility obligations plus the rules reviewers keep catching, using the same primitive on both halves of a feature, and the Base UI behaviours that bite. `@op/ui` / `packages/ui` are deleted. |
| `service-layer-structure` | How to organize `packages/common/src/services/<feature>/` — one file per operation, named-params signatures, auth-assert first, transactions with sorted-id locks (the only way to hold an invariant about a *relationship* between rows, which no unique index can express), re-asserting every gate inside the writing statement's `WHERE`, a read and its write sibling asserting the same preconditions, reconciling a dedup record whose external call failed, validating at a cache boundary with the schema the type derives from, escaping spreadsheet formula prefixes in generated CSVs, resolving "the newest one" only among rows whose configuration parent still exists, cursor pagination with an id tie-breaker and a null-safe `cursorValue != null` gate, bulk reads that consume every page and surface truncation through the flag the UI renders, named re-exports over `export *`, and the `<feature>Auth.ts` / `channelScope.ts` / `schemas.ts` / `constants.ts` / `utils.ts` auxiliary-file conventions. |
| `test-conventions` | Vitest vs Playwright layout, `.test.ts` vs `.spec.ts`, the E2E env shim, `describeAccessTierGating`, seeding through the service layer instead of hand-writing rows (and which derived writes a raw insert skips), stable selectors over structural DOM traversal, test helpers that throw like production, keeping casts out of fixtures and helpers (extend the shared factory instead of narrowing at the call site), covering a shared derivation at every surface that consumes it, real parsers instead of hand-rolled readers in the assertion path, and choosing which kind of test to add. |
| `technical-writing` | Writing prose in ASD-STE100 Simplified Technical English — sentence and paragraph limits, active voice with a named actor, simple tenses, one word per meaning, and the banned filler phrases ("It is important to note", "Crucially", "not just X, it is also Y"). Plus the section-level rule: a structured document does not explain its own template — a field holds its value, not a discussion of it. Applies to READMEs, doc pages, ADRs, runbooks, release notes, skill bodies, help text, and error messages. |
| `vercel-react-best-practices` | Vendored from [`vercel-labs/agent-skills`](https://github.com/vercel-labs/agent-skills) — React/Next.js performance rules. MIT-licensed; refreshed via `scripts/sync-vercel.sh`. |
| `workspace-shortcuts` | `pnpm w:*` shortcuts for running commands inside a specific workspace (`w:ui` is gone with `packages/ui`; Storybook is `pnpm w:sense dev`). |

### Hooks (`PreToolUse` on `Bash`)

- `block-protected-branches.sh` — refuses `git`/`gh` commands targeting `main` or `dev` (with the `CLAUDE_RELEASE=1` marker as the single dev → main PR exception).
- `require-feature-branch.sh` — refuses commits while HEAD is on a protected branch.

## Layout

```
common-agent-toolkit/
├── .claude-plugin/
│   └── marketplace.json
├── plugins/
│   └── devtools/
│       ├── .claude-plugin/plugin.json
│       ├── skills/<name>/SKILL.md
│       └── hooks/
│           ├── hooks.json
│           ├── block-protected-branches.sh
│           └── require-feature-branch.sh
├── evals/
│   ├── harness/claudeCode.ts
│   ├── judges.ts
│   ├── skills.ts
│   └── skills.eval.ts
├── tests/
│   └── skills.test.ts
├── skill-audit/
│   ├── eval-sets/<name>.json
│   └── sync-to-cache.sh
├── scripts/
│   └── sync-vercel.sh
├── vitest.config.ts
├── vitest.evals.config.ts
├── README.md
└── LICENSE
```

## Authoring a new skill

1. Create `plugins/devtools/skills/<name>/SKILL.md`.
2. Frontmatter must include `name` and `description`. Keep the description specific — the agent uses it to decide when to load the skill.

   ```markdown
   ---
   name: my-skill
   description: One or two sentences. Start with what the skill covers, then "Use when ...".
   ---

   # body
   ```

3. Optional supporting files (`scripts/`, `references/`, etc.) live next to `SKILL.md` in the same folder.
4. Add a row in the README table above.
5. Add `skill-audit/eval-sets/<name>.json` and run `pnpm evals`. The structural
   suite fails on a skill that has no eval set.

## Tests and evals

Two suites, split by cost. Install the dev dependencies once with `pnpm install`.

| Command | What it checks | Cost |
|---|---|---|
| `pnpm test` | Structure of the plugin. No model calls. | Free, ~0.1s |
| `pnpm evals` | Behaviour of each skill in a real Claude Code session. | One agent turn per case |

### `pnpm test` — structural suite

`tests/skills.test.ts` asserts the invariants that silently degrade skill routing:

- Every `SKILL.md` parses, and its `name` matches its directory.
- `plugin.json` lists every skill directory, and only those.
- `plugin.json` and `package.json` declare the same version.
- Every skill has a row in the README table.
- Both branch-guard hooks exist and appear in `hooks.json`.
- Every eval set parses, names a real skill, and covers both directions.
- Every skill has an eval set.
- Each skill's `description` plus `when_to_use` stays under 1,536 characters.
  Claude Code truncates the listing entry past that point, which drops the
  routing keywords in the tail.

Two of these carry a ratchet list of the skills that already fail them: the
1,536-character cap, and eval-set coverage. A new skill cannot join a ratchet
list. Fix an entry and delete its line.

### `pnpm evals` — behavioural suite

`evals/skills.eval.ts` builds one [vitest-evals](https://github.com/getsentry/vitest-evals)
suite per file in `skill-audit/eval-sets/`. Each case runs one prompt through
`claude -p` and scores the result with two deterministic judges:

- **`CanonicalAnswerJudge`** — **gates the build.** Did the canonical pattern
  survive to the answer? `expected_terms` match anywhere in the transcript,
  because reading the right convention out of a file is the skill working.
  `forbidden_terms` match the final answer only, so the agent keeps credit for a
  term it saw and rejected.
- **`SkillRoutingJudge`** — **recorded, not gated** (`threshold: null`). Did the
  skill's body reach the model? A `Skill` tool call counts, and so does a `Read`
  of the `SKILL.md`. On a `should_satisfy: false` case the judge inverts, because
  a description that over-matches burns context on every unrelated prompt.

Routing records rather than gates because `common/CLAUDE.md` restates several
skills — its design-token and `@op/sense` import rules are `sense-conventions`
almost verbatim. That text sits in context on every turn, so the agent answers
correctly without ever loading the skill, and routing scores 0 on a run that did
nothing wrong. A right answer through ambient context is not a regression.

Read the routing scores anyway. A skill with a high answer score and a floor-level
routing score is a skill whose content already lives in `CLAUDE.md`. That
duplication costs context on every turn and gives you two copies to drift apart —
deleting it from `CLAUDE.md` and letting the skill own it is the usual fix.

The harness passes `--plugin-dir plugins/devtools`, so an eval scores the skills
in your working tree. You do not need to install or re-sync the plugin.

`retry: 1` gives each case two attempts. That is the vitest equivalent of the
Python auditors' two-runs-per-query rule, and it keeps one unlucky sample from
failing a healthy skill.

| Variable | Default | Effect |
|---|---|---|
| `EVAL_MODEL` | `claude-sonnet-5` | Model under test. Haiku answers skill-shaped prompts from general knowledge instead of loading the skill, so it reports routing failures the real harness does not have. |
| `EVAL_CWD` | this repo | **Set this.** Directory the agent runs in; point it at a `common` checkout. The prompts name paths like `packages/common` and workspaces like `api`, so anywhere else the agent reports that it cannot find them and asks for a path instead of loading the skill. That scores as a routing failure the real harness does not have. |
| `EVAL_CONCURRENCY` | `4` | Prompts in flight at once. |
| `EVAL_TIMEOUT_MS` | `240000` | Wall-clock cap per prompt. |

```bash
EVAL_CWD=~/oneproject/common pnpm evals
```

Run one skill with `-t "skill: branch-and-pr"`, or one case with `-t "<part of
the query>"`. Inspect a finished run in the browser with
`pnpm evals:ui .vitest-evals/report.json`.

The harness denies `Bash`, `Edit`, `Write`, `NotebookEdit`, `WebFetch`,
`WebSearch`, and `Task` through `--disallowed-tools`, so an eval cannot mutate
the checkout or reach the network. `--allowed-tools` does not do this on its own
— it pre-approves the tools it names and leaves every other tool available.

### Sampling for a rate

By default each case runs once. Set `EVAL_SAMPLES` above 1 to grade the case on
its hit rate instead of a single verdict, which is what you want when you are
judging whether a description is reliable rather than whether it works at all:

```bash
EVAL_CWD=~/oneproject/common EVAL_SAMPLES=5 pnpm evals -t "skill: sense-conventions"
```

The failure message lists every sample's score and rationale, so `3/5` and `5/5`
are distinguishable. `EVAL_PASS_RATE` sets the bar (default `0.5`).

At one sample the suite retries once, so an unlucky draw does not fail a healthy
skill. Above one sample the hit rate already absorbs that, so the retry is off and
a run costs exactly `EVAL_SAMPLES` turns per case.

## License

MIT. The vendored `vercel-react-best-practices` skill retains its upstream MIT license; see its `SKILL.md` frontmatter for attribution.
