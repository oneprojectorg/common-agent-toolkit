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
| `pnpm evals` | Behaviour of each skill in a real agent session — Claude Code, pi, or a local model. | One agent turn per case |

### `pnpm test` — structural suite

`tests/judges.test.ts` covers the scorers themselves, and `tests/skills.test.ts`
asserts the invariants that silently degrade skill routing:

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
suite per file in `skill-audit/eval-sets/`. Each case runs one prompt through an
agent and scores the result with two deterministic judges:

- **`CanonicalAnswerJudge`** — did the canonical pattern survive to the answer?
  `expected_terms` match what the agent said: its assistant messages and its
  final answer. `forbidden_terms` match the final answer only, so the agent keeps
  credit for a term it saw and rejected. Either list is satisfied by any one of
  its terms, so a list holds alternative spellings of one convention rather than
  a checklist.
- **`SkillRoutingJudge`** — did the skill's body reach the model? A skill-tool
  call counts, and so does a read of the `SKILL.md`. On a `should_satisfy: false`
  case the judge inverts, because a description that over-matches burns context
  on every unrelated prompt.

Three things are kept out of the answer judge's haystack, because each one used
to hand a case a point the agent never earned:

| Left out | Why |
|---|---|
| The seeded prompt | "should i rebase or merge?" contains `rebase`, so the case scored its own `expected_terms` before the agent answered. |
| Tool-call arguments | An agent that greps for a phrase from the prompt writes that phrase into the argument record. |
| Tool results | A skill tool's result **is** the skill body, so every canonical term matched the moment the skill loaded, and the answer judge became a second copy of the routing judge. |

Set `EVAL_TERM_SCOPE=transcript` to put tool results back in. That is worth a
run when you want to know whether the content was in front of the model at all,
rather than whether the agent used it. Compare the two numbers to find cases
that were only ever passing on a skill-body echo.

Both judges are asserted with `threshold: null`, so neither one fails a case by
itself — each sample's score goes into the report instead. **The build gates on
the hit rate across samples**, asserted at the end of the test:

| Case | Answer score | Routing score |
|---|---|---|
| `should_satisfy: true` | gates | recorded only |
| `should_satisfy: false` | gates | **gates** |

Positive-case routing records rather than gates because `common/CLAUDE.md`
restates several skills — its design-token and `@op/sense` import rules are
`sense-conventions` almost verbatim. That text sits in context on every turn, so
the agent answers correctly without ever loading the skill, and routing scores 0
on a run that did nothing wrong. A right answer through ambient context is not a
regression.

Read those scores anyway. A skill with a high answer score and a floor-level
routing score is a skill whose content already lives in `CLAUDE.md`. That
duplication costs context on every turn and gives you two copies to drift apart —
deleting it from `CLAUDE.md` and letting the skill own it is the usual fix.

Negative-case routing does gate, because there is no benign reason for an
unrelated prompt to load the skill. It is graded on strong evidence only: a
skill-tool call or a direct read of the `SKILL.md`. A mention of the path in a
`Grep` argument earns a positive case its point but never fails a negative one,
so broad exploration cannot make the gate flaky.

At one sample, `retry: 1` gives each case two attempts. That is the vitest
equivalent of the Python auditors' two-runs-per-query rule, and it keeps one
unlucky sample from failing a healthy skill. Above one sample the hit rate
already absorbs an unlucky draw, so the retry turns off.

### Agents

`EVAL_AGENT` picks the runtime. Both agents load the skills from your working
tree, so an eval scores what you just edited with no install or re-sync step,
and both run the same 114 cases with no change to the eval sets.

| Agent | How skills load | Tool policy |
|---|---|---|
| `claude-code` (default) | `--plugin-dir plugins/devtools` | `--allowed-tools` for `Skill`, `Read`, `Glob`, `Grep`, `TodoWrite`; `--disallowed-tools` for `Bash`, `Edit`, `Write`, `NotebookEdit`, `WebFetch`, `WebSearch`, `Task`, `Agent`. A denylist, so check it when the CLI ships a new tool — `--allowed-tools` alone pre-approves the tools it names and leaves every other tool available. |
| `pi` | `--no-skills --skill plugins/devtools/skills` | `--tools read,grep,find,ls`. A real allowlist covering built-in, extension, and custom tools, so `bash`, `edit`, and `write` stay out of reach. |

The two agents differ in one way the judges have to know about: pi has no skill
tool. It puts every skill's name and description in the system prompt and the
model loads one by `read`ing its `SKILL.md`. Each harness therefore declares a
`ToolProfile` naming its skill tool and its read tools, and the routing judge
scores against that rather than against hard-coded names. Adding a third runtime
means adding a harness and a profile — the eval sets and the judges do not change.

The pi run is deliberately hermetic. `--no-skills` with an explicit `--skill`
path means nothing from `~/.pi/agent/skills` or `~/.agents/skills` can answer a
prompt on a devtools skill's behalf, and `--no-extensions`,
`--no-prompt-templates`, and `--no-approve` make the same promise for the other
resource kinds. `AGENTS.md` and `CLAUDE.md` discovery stays on, because Claude
Code always loads `CLAUDE.md` and the two agents' scores are only comparable if
both see the target repo's ambient context.

