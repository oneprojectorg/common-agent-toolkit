---
name: dev-environment
description: Local development environment — Docker stack, port layout (apps/app on 3100, API on 3101/3300, Supabase on 3121/3122/3123, Storybook on 3600, emails on 3883), .env.local vs .env.docker, Supabase Studio + Mailpit, and how to drive the running app via Playwright MCP. Triggers when starting the stack, checking why a service is unreachable, running the app in a browser, picking the right URL/port, or wiring up .env. Trigger phrases — "localhost:3100", "localhost:3101", "localhost:3121", "Supabase Studio", "Mailpit", "docker:dev", "pnpm docker:dev", "PORT_PREFIX", ".env.local", ".env.docker", "Playwright", "open the app", "dev server", "is the server running", "TIPTAP_PRO_TOKEN".
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
| UI Storybook | 3600 | `pnpm w:ui dev` |
| Email previews | 3883 | `pnpm w:emails dev` |

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

## When the dev server is misbehaving

1. Check the right port — most "the app is broken" reports turn out to be hitting `3000` (Next.js default) instead of `3100` (this repo's configured port).
2. Tail the docker logs: `docker compose -f docker-compose.dev.yml logs -f app api` to see where it's actually failing.
3. Bring the stack down cleanly before relaunching: `pnpm docker:down` (or `PORT_PREFIX=40 pnpm docker:down` for a non-default prefix).
4. Don't go around the deny list — `pnpm build` and `pnpm w:db migrate` are denied for a reason; let CI / docker-stack boot apply them.
