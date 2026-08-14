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
| `access-control` | Authorization via the `access-zones` library and our wrappers (`assertProfileAccess`, `assertOrgAccess`, `assertProfileAdmin`, `<AccessBoundary>`, `AccessTierError`), plus ordering OR'd grant checks so the broadest short-circuits before a lookup that can throw. |
| `api-endpoints` | Adding / editing tRPC endpoints — the 4-tier procedure model (`networkAuthenticated` / `authenticatedConfirmed` / `authenticated` / `open`), encoder pattern, schemas in `@op/common`, realtime channels, filtering auth-sensitive fields at the encoder so they can't leak from a future query, `.min(1)` on optional id-like inputs so `''` can't collide with a NULL sentinel, and enum-narrowing as a data-compatibility change. |
| `asana-api` | Talking to Asana directly via the REST API. |
| `branch-and-pr` | Branching and pull-request workflow. |
| `code-conventions` | Cross-cutting review patterns — composition over duplication, naming (no acronyms, `get`/`assert` prefixes, descriptive names over destructure-local ones), scope discipline (one task per PR), no nested ternaries (lift to `if`/`else`, sibling components, or `match()`), derive lists from the source of truth (no hardcoded duplicates), type escape-hatch avoidance, casts at the DB boundary, Common error types, and resolving (or explicitly deferring) the debt a migration carries over. |
| `component-file-structure` | Conventions for organizing a React component file — no component declared inside another's render body, Suspense suffix, react-query over raw fetch, a decorative suspense child needs its own error boundary, single-fetch RSC + client `useSuspenseQuery` hydration, `nuqs` for URL-driven state, don't swallow errors in RSC, mutation errors in `onError`, in-flight guards on mutation controls, loading defaults that match the settled state, reusable hooks take a `navigateTo` callback, `startTransition` for non-urgent post-mutation work, no `Record<string, unknown>`, composition over duplication, optional vs undefined. |
| `dev-environment` | Local dev stack — docker layout, port map, `.env.local` vs `.env.docker`, Supabase Studio + Mailpit, driving the running app from Playwright. |
| `drizzle-migrations` | Drizzle ORM workflow for schema edits + the relational-query (`db.query.X`) preference for reads, including giving `findFirst` a filter that identifies exactly one row. |
| `file-uploads` | Signed-URL upload flow for files/images (sign → PUT-direct-to-Supabase → record), the server-side trust boundaries (stored-MIME re-check, size cap, anti-hijack path prefix), shared upload constants in `@op/common` `utils/storage.ts`, and the `@op/common/client` import boundary for client components. |
| `i18n-strings` | Wrapping user-facing strings with translations in `apps/app` — including the accessibility-facing ones (`aria-label`, `textValue`, `placeholder`) and hook-owned toast copy — plus `getTranslations` for metadata, the i18n `useRouter`, deleting orphaned keys, and why a missing key renders raw with no interpolation. |
| `implement-task` | End-to-end implementation flow for a claimed Asana task. |
| `op-ui-conventions` | Using `@op/ui` + `@op/sense`, design tokens, the type scale, the Tailwind v4 silent-drop traps (`duration-450` emits no CSS), and the accessibility rules reviewers enforce on new components. |
| `pickup-task` | Pick up the next available Agent task from Asana and claim it atomically. |
| `pr-description` | Conventions for PR bodies — concise (usually one paragraph), lead with *what* and *why*, no test-plan checklist, no diff walk-through; mermaid ERDs for schema PRs and stacked-PR references when they earn the space. |
| `realtime-channels` | Naming + design of `Channels.X` builders — `scope[:id]` convention, JSDoc subscriber/broadcaster pairing, when to add a channel vs reuse one, the `channelScope.ts` helper pattern for fanning invalidations across multi-tenant resources, and registering channels synchronously in the request path (never from a deferred callback). |
| `release` | Open the dev → main release PR (invokable as `/release`). |
| `service-layer-structure` | How to organize `packages/common/src/services/<feature>/` — one file per operation, named-params signatures, auth-assert first, transactions with sorted-id locks, re-asserting every gate inside the writing statement's `WHERE`, cursor pagination with an id tie-breaker and a null-safe `cursorValue != null` gate, named re-exports over `export *`, and the `<feature>Auth.ts` / `channelScope.ts` / `schemas.ts` / `constants.ts` / `utils.ts` auxiliary-file conventions. |
| `test-conventions` | Vitest vs Playwright layout, `.test.ts` vs `.spec.ts`, the E2E env shim, `describeAccessTierGating`, stable selectors over structural DOM traversal, test helpers that throw like production, and choosing which kind of test to add. |
| `technical-writing` | Writing prose in ASD-STE100 Simplified Technical English — sentence and paragraph limits, active voice with a named actor, simple tenses, one word per meaning, and the banned filler phrases ("It is important to note", "Crucially", "not just X, it is also Y"). Applies to READMEs, doc pages, runbooks, release notes, skill bodies, help text, and error messages. |
| `vercel-react-best-practices` | Vendored from [`vercel-labs/agent-skills`](https://github.com/vercel-labs/agent-skills) — React/Next.js performance rules. MIT-licensed; refreshed via `scripts/sync-vercel.sh`. |
| `workspace-shortcuts` | `pnpm w:*` shortcuts for running commands inside a specific workspace. |

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
