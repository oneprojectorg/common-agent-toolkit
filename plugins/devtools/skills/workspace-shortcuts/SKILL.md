---
name: workspace-shortcuts
description: "pnpm w:<name> workspace shortcuts (w:app, w:api, w:common, w:db, w:sense, w:e2e…); see dev-environment. Use when running a command in one workspace."
---

`pnpm w:<name> <command>` runs `<command>` in one workspace (`pnpm w:app typecheck`, `pnpm w:common test:unit`). The root `package.json` scripts define the full set; `w:ui` no longer exists. Do not `cd` into a workspace.

The `dev-environment` skill owns the mapping, ports, and the denied commands.
