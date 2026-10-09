# common-agent-toolkit

Claude Code plugin marketplace for the [One Project `common`](https://github.com/oneprojectorg/common) monorepo.

One install gives engineers the full agent harness for this codebase: 20 skills, 5 subagents, and the protected-branch hooks. Installing it also installs Vercel's `react-best-practices` skill (from the `vercel` plugin in `claude-plugins-official`) as a required dependency, so front-end work always has it.

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

## Installing via `npx skills`

The plugin is also discoverable by [vercel-labs/skills](https://www.npmjs.com/package/skills) (`npx skills`), which reads the `skills` array declared in `plugins/devtools/.claude-plugin/plugin.json`:

```bash
npx skills add oneprojectorg/common-agent-toolkit --all
```

Or install a subset by name with `-s`. This route only installs `SKILL.md` content — it does not wire up the `PreToolUse` hooks, so engineers who need the protected-branch guards still need the `/plugin marketplace add` path above. It also skips the subagents and the `react-best-practices` dependency (install that with `npx skills add vercel-labs/agent-skills -s react-best-practices`).

## What's in the toolkit

### Workflow

`/implement-task <Asana gid | GitHub issue | spec | prompt>` runs a task end to end: resolve the source, branch off `origin/dev`, plan with `devtools:task-explorer`, load the convention skills for the paths it touches, red-green-refactor, gates via `devtools:gate-runner` (typecheck, tests, `pnpm health` CRAP check, `pnpm blast-radius`), parallel convention reviewers, draft PR. `/pickup-task` picks the next Asana task and hands it to `implement-task`. Large tasks become stacked PRs with `gh stack`.

Convention skills rarely load on their own (descriptions drop out of the skill listing when it is full), so `implement-task` and the reviewer subagents load them explicitly.

### Skills

| Skill | What it covers |
|---|---|
| `implement-task` | One task end to end, from any source (adapters in `references/`). |
| `pickup-task` | Pick the next Asana Agent task from Backlog and hand it to `implement-task`. |
| `asana-api` | Asana REST endpoints used by the Asana adapter. Credentials come from your shell env or `~/.claude/settings.json` `env`, never from `common`. |
| `branch-and-pr` | Branching, scope discipline, and stacked PRs with `gh stack`. |
| `pr-description` | PR body conventions. |
| `release` | Open the dev → main release PR (`/release`). |
| `blast-radius` | Wrapper around `pnpm blast-radius` — check a change's reach is in proportion to the task. |
| `code-conventions` | Naming, types, errors, guards, logging. |
| `component-file-structure` | React component file organization and data fetching. |
| `sense-conventions` | Building UI with `@op/sense`. |
| `i18n-strings` | Translating user-facing strings in `apps/app`. |
| `service-layer-structure` | `packages/common/src/services/<feature>/` layout and transactions. |
| `api-endpoints` | tRPC endpoints, encoders, public route handlers, file uploads. |
| `access-control` | Authorization via `access-zones` and its wrappers. |
| `drizzle-migrations` | Drizzle schema, migrations, and query syntax. |
| `realtime-channels` | `Channels.X` builders and query invalidation. |
| `test-conventions` | Vitest / Playwright layout, factories, coverage. |
| `dev-environment` | Local docker stack, ports, env files, Storybook. |
| `workspace-shortcuts` | `pnpm w:*` shortcuts (stub; see `dev-environment`). |
| `technical-writing` | ASD-STE100 prose for docs, ADRs, skill bodies. |

Each convention skill ends with a `Review checklist`; past review incidents live in its `references/lessons.md`.

### Subagents

| Agent | Role |
|---|---|
| `devtools:task-explorer` | Read-only exploration; returns a ≤300-word brief. |
| `devtools:gate-runner` | Runs the gates; returns failures only. |
| `devtools:backend-reviewer` | Reviews backend diffs with the backend skills preloaded. |
| `devtools:frontend-reviewer` | Reviews frontend diffs with the UI skills and `react-best-practices` preloaded. |
| `devtools:test-reviewer` | Reviews test coverage and test conventions. |

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
│       ├── agents/<name>.md
│       ├── skills/<name>/SKILL.md (+ references/)
│       └── hooks/
│           ├── hooks.json
│           ├── block-protected-branches.sh
│           ├── require-feature-branch.sh
│           └── test-hooks.sh
├── skill-audit/          # trigger evals (run-real-eval.py) and results
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

3. Keep the description ≤300 chars and lead with triggers; end the body with a `## Review checklist`; put incident history in `references/lessons.md`.
4. Optional supporting files (`scripts/`, `references/`, etc.) live next to `SKILL.md` in the same folder.
5. Add it to `plugin.json` and the README table, and add an eval set in `skill-audit/eval-sets/`.

## License

MIT.
