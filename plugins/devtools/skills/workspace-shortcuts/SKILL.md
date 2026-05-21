---
name: workspace-shortcuts
description: pnpm w:<workspace> <command> shortcuts (w:app, w:api, w:db, w:ui, w:emails, w:supabase, w:realtime, w:e2e). Use before any pnpm command targeting a workspace — typecheck, test, lint, build, generate, dev.
---

## Shortcut form

`pnpm w:<workspace> <command>` runs `<command>` inside that workspace. Defined in root `package.json`.

## Mapping

| Shortcut | Path |
|---|---|
| `w:app` | `apps/app` (Next.js frontend) |
| `w:api` | `services/api` (tRPC API) |
| `w:db` | `services/db` (Drizzle schema + migrations) |
| `w:ui` | `packages/ui` (component library) |
| `w:emails` | `services/emails` (React Email templates) |
| `w:supabase` | `services/supabase` |
| `w:realtime` | `services/realtime` |
| `w:translation` | `services/translation` |
| `w:workflows` | `services/workflows` |
| `w:e2e` | `tests/e2e` (Playwright) |

## Common patterns

- Type-check the main app: `pnpm w:app typecheck`
- Lint the app (allowed by sandbox): `pnpm w:app lint`
- Generate a migration after schema edit: `pnpm w:db generate`
- Run Storybook: `pnpm w:ui storybook`

## Don't

- Don't `cd` into a workspace and run pnpm there — use the shortcut, it's faster and consistent across runs.
- Don't run `pnpm build` or `pnpm w:db migrate` — both denied in `.claude/settings.json`.