```bash
# Claude Code, the default
EVAL_CWD=~/oneproject/common pnpm evals

# pi against a cloud provider
pi auth check --provider openai-codex
EVAL_AGENT=pi EVAL_PROVIDER=openai-codex EVAL_MODEL=gpt-5.4-mini \
  EVAL_CWD=~/oneproject/common pnpm evals
```

Naming a provider makes the suite run `pi auth check` before any case does.
A provider whose credentials are not configured skips the suite with pi's own
reason, instead of spending 114 turns to report 114 zero scores that say nothing
about the skills.

### A local model via `llama-server`

pi resolves a provider's base URL from its own `models.json`, so a local model
needs no endpoint configuration here — name the provider and the model it
serves. Start `llama-server` in router mode, confirm pi sees the model, then run:

```bash
llama-server --models-dir ~/models --host 127.0.0.1 --port 8080
pi --list-models | grep llama-cpp

EVAL_AGENT=pi EVAL_PROVIDER=llama-cpp \
  EVAL_MODEL='unsloth/Qwen3.6-35B-A3B-GGUF:Q8_0' \
  EVAL_CWD=~/oneproject/common pnpm evals
```

Naming a local provider changes two defaults. The suite probes
`<base URL>/models` before any case runs and skips the whole suite with the URL
in the message when nothing answers, rather than burning the full timeout on
each of 114 cases. And `EVAL_CONCURRENCY` drops to 1, because a local server
answers one prompt at a time and concurrent prompts would only queue past the
timeout. `EVAL_BASE_URL` overrides the probed URL for a provider the defaults do
not know.

Measured on an M5 Max (64 GB) with `Qwen3.6-35B-A3B-Q8_0`, 34 GB of weights:

| | |
|---|---|
| Prefill | 2,151 tok/s |
| Decode | 84 tok/s |
| One skill, 8 cases, concurrency 1 | 2 min 43 s — 20 s per case |
| Full 114-case set, extrapolated | **about 38 minutes** |
| Dollar cost | electricity only, a cent or two per run |
| Resident memory | 40 GB while the server is up |

Two settings matter, and both were measured rather than assumed:

- **Leave `EVAL_CONCURRENCY` at 1.** The same 8 cases at concurrency 4 took
  4 min 58 s — 1.8x *slower*. One request already saturates the GPU, so parallel
  prompts divide the same throughput, and the two heaviest cases hit the 240 s
  timeout instead of finishing in 58 s.
- **Give each slot at least 64k of context.** At `--ctx-size 32768` the heaviest
  case overflowed: `request (33723 tokens) exceeds the available context size`.
  `--ctx-size` is divided across `--parallel` slots, so
  `--ctx-size 262144 --parallel 4` is what yields 64k each.

```bash
llama-server -m ~/models/Qwen3.6-35B-A3B-Q8_0.gguf \
  --host 127.0.0.1 --port 8080 --ctx-size 262144 --parallel 4 --jinja
```

`--jinja` is not optional. Without it llama.cpp does not apply the model's
tool-call template, and an agent with no working tools cannot read a `SKILL.md`.

Expect lower scores than a frontier model, and read them as two separate
measurements. A local model that scores well on answers but badly on routing is
telling you the skill descriptions are not carrying it to the right skill — which
is a fixable defect in the description. A model that routes correctly and still
answers badly has loaded the skill and failed to follow it, which is a fact about
the model, not about the skill.

### Environment

| Variable | Default | Effect |
|---|---|---|
| `EVAL_AGENT` | `claude-code` | Runtime under test: `claude-code` or `pi`. |
| `EVAL_MODEL` | Sonnet 5 for `claude-code`, pi's own default for `pi` | Model under test. Haiku answers skill-shaped prompts from general knowledge instead of loading the skill, so it reports routing failures the real harness does not have. |
| `EVAL_PROVIDER` | unset | Provider passed to `pi --provider`. Name a local provider — `llama-cpp`, `lm-studio`, `ollama` — to run against a local model. Ignored by `claude-code`. |
| `EVAL_BASE_URL` | derived from `EVAL_PROVIDER` | Health-check URL for a local model server. Set it for a provider the defaults do not cover. |
| `EVAL_CWD` | this repo | **Set this.** Directory the agent runs in; point it at a `common` checkout. The prompts name paths like `packages/common` and workspaces like `api`, so anywhere else the agent reports that it cannot find them and asks for a path instead of loading the skill. That scores as a routing failure the real harness does not have. |
| `EVAL_SAMPLES` | `1` | Runs per case. Above 1, the case is graded on its hit rate. |
| `EVAL_PASS_RATE` | `0.5` | Fraction of samples a gated score must pass. |
| `EVAL_TERM_SCOPE` | `answer` | Where `expected_terms` match. `transcript` also searches tool results. |
| `EVAL_CONCURRENCY` | `4`, or `1` against a local server | Prompts in flight at once. |
| `EVAL_TIMEOUT_MS` | `240000` | Wall-clock cap per prompt. The vitest per-test cap is derived from this and `EVAL_SAMPLES`, so raising it no longer lets vitest kill a run before the harness timer fires. |
| `EVAL_SKILLS` | all | Comma-separated skill names to run. The cost lever for CI: a PR that touches one skill runs its cases, not all 114. A name matching no eval set throws. |
| `EVAL_REPORT_FILE` | `.vitest-evals/report-<agent>.json` | JSON report path. One file per agent, so a pi run does not overwrite a Claude Code run. |

