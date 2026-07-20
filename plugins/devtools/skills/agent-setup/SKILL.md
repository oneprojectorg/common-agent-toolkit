---
name: agent-setup
description: How to stand up a clone of the One Project "OP Bot" coding agent — the Multica cloud agent (runtime, model, instructions, bound skills) and the local Claude Code harness that mirrors it (devtools plugin, settings.json, the block-ai-coauthor hook, MCP servers, the multica CLI). Use when creating a new Multica coding agent, onboarding a machine to run one, replicating this agent's exact configuration, or auditing what a running agent is made of.
---

# Replicating the OP Bot agent

This skill captures everything that makes up **OP Bot** — the autonomous
coding agent that plans and builds features/bugs in the One Project `common`
monorepo — so you can stand up an identical one.

There are **two independent layers**. Decide which you need:

1. **The Multica platform agent** — the workspace `agent` row the daemon runs
   autonomously when an issue is assigned to it. This is "the agent" proper.
2. **The local Claude Code harness** — the `~/.claude` config a *human*
   engineer installs to work the same codebase with the same skills, hooks, and
   conventions. Independent of the platform agent, but built from the same
   toolkit.

Do layer 1 to reproduce the autonomous bot. Do layer 2 to give a developer the
same assistant locally. Do both to fully mirror this setup.

> Values below (agent id, runtime id, workspace id, skill ids) are specific to
> this deployment and change per workspace. Read live state with
> `multica agent get <agent-id> --output json` rather than trusting a
> hardcoded copy. See `multica-creating-agents` for the full field contract.

---

## Layer 1 — the Multica platform agent

### The reference agent

`multica agent get 365d9e62-ee8d-4bd1-8282-43c26ec84083 --output json` on the
source workspace returns:

| Field | Value |
|---|---|
| `name` | `OP Bot` |
| `description` | `Plans and builds features and/or bugs in our codebase` (catalog only — NOT the runtime prompt) |
| `model` | `claude-opus-4-8` |
| `thinking_level` | `""` (runtime default) |
| `visibility` | `workspace` |
| `max_concurrent_tasks` | `12` |
| `custom_args` | `[]` |
| `custom_env` | none (`has_custom_env: false`) |
| `mcp_config` | none |
| `skills` | 22 bound (see below) |
| `instructions` | the durable behavior contract — see "Instructions" below |

### Prerequisites

The agent runs on a **runtime** owned by a **daemon** on some machine. Install
and register that first (this is the same `multica` CLI setup as layer 2 —
`brew install multica-ai/tap/multica`, then `multica setup cloud`, which
authenticates, starts the daemon, and registers a local runtime). Confirm a
runtime is online:

```bash
multica runtime list --output json    # note the runtime_id, check it is online
```

See `multica-runtimes-and-repos` for the runtime/daemon/claim chain.

> **Terminology — "runtime" is not Claude Code.** In Multica, the **daemon** is
> a local process that claims queued tasks; the **runtime** is the execution
> target it manages. On claim, the daemon prepares the task workdir (repo
> checkout, env, injected skills, a generated `CLAUDE.md`) and then launches the
> **provider CLI** — for this agent that provider is **Claude Code** (`claude`),
> running the `claude-opus-4-8` model. So Claude Code is what the runtime
> *launches*, not the runtime itself; other providers (Codex, OpenCode) can sit
> behind the same runtime layer. When this skill says "runtime built-in" skills
> (e.g. `review`), it means skills the Multica **runtime** bundles and drops into
> the workdir's `.claude/skills/`, which Claude Code then loads — not Claude
> Code's own built-in commands.

### Create the agent

`instructions` is the only text the daemon ships to the model as the durable
contract — `description` is catalog metadata and never reaches the prompt. Put
the full behavior contract in `instructions`. Write it to a file, never inline
(secrets/quoting), then:

```bash
multica agent create \
  --name "OP Bot" \
  --runtime-id <runtime-id> \
  --model claude-opus-4-8 \
  --description "Plans and builds features and/or bugs in our codebase" \
  --instructions "$(cat ./instructions.md)" \
  --output json
```

