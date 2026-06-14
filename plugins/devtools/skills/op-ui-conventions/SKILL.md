---
name: op-ui-conventions
description: Use the @op/ui component library, design tokens (primary-teal, neutral-gray), and the type scale (text-title-lg, text-sm) instead of native HTML, hex colors, or raw Tailwind sizes. Use when writing JSX/TSX, picking a color or font size, importing from @op/ui, choosing a variant vs creating a one-off, or editing packages/ui.
---

## Components

- Prefer `@op/ui` over native HTML — `<Button>` not `<button>`, `<Heading>` not `<h2>`.
- Import per-component: `import { Button } from "@op/ui/Button"`. The library is exported via the `package.json` `exports` field.
- Source: `packages/ui/src/`. Storybook stories sit alongside each component.

## Don't roll one-off components when a variant could exist

When you find yourself overriding `@op/ui` styles to fight a layout (`color="secondary"` plus `w-fit`, `justify-center`, `shadow-md`), pause. Two reviewer-approved paths:

- **Use the existing variant once, leave a comment** ("only use site for now"). PR #1077 review: "happy to extract a `row` / `card` variant once the pattern shows up a second time."
- **Add a variant to `@op/ui`** the second time you need it. The threshold to extract is when you'd otherwise be duplicating the override.

Don't pull in a third-party `<TabPanel>` / `<Sidebar>` without checking what `@op/ui` already provides — reviewers will ask why.

## Colors

- Use token-mapped Tailwind classes: `text-primary-teal`, `bg-neutral-gray1`, etc.
- **Never** use arbitrary hex values like `bg-[#333]` or `text-[#abc]`.
- Token source of truth: `packages/styles/tokens.css` (`--op-*` CSS vars), mapped in `packages/styles/shared-styles.css`.
- The shadcn-derived `--color-background` / `--color-foreground` vars are now defined too (PR #1223). `bg-background` is a valid class — but prefer the named-token classes when you mean a specific brand color.

## Type scale

- Use the custom scale: `text-title-lg`, `text-title-md`, `text-sm`, `text-body`, etc., defined in `packages/styles/shared-styles.css`.
- Do **not** use raw Tailwind sizes (`text-[14px]`, `text-2xl`) unless that exact token is defined.
- `<Header3>` already includes `text-title-base` and `font-weight: 300`. If you're composing a typography style, check what the heading component already gives you before stacking classes (PR #1039 review pattern).

## Variants and design parity

- When the design changes a state (e.g. a confirm button grows from "approve" to "confirmed"), the border-radius and size of the active variant should match the inactive variant. Reviewers will catch the regression visually (PR #1068: "the checkmark grows the button when you set it active").
- If a design references a color or radius that doesn't map to a token yet, prefer adding the token over the inline value.

## When in doubt

Read `packages/ui/src/<component>` to confirm the API before introducing a new component. The Storybook (`pnpm w:ui dev` at port 3600) is the fastest way to scan available variants.

## React/Next.js performance

For anything beyond layout — data fetching, dynamic imports, memoization, transitions — defer to the `vercel-react-best-practices` skill. It owns React/Next.js performance conventions in this repo.
