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
├── scripts/
│   └── sync-vercel.sh
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

## License

MIT. The vendored `vercel-react-best-practices` skill retains its upstream MIT license; see its `SKILL.md` frontmatter for attribution.