Optional flags this agent leaves at defaults: `--thinking-level` (empty),
`--custom-args` (`[]`), `--custom-env-*` (none), `--mcp-config-*` (none). Set
`--max-concurrent-tasks 12` and `visibility workspace` to match. See
`multica-creating-agents` for every field, its persisted shape, and the
create-vs-update rules (notably: `custom_env` can only be set via the dedicated
env endpoint, never `agent update`).

### Instructions (the runtime behavior contract)

The exact `instructions` string on the reference agent is the commit-attribution
policy + working rules. Reproduce it verbatim; the essentials:

- **Commit attribution.** The git author is the configured git user only.
  **Never** list Claude/Anthropic/Multica/the agent/any AI or tool identity as
  author or co-author. Every commit carries exactly **one** `Co-Authored-By:`
  trailer naming the human owner (the task assignee), mapped to their commit
  identity:
  - Scott / `scazan` → `Co-Authored-By: Scott Cazan <scottcazan@gmail.com>`
  - Valentin / `valentin0h` → `Co-Authored-By: Valentino <v.hudhra@gmail.com>`
  - Nour / `nourmalaeb` → `Co-Authored-By: Nour`
  - No mappable assignee → stop and ask before committing; never fall back to an
    AI/tool identity. If unassigned but you know the task creator, use them.
- `ALWAYS follow YAGNI principles.`
- `ALWAYS use /implement-task to work on issues.`

This policy is also enforced mechanically by the `block-ai-coauthor` hook in
layer 2 — install both; the hook is the backstop for the instruction.

### Bind the skills

Creating an agent binds **no** skills. Bind them explicitly afterward. This
agent has **22** skills bound. First the skill must exist in the workspace skill
DB (import it once per workspace), then bind it to the agent.

**Import** (once per workspace, per skill) with `multica skill import --url ...`
— see `multica-skill-importing`. The 22 skills and their sources:

| Source | Skills |
|---|---|
| `github.com/oneprojectorg/common-agent-toolkit` (this repo, `plugins/devtools/skills/<name>`) | `access-control`, `api-endpoints`, `asana-api`, `branch-and-pr`, `code-conventions`, `component-file-structure`, `dev-environment`, `drizzle-migrations`, `i18n-strings`, `implement-task`, `op-ui-conventions`, `pickup-task`, `pr-description`, `realtime-channels`, `release`, `service-layer-structure`, `test-conventions`, `workspace-shortcuts` (18) |
| `github.com/garrytan/gstack` | `autoplan`, `investigate` (2) |
| runtime built-ins (no import; shipped with the runtime) | `review` (gstack's review skill), `vercel-react-best-practices` (vercel-labs) (2) |

**On gstack:** the gstack **toolchain** is *not* installed on this machine —
there is no `~/.claude/skills/gstack/` tree, no `~/.gstack/` state dir, and no
gstack CLI (verified directly). Nothing to `brew install` or add to `~/.claude`.
What the agent actually uses are gstack **skills**, delivered two ways:

- **Workspace-imported:** `autoplan` and `investigate`, imported from
  `github.com/garrytan/gstack` and bound like any other skill (below).
- **Runtime built-in:** `review` — its body *is* gstack's review skill (it
  self-identifies as GStack and calls `~/.claude/skills/gstack/bin/*` helpers).
  The Multica runtime ships it as a built-in and injects it per task. Because the
  gstack toolchain isn't installed, those helper-bin calls are all guarded
  (`… 2>/dev/null || true`) and no-op — `/review` runs standalone in a degraded
  mode without gstack's config, telemetry, or specialist files.

So `/review` **is** a gstack skill — but it arrives through the Multica runtime,
not a machine-level gstack install, which is why gstack has no entry under "Base
tools" or the MCP section. To get the *full* gstack experience (specialist
sub-checks, learnings, brain-sync) you would additionally install the gstack
toolchain at `~/.claude/skills/gstack/`; this deployment does not.

Example import + bind for one toolkit skill:

```bash
multica skill import --url github.com/oneprojectorg/common-agent-toolkit/tree/main/plugins/devtools/skills/implement-task --output json
multica agent skills add <agent-id> --skill-ids <returned-skill-id> --output json
```

`add` is additive; `set` is replace-all (destructive — it drops bindings not in
the new list). Verify with `multica agent skills list <agent-id> --output json`.

