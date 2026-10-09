---
name: dev-environment
description: "Local stack for common: pnpm w:<workspace> shortcuts, pnpm docker:dev, PORT_PREFIX ports (:3100 app, :3101 API, :3121-3124 Supabase/Mailpit, :3600 Storybook), .env.local vs .env.docker, denied commands, never restart :3100. Use when running, opening or debugging the app, or any pnpm w: command."
---

## Rules

- **Never start, restart or kill the dev server on :3100.** Other agents share it. Check it statically or in the browser against the running server.
- Check that the app is up: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3100` (`200`/`307` = serving).
- Drive the browser with the gstack `/browse` skill.
- Never run `pnpm build` (any `build*` script, including `build:e2e`), bare `pnpm format`, or `pnpm w:db migrate`. Format with `pnpm format:changes`; CI applies migrations.
- After a schema change run `pnpm w:db generate` (CLAUDE.md).
- Typecheck with `pnpm w:app typecheck` or `pnpm typecheck`, not a build.
- Run workspace commands as `pnpm w:<name> <cmd>`. Do not `cd` into a workspace.

## Workspace shortcuts

| Shortcut | Path |
|---|---|
| `w:app` | `apps/app` (Next.js frontend) |
| `w:api` | `services/api` (tRPC routers) |
| `w:common` | `packages/common` (services, `testing` harness) |
| `w:db` | `services/db` (Drizzle schema, migrations) |
| `w:sense` | `packages/sense` (design system, Storybook) |
| `w:ai` | `packages/ai` |
| `w:emails` | `services/emails` |
| `w:supabase` | `services/supabase` |
| `w:realtime` | `services/realtime` |
| `w:translation` | `services/translation` |
| `w:workflows` | `services/workflows` |
| `w:e2e` | `tests/e2e` (Playwright) |

The root `package.json` scripts are the source of truth. `w:ui` is gone; Storybook is `pnpm w:sense dev`.

## Running the stack

| Mode | Command |
|---|---|
| Full stack (Next.js, API, Supabase, Redis, Mailpit) | `pnpm docker:dev`; stop with `pnpm docker:down` |
| One workspace | `pnpm w:db start` (Supabase CLI), then `pnpm w:app dev` / `pnpm w:api dev` |
| Storybook | `pnpm w:sense dev` → :3600 |
| Email previews | `pnpm w:emails dev` → :3883 |

## Ports (`PORT_PREFIX=31`, the default)

| Service | Port |
|---|---|
| App | 3100 |
| API | 3101 |
| Supabase API / DB / Studio | 3121 / 3122 / 3123 |
| Mailpit (dev emails, OTPs) | 3124 |

A second stack runs on another prefix: `PORT_PREFIX=40 pnpm docker:dev` (app :4000). Each prefix has its own volume; its first boot pulls images again.

Test Supabase uses 553xx (`pnpm test:supabase:start`); E2E Supabase uses 563xx. See `test-conventions`.

## Env files

- `.env.local`: gitignored personal secrets for workspace dev and scripts. Start from `.env.local.example`.
- `.env.docker`: tracked, safe defaults for the docker stack. Never put a real secret in it. Set `TIPTAP_PRO_TOKEN` in your shell or `.env.local`.
- A new env var the app or build reads goes into `.env.local.example` with a note on when it applies (PR #1521).

## Gotchas

- "The app is broken" on :3000: the app runs on :3100.
- Studio (:3123) needs no login.
- The docker stack applies migrations at boot. Restart it after a new migration.
- `Failed to resolve entry for package "@op/styles"` in Storybook: `dist/styles.css` is missing. `pnpm install` builds it (postinstall); or run `pnpm -C packages/styles build`.
- `Cannot find module '@swc/helpers-<hash>'`: a lockfile above the repo (often in `$HOME`) moved Turbopack's workspace root. Remove that lockfile.
- Docker logs: `docker compose -f docker-compose.dev.yml logs -f app api`. The full stack needs about 6–8 GB RAM.

## Review checklist

- [ ] No instruction or script starts, restarts or kills :3100
- [ ] No `pnpm build`, `pnpm w:db migrate`, or bare `pnpm format`
- [ ] New env vars are in `.env.local.example`; no secret in `.env.docker`
- [ ] Commands use `pnpm w:<name>`, not `cd` into a workspace
- [ ] Ports and URLs match the `PORT_PREFIX` layout
