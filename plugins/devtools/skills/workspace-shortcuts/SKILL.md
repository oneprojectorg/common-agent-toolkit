---
name: workspace-shortcuts
description: pnpm w:<workspace> <command> shortcuts (w:app, w:api, w:db, w:sense, w:emails, w:supabase, w:realtime, w:translation, w:workflows, w:ai, w:e2e). Use before any pnpm command targeting a workspace — typecheck, test, lint, build, generate, dev. Note w:ui is gone with packages/ui; Storybook is pnpm w:sense dev.
---

## Shortcut form

`pnpm w:<workspace> <command>` runs `<command>` inside that workspace. Defined in root `package.json`.

## Mapping

| Shortcut | Path |
|---|---|
| `w:app` | `apps/app` (Next.js frontend) |
| `w:api` | `services/api` (tRPC API) |
| `w:db` | `services/db` (Drizzle schema + migrations) |
| `w:sense` | `packages/sense` (the design system) |
| `w:ai` | `packages/ai` |
| `w:emails` | `services/emails` (React Email templates) |
| `w:supabase` | `services/supabase` |
| `w:realtime` | `services/realtime` |
| `w:translation` | `services/translation` |
| `w:workflows` | `services/workflows` |
| `w:e2e` | `tests/e2e` (Playwright) |

**`w:ui` no longer exists.** `packages/ui` was deleted in PR #1790 — the design system is `@op/sense`, and its Storybook is `pnpm w:sense dev`. If a command or doc still says `w:ui`, it's stale. Read the `sense-conventions` skill before building UI.

The list above is the current set, but it's generated from the root `package.json` scripts — check there (`node -e "…"` over `package.json#scripts`, or just grep for `"w:`) when a shortcut you expect is missing rather than assuming this table is complete.

## Common patterns

- Type-check the main app: `pnpm w:app typecheck`
- Lint the app (allowed by sandbox): `pnpm w:app lint`
- Generate a migration after schema edit: `pnpm w:db generate`
- Run Storybook: `pnpm w:sense dev` (http://localhost:3600)

## Don't

- Don't `cd` into a workspace and run pnpm there — use the shortcut, it's faster and consistent across runs.
- Don't run `pnpm build` or `pnpm w:db migrate` — both denied in `.claude/settings.json`.