A malformed value throws rather than falling back to the default, so a typo
cannot quietly turn the suite into a no-op — including a misspelled `EVAL_AGENT`,
which names the thing under test.

Run one skill with `-t "skill: branch-and-pr"`, or one case with `-t "<part of
the query>"`. Inspect a finished run in the browser with
`pnpm evals:ui .vitest-evals/report-claude-code.json`.

### GitHub Actions

Three workflows, split the same way the suites are — by cost.

| Workflow | Trigger | What it runs | Cost |
|---|---|---|---|
| `test.yml` | every push and PR | `pnpm typecheck` + `pnpm test` | Actions minutes only |
| `evals.yml` | PR, weekly cron, manual | evals for the skills the PR touched; the full set on the cron | one agent turn per case |
| `evals-local.yml` | manual, self-hosted runner | the full set through pi against a local `llama-server` | Actions minutes only |

A full run is not something to put on a pull request. Measured on the 114-case
set with Sonnet 5: **$22.27 total, $0.195 per case on average, $0.87 for the
worst one.** So `evals.yml` derives the skills to run from the diff — a skill's
own files and its eval set both select it, and a change under `evals/` selects
everything because it changes the harness. A PR touching one skill runs its 8 to
14 cases for about $1.60 and finishes in a couple of minutes.

`EVAL_SKILLS` is what does the narrowing, and it works locally too:

```bash
EVAL_SKILLS=branch-and-pr,release EVAL_CWD=~/oneproject/common pnpm evals
```

A name that matches no eval set throws. CI derives that list from a diff, so a
rename that stops matching has to fail loudly rather than report a green run of
zero cases.

#### Reaching a model from CI

The harness spawns the `claude` CLI, so CI needs the CLI plus a credential in
the environment. Four options, cheapest first:

| Route | Credential | Marginal cost |
|---|---|---|
| Self-hosted runner + `llama-server` | none | **$0** — local inference, `evals-local.yml` |
| Claude subscription token | `CLAUDE_CODE_OAUTH_TOKEN` | none per token; consumes the plan's rate limits |
| Claude API key | `ANTHROPIC_API_KEY` | per token, at the rates above |
| Bedrock / Vertex / Foundry | OIDC federation, `CLAUDE_CODE_USE_BEDROCK` and friends | per token, billed to that cloud account |

The subscription token is the cheap route for Claude Code. Generate a one-year
token with `claude setup-token`, store it as the `CLAUDE_CODE_OAUTH_TOKEN`
repository secret, and runs bill against your Pro, Max, Team, or Enterprise plan
instead of per token. It only makes model requests, which is all the harness
needs. Budget it against the plan's rate limits rather than a dollar figure: a
full 114-case run is real usage, so keep it on the weekly cron rather than
per-PR even when the marginal dollar cost is zero.

The free route is `evals-local.yml`. It needs a self-hosted runner labelled
`llama` with `pi` and `llama-server` installed and a `llama-cpp` provider in its
`~/.pi/agent/models.json` — the same setup described above. Inference costs
nothing there, so the full set is its default. Until that runner is registered
the workflow is dispatch-only and simply has nowhere to run, so nothing fails in
the meantime.

Do **not** buy cost savings by downgrading the model. Haiku answers
skill-shaped prompts from general knowledge instead of loading the skill, so it
reports routing failures the model your engineers actually run does not have.
A cheaper model changes what the numbers mean; a smaller case selection does not.

#### Two things the eval workflows need

**A checkout of the monorepo under test.** The prompts name paths like
`packages/common` and workspaces like `api`, so `EVAL_CWD` has to point at a
`common` checkout or the agent asks for a path instead of loading the skill.
Both eval workflows check that repository out to `common/` with a
`COMMON_REPO_TOKEN` secret — a PAT or GitHub App token with read access. Without
it the evals still run, but every routing score is meaningless.

**Short artifact retention.** A report embeds prompts, answers, and file
excerpts from the private monorepo, which is also why `.vitest-evals/` is
gitignored. The workflows upload it with `retention-days: 7`.

One more thing the workflows do deliberately: they run every case in **one job**
rather than a matrix. Each case shares a long system-prompt prefix — the skill
listing, the system prompt, the target repo's `CLAUDE.md` — and prompt caching
is doing most of the work in that $0.195 average. Sharding across jobs makes
every shard pay for a cold cache.

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
