# common-agent-toolkit

Claude Code plugin marketplace for the [One Project `common`](https://github.com/oneprojectorg/common) monorepo.

One install gives engineers the full agent harness for this codebase: 11 in-house skills, a vendored copy of Vercel's `react-best-practices` skill, and the protected-branch hooks.

## Install

Once per machine, add the marketplace and install the plugin:

```text
/plugin marketplace add git@github.com:oneprojectorg/common-agent-toolkit.git
/plugin install common-toolkit@common-agent-toolkit
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
| `access-control` | Authorization via the `access-zones` library and our wrappers (`assertAccess`, `checkPermission`, `<AccessBoundary>`). |
| `asana-api` | Talking to Asana directly via the REST API. |
| `branch-and-pr` | Branching and pull-request workflow. |
| `component-file-structure` | Conventions for organizing a React component file. |
| `drizzle-migrations` | Drizzle ORM workflow for schema edits and migrations. |
| `i18n-strings` | Wrapping user-facing strings with translations in `apps/app`. |
| `implement-task` | End-to-end implementation flow for a claimed Asana task. |
| `op-ui-conventions` | Using `@op/ui`, design tokens, and the type scale. |
| `pickup-task` | Pick up the next available Agent task from Asana and claim it atomically. |
| `release` | Open the dev → main release PR (invokable as `/release`). |
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
│   └── common-toolkit/
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

1. Create `plugins/common-toolkit/skills/<name>/SKILL.md`.
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
