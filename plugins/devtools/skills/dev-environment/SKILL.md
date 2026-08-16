---
name: dev-environment
description: Local dev stack — pnpm docker:dev vs workspace dev servers, port layout (localhost:3100 app, :3101 API, :3121–3123 Supabase, Mailpit, Storybook on :3600 via pnpm w:sense dev), and .env.local vs .env.docker. Covers the gotchas that look like app bugs but aren't — Storybook needing one pnpm build on a clean checkout because @op/styles resolves to a generated dist, and `Cannot find module '@swc/helpers-<hash>'` meaning a stray lockfile above the monorepo moved Turbopack's inferred workspace root. Use when starting the stack, debugging an unreachable service, running Storybook, opening the app in a browser, writing or fixing a bootstrap version guard, or picking which port to hit.
---

## Two ways to run the stack

| Mode | When | Command |
|---|---|---|
| **Workspace dev servers** | Iterating on a single app, fastest reload | `pnpm w:db start` (Supabase via Supabase CLI), then `pnpm w:app dev` and/or `pnpm w:api dev` in separate terminals |
| **Full docker stack** | Want the whole system (Next.js + tRPC + Supabase + Redis) wired together with one command | `pnpm docker:dev` |

Both are fine. The docker stack is what CI / production look like; workspace dev is the fastest inner loop.

## Ports (docker stack, `PORT_PREFIX=31`, default)

| Service | Port | URL |
|---|---|---|
| Next.js app (apps/app) | 3100 | http://localhost:3100 |
| tRPC API | 3101 | http://localhost:3101 |
| Supabase API | 3121 | http://localhost:3121 |
| Supabase DB | 3122 | `postgres://postgres:postgres@localhost:3122/postgres` |
| Supabase Studio | 3123 | http://localhost:3123 |
| Mailpit (captured emails) | 3124 | http://localhost:3124 |

Storybook and email previews run as separate workspace dev servers (not in the docker stack):

| Service | Port | Command |
|---|---|---|
| `@op/sense` Storybook | 3600 | `pnpm w:sense dev` |
| Email previews | 3883 | `pnpm w:emails dev` |

**Storybook on a fresh clone needs one build first.** `pnpm w:sense dev` / `build` call Storybook directly, and `@op/styles` resolves to a generated `dist/styles.css` that doesn't exist on a clean checkout — you get `Failed to resolve entry for package "@op/styles"`. Run `pnpm build` once, or let CI's `turbo build --filter=@op/sense` compile the dependency first. This was a real CI failure, found by a throwaway probe branch and fixed in PR #1782 by driving the Storybook build through turbo.

## Running multiple stacks side-by-side

The docker stack is `PORT_PREFIX`-driven. The default is `31` (ports `31xx`). Run a second instance on a different prefix:

```bash
PORT_PREFIX=40 pnpm docker:dev   # app → 4000, api → 4001, supabase → 4021…
```

Each prefix has its own DinD volume; first boot of a new prefix re-pulls Supabase sub-images (~5–10 min).

## Env files

| File | Loaded by | Tracked? | Purpose |
|---|---|---|---|
| `.env.local` | Workspace dev (`pnpm w:app dev`, scripts, agent skills) | No (gitignored) | Your personal secrets — Asana token, Resend key, TipTap, etc. Start from `.env.local.example`. |
| `.env.docker` | Docker stack only | Yes (tracked) | Safe local-dev defaults for the containerised stack. **Never** put real secrets here. |

`TIPTAP_PRO_TOKEN` is the one secret the docker stack needs that isn't in `.env.docker` — set it in your shell or `.env.local`.

## Driving the running app from an agent

Once the app is up on http://localhost:3100, use the Playwright MCP server (the user's CLAUDE.md sets `mcp__playwright__*` as the preferred path; the gstack `/browse` skill is the higher-level interface).

To check whether the app is up before driving it:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3100
```

A `200`/`307` means it's serving; anything else (especially `7`/`connection refused`) means the dev server isn't running yet.

## Common gotchas

- **Supabase Studio at :3123 has no login** — it auto-connects to the local DB. Use it for ad-hoc table inspection / SQL.
- **Magic-link / OTP emails go to Mailpit** (http://localhost:3124) in dev, not to a real inbox.
- **Migrations apply on docker stack boot** (via the api container) — so after `pnpm w:db generate`, restart the docker stack to pick up new SQL. Don't `pnpm w:db migrate` manually; it's denied (see `drizzle-migrations`).
- **`pnpm dev` vs `pnpm w:app dev`** — root `pnpm dev` runs `turbo dev` for everything in parallel; the workspace shortcut runs a single app. Prefer the shortcut unless you genuinely need everything.
- **Stack memory budget** — the full docker stack steady-states at ~6–8 GB RAM (DinD + ~12 Supabase sub-containers + Next.js + API + Redis). Give Docker enough headroom.
- **`Cannot find module '@swc/helpers-<hash>/...'` is a workspace-root problem, not an app bug.** Turbopack infers the workspace root by walking up for lockfiles. If any lockfile exists *above* the monorepo — classically from an `npm install` run in `$HOME` — the inferred root moves and Turbopack emits externals symlinks under `.next/dev/node_modules` at the wrong relative depth. It surfaces at runtime as a missing module, which reads like a broken build. The repo's own `pnpm-lock.yaml` is at the root, so a clean checkout resolves correctly; the failure is machine-specific. Check for a stray lockfile above the repo before debugging the app. Next's documented remedy is pinning `turbopack.root` in `next.config.mjs` (PR #1750 research thread, extracted to #1787).
- **A version guard must match the declared range at both ends.** A bootstrap script checking `NODE_MAJOR >= 24` accepts Node 25+ even when the manifests constrain the repo to `24.x`, so a developer runs host-side pnpm commands outside the declared runtime and gets unsupported-engine warnings. Write the guard as an equality against the declared major (`-eq 24`), and change every bootstrap script together — there is one per platform. PR #1771.
- **Documenting a new env var** — any env var the app or build reads must be added to `.env.local.example` (and any sibling env examples), with a short note on when it applies (e.g. build-time / deploy-only). PR #1521 review: `POSTHOG_API_KEY` / `POSTHOG_ENV_ID` were read but undocumented in every example — add them with a build-time/deploy-only note so nobody has to reverse-engineer them from the code.

## When the dev server is misbehaving

1. Check the right port — most "the app is broken" reports turn out to be hitting `3000` (Next.js default) instead of `3100` (this repo's configured port).
2. Tail the docker logs: `docker compose -f docker-compose.dev.yml logs -f app api` to see where it's actually failing.
3. Bring the stack down cleanly before relaunching: `pnpm docker:down` (or `PORT_PREFIX=40 pnpm docker:down` for a non-default prefix).
4. Don't go around the deny list — `pnpm build` and `pnpm w:db migrate` are denied for a reason; let CI / docker-stack boot apply them.
