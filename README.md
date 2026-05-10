# common-skills

Agent skills for the [One Project `common`](https://github.com/oneprojectorg/common) monorepo.

Skills follow the [Agent Skills](https://agentskills.io/) format and can be installed with the [`skills`](https://www.npmjs.com/package/skills) CLI.

## Installation

Install all skills:

```bash
npx skills add oneprojectorg/common-skills
```

Install a single skill:

```bash
npx skills add oneprojectorg/common-skills --skill access-control
```

## Available skills

| Skill | What it covers |
|---|---|
| `access-control` | Authorization via the `access-zones` library and our wrappers (`assertAccess`, `checkPermission`, `<AccessBoundary>`). |
| `asana-api` | Talking to Asana directly via the REST API. |
| `branch-and-pr` | Branching and pull-request workflow. |
| `component-file-structure` | Conventions for organizing a React component file. |
| `drizzle-migrations` | Drizzle ORM workflow for schema edits and migrations. |
| `i18n-strings` | Wrapping user-facing strings with translations in `apps/app`. |
| `implement-task` | End-to-end implementation flow for a claimed Asana task (BUG MODE, plan review, RGR loop, gate suite). |
| `op-ui-conventions` | Using `@op/ui`, design tokens, and the type scale. |
| `pickup-task` | Pick up the next available Agent task from Asana and claim it atomically. |
| `release` | Open the dev → main release PR (the one flow allowed past the protected-branch hook, via the `CLAUDE_RELEASE=1` marker). Invokable as `/release`. |
| `workspace-shortcuts` | `pnpm w:*` shortcuts for running commands inside a specific workspace. |

See each skill's `SKILL.md` for the full body.

## Related skill collections

- [`vercel-labs/agent-skills`](https://github.com/vercel-labs/agent-skills) — Vercel's official collection, including `vercel-react-best-practices`. Install with:

  ```bash
  npx skills add vercel-labs/agent-skills --skill vercel-react-best-practices
  ```

## Layout

```
skills/
└── <skill-name>/
    └── SKILL.md     # YAML frontmatter (name, description) + body
```

## Authoring a new skill

1. Create `skills/<name>/SKILL.md`.
2. Frontmatter must include `name` and `description`. Keep the description specific — the agent uses it to decide when to load the skill.

   ```markdown
   ---
   name: my-skill
   description: One or two sentences. Start with what the skill covers, then "Use when ...".
   ---

   # body
   ```

3. Optional supporting files (`scripts/`, `references/`, etc.) live next to `SKILL.md` in the same folder.

## License

MIT