The two runtime built-ins (`review`, `vercel-react-best-practices`) are embedded
in the runtime and appended after workspace skills at claim time — you do not
import them.

### Run it

Assign an issue to the agent (assignee = this agent). The daemon claims the
task, checks out the project's repo, injects the agent `instructions` + bound
skills + a generated `CLAUDE.md` runtime workflow, and runs the provider CLI in
a task workdir. See `multica-working-on-issues` and `multica-runtimes-and-repos`.

---

## Layer 2 — the local Claude Code harness

This is what a human engineer installs so their own Claude Code mirrors the
agent's toolkit. Everything here lives under `~/.claude`.

### 1. Base tools

- **Claude Code** installed and signed in.
- **`gh` CLI + SSH auth to GitHub** — required to install the private plugin
  marketplace.
- **`multica` CLI** (also the layer-1 runtime): `brew install multica-ai/tap/multica`,
  then `multica setup cloud`.

Native apps that back the MCP servers and the dev stack (install these too —
several MCP integrations and the docker dev stack are non-functional without
them):

- **Figma desktop app** — required by the Figma MCP server. The MCP talks to
  the locally running Figma app; the browser build alone is not enough. Install
  it (`brew install --cask figma`) and sign in before using any `figma` MCP
  tool.
- **OrbStack** — the Docker/container engine used to run the full local stack
  (`pnpm docker:dev`, see `dev-environment`). Install it
  (`brew install --cask orbstack`) and let it provide the Docker socket; the
  docker stack won't come up without a running engine.

This list tracks the tools this deployment currently depends on; add to it as
new MCP servers or integrations bring their own native prerequisites.

### 2. Install the devtools plugin

Inside Claude Code (once per machine):

```text
/plugin marketplace add git@github.com:oneprojectorg/common-agent-toolkit.git
/plugin install devtools@common-agent-toolkit
```

This clones the marketplace to `~/.claude/plugins/cache/` and wires in the
skills plus the two protected-branch hooks (`block-protected-branches.sh`,
`require-feature-branch.sh`). Update later with
`/plugin marketplace update common-agent-toolkit`.

### 3. `~/.claude/settings.json`

The reference machine uses:

```json
{
  "permissions": { "defaultMode": "auto" },
  "model": "opus[1m]",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "/Users/<you>/.claude/hooks/block-ai-coauthor.sh" }
        ]
      }
    ]
  },
  "enabledPlugins": { "devtools@common-agent-toolkit": true },
  "extraKnownMarketplaces": {
    "common-agent-toolkit": {
      "source": { "source": "git", "url": "git@github.com:oneprojectorg/common-agent-toolkit.git" }
    }
  },
  "theme": "dark",
  "skipAutoPermissionPrompt": true
}
```

- `model: opus[1m]` — Opus with the 1M-token context window.
- `permissions.defaultMode: auto` + `skipAutoPermissionPrompt: true` — the agent
  runs tools without per-call approval prompts. Only appropriate in a trusted,
  sandboxed workspace.
- Fix the absolute hook path to your home dir.

### 4. The `block-ai-coauthor` user hook

Create `~/.claude/hooks/block-ai-coauthor.sh` (make it executable). It is a
`PreToolUse(Bash)` hook that blocks any `git commit` whose message adds a
`Co-Authored-By:` trailer attributing the commit to an AI/tool identity
(Claude, Anthropic, Multica, GPT, OpenAI, Codex, "the agent"). It matches
git-commit-ish commands permissively, is case-insensitive, and lets real-human
trailers (e.g. `Co-Authored-By: Scott Cazan <scottcazan@gmail.com>`) through.
This is the mechanical enforcement of the layer-1 commit-attribution policy —
copy the current script from this deployment (`~/.claude/hooks/block-ai-coauthor.sh`)
verbatim; the canonical body lives in `references/block-ai-coauthor.sh` next to
this skill.

This is distinct from the plugin's two hooks (which block writes to
`main`/`dev`). All three run together.

### 5. MCP servers

Two sources of MCP tools on the reference machine:

- **Configured in the CLI** — PostHog analytics, over HTTP:

  ```bash
  claude mcp add --transport http posthog https://mcp.posthog.com/mcp
  ```

  (Persists to `~/.claude.json` as `mcpServers.posthog`, type `http`.)

- **Connected via the claude.ai account** (account-level integrations, connected
  through `/mcp` in Claude Code / claude.ai, not `~/.claude.json`): Asana,
  Figma, Gmail, Google Drive, Google Calendar, Granola, Justworks, Notion,
  Zapier, Zoom. Connect only the ones you need; each authenticates through its
  own OAuth flow. Note interactively-authenticated claude.ai MCP servers may be
  absent in headless/cron runs. **Figma** additionally needs the Figma desktop
  app installed and running (see "Base tools" above) — the OAuth connection
  alone does not make its MCP tools work.

### 6. Git identity

Set your own git `user.name` / `user.email` (per-repo or global). The commit
author is always the configured human — never an AI identity (the
`block-ai-coauthor` hook enforces this).

---

## Environment variables

The agent reads these from the **process environment the Multica daemon
inherits from the shell that launched it** — so set the secrets in your **ZSH
env file** (`~/.zshenv`, which loads for non-interactive shells too, or
`~/.zshrc`). The reference agent carries **no** `custom_env`
(`has_custom_env: false`); it relies entirely on the daemon's inherited shell
environment. A local developer can equally keep the same values in the repo's
gitignored `.env.local`.

> Only the variable **names** are listed here — never commit or print the
> values; that is a security violation. If one of these is empty, the skills
> stop and ask rather than inventing a value.

### Set these yourself (secrets + deployment ids)

| Name | Read by | Purpose |
|---|---|---|
| `ASANA_PERSONAL_ACCESS_TOKEN` | `asana-api`, `pickup-task`, `implement-task` | Asana REST auth (`Authorization: Bearer …`) |
| `ASANA_PROJECT_ID` | same | gid of the team's Asana task project |
| `ASANA_BACKLOG_SECTION_ID` | `pickup-task`, `implement-task` | board section gid — Backlog |
| `ASANA_IN_PROGRESS_SECTION_ID` | `implement-task` | board section gid — In Progress |
| `ASANA_IN_REVIEW_SECTION_ID` | `implement-task` | board section gid — In Review |
| `ASANA_BLOCKED_SECTION_ID` | `implement-task` | board section gid — Blocked |
| `ASANA_ON_HOLD_SECTION_ID` | task-board flows | board section gid — On Hold (set on this deployment) |
| `TIPTAP_PRO_TOKEN` | `dev-environment` (docker stack) | TipTap Pro registry token |

Shape only — supply your own values, never these placeholders:

```zsh
# ~/.zshenv
export ASANA_PERSONAL_ACCESS_TOKEN=...
export ASANA_PROJECT_ID=...
export ASANA_BACKLOG_SECTION_ID=...
export ASANA_IN_PROGRESS_SECTION_ID=...
export ASANA_IN_REVIEW_SECTION_ID=...
export ASANA_BLOCKED_SECTION_ID=...
export ASANA_ON_HOLD_SECTION_ID=...
export TIPTAP_PRO_TOKEN=...
```

The PostHog MCP server and the claude.ai integrations authenticate over OAuth,
not env vars — nothing to set here for them.

### Injected by the Multica runtime — do NOT set these yourself

The daemon sets these per task when it launches the provider. They are
task-scoped and change every run; hardcoding them in your ZSH env file would
break task routing and auth. Listed so you recognize them, not so you set them:

`MULTICA_AGENT_ID`, `MULTICA_AGENT_NAME`, `MULTICA_WORKSPACE_ID`,
`MULTICA_SERVER_URL`, `MULTICA_TASK_ID`, `MULTICA_TASK_SLOT`,
`MULTICA_DAEMON_PORT`, `MULTICA_TOKEN`.

---

## Verifying a replica

- Platform agent: `multica agent get <id> --output json` — compare `model`,
  `max_concurrent_tasks`, `visibility`; `multica agent skills list <id>` — expect
  22 bindings.
- Local harness: `/plugin` shows `devtools@common-agent-toolkit` enabled; the
  skills list includes the toolkit skills; a `git commit` with an AI
  `Co-Authored-By:` trailer is rejected by the hook; `claude mcp list` shows
  `posthog`.
