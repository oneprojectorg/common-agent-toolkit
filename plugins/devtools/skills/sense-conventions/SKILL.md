---
name: sense-conventions
description: "@op/sense (shadcn/Base UI) and @op/styles: semantic colour/type tokens, no arbitrary Tailwind values, RTL logical properties, Tailwind v4 traps, aria gotchas, adding a sense component. Use when writing className, picking a token, or editing packages/sense or packages/styles."
---

Read these first. They are authoritative, and this skill does not repeat them:
- Common's `CLAUDE.md` (UI Component System, Accessibility): per-component imports, `cn` from `@op/sense/lib/utils`, semantic colours, the sense type scale, logical properties, `<bdi>`, and the four a11y obligations.
- `packages/sense/CLAUDE.md`: recipes for building UI and adding a primitive or composite, RTL direction, Base UI behaviours that bite, the Never list, and Verify.

This skill adds the rules reviewers keep catching on top of those. Past review incidents, one line each: [references/lessons.md](references/lessons.md).

`@op/ui` and `packages/ui` are gone. Never import them. Base UI uses native prop names (`disabled`, `onClick`), not React Aria's (`isDisabled`, `onPress`).

## Tokens

- Never use raw palette values: `bg-white`, `bg-gray-100`, `text-slate-500`, and hex values. `bg-white` is the flag reviewers raise most on new UI, `loading.tsx` shells included. Grep your diff for `bg-white|text-gray-|bg-gray-` before you push.
- Never use arbitrary values in app code, package code or stories: `text-[14px]`, `stroke-[1.5]`, `w-[36rem]`, `max-h-[70dvh]`. Use the named scale.
- An arbitrary value you repeat is a missing token. Add the raw value to `packages/styles/tokens.css`, the semantic name to `theme.css`, and reference it (`stroke-[var(--stroke-icon)]`).
- `text-xs` / `text-sm` / `text-base` are allowed for control labels and body copy (see the `theme.css` comment). If a bot flags them, rebut it and do not swap in a serif token. `text-label` is 1rem, so a swap can make a label larger than the heading above it.
- Avoid `text-lg` and larger in app code. Those are stock-shadcn leftovers. Use `text-title` / `text-headline` / `text-display`.
- Never use `text-title-*`, `--op-*`, `neutral-gray*` or `primary-teal`. The surviving `--text-title-*` tokens exist only for `headingClasses` (translation content hashes). Do not reference them.

## Tailwind v4 traps

- A bare number in a typed utility emits no CSS: `duration-450` silently does nothing. Write `duration-[450ms]`. When a visual change is the point of the PR, open the page and check it.
- The serif tokens have their own `md` media query. `sm:text-display` shrinks the text between 640 and 767px. Use `md:` or larger, or no prefix.
- `tailwind-merge` discards the losing class of a conflicting pair (for example `cursor-default cursor-pointer`). Delete the dead class.
- A child's `opacity-100` cannot undo an ancestor's `opacity-50`. Dim the siblings with colour tokens instead.

## Accessibility beyond the four obligations

- `aria-label` replaces the visible text. Use it to name the action (`Upload ${label}`), never to add detail. For detail, use `aria-describedby` or tooltip content.
- `pointer-events-none` is not disabled. Set native `disabled`. Sense `Button` with `loading` already does this.
- Items that do nothing must not be keyboard-reachable. Pass `disabled`.
- Do not render an affordance the component cannot honour (for example a drag handle with no `dragHandleProps`). Default it off, or derive it from the props.
- The label of a stateful control tracks its state: `isSelected ? t('Advancing') : t('Advance')`.
- Sortable headers set `aria-sort`.
- Render `<a>` only when there is a real `href`.
- Use `role="tabpanel"` only when a tab exists, together with `aria-labelledby`.
- A standalone line of text is a `<p>`, not a `<span>`.
- Links inside prose are underlined, not colour-only.
- Text-bearing components default to `dir = 'auto'`. Isolation (`<bdi>`) and truncation are separate fixes. A truncating element needs the content's direction (see `packages/sense/CLAUDE.md` RTL).
- `window.open(url, '_blank', 'noopener,noreferrer')`.
- Check the story's A11y panel (`pnpm w:sense dev`). Routes: `pnpm a11y:baseline` (`test-conventions`).

## Choosing components

- Use an existing export before you write a new one (`packages/sense/package.json#exports`). Page-level error screens live in `apps/app/src/components/screens/` (`ForbiddenScreen`, `PageError`, `PageNotFound`).
- Use the same primitive in both halves of one feature (for example `ScrollArea` in both the dialog and the panel).
- If a component is close but not right, extend it with a variant or a prop. Do not fork it.
- A net-new primitive needs design approval. Composing existing ones does not (for example `NumberField` plus a `prefixText` symbol for money).
- When a reviewer asks for generic presentational markup to move into `@op/sense`, do it in a follow-up PR.

## Inside packages/sense

- No `next/*` imports. Take a render or slot prop and let the app inject `next/image`.
- No `t()`. Copy comes in as props, grouped in one `copy` object when there are several strings.
- Delete `rtl:space-x-reverse` if the shadcn CLI emits it.
- A story is part of the change. Stories follow the token rules too.

## Labels, headings, images

- Use sentence case that matches the siblings. Fix every locale, not only `en.json`.
- The page's main title is the `h1`. A secondary bar title is an `h2`.
- A display fallback is an identifier (`?? phase.phaseId`), not `''`. An absent image URL is `?? undefined`.
- `next/image` in a container sized by CSS: `fill` plus `object-cover`.

## Verify

`pnpm typecheck`, `pnpm w:sense build`, `pnpm format:changes`. If Storybook cannot resolve `@op/styles` on a fresh clone, run `pnpm -C packages/styles build` (`pnpm build` is denied).

## Review checklist

- [ ] No `@op/ui` imports and no React Aria prop names
- [ ] No raw palette classes (`bg-white`, `bg-gray-*`, `text-gray-*`), no hex values, no arbitrary values (stories included)
- [ ] Repeated off-scale values became a token in `tokens.css` + `theme.css`
- [ ] Type uses the sense scale or `text-xs/sm/base`. No `text-lg+` in app code, no `text-title-*`
- [ ] No bare-number typed utilities (`duration-450`). No breakpoint prefix below `md` on serif tokens
- [ ] No conflicting utilities. No opacity used to un-dim a child
- [ ] Logical properties only. Directional icons have `rtl:-scale-x-100`. Truncating user text has the content's direction
- [ ] Icon-only controls are named. `aria-label` names the action and is not used to add detail
- [ ] Disabled means native `disabled`. Items that do nothing are not focusable. No affordance without its handler
- [ ] Stateful labels track state. `aria-sort` on sortable headers. `<a>` only with an `href`
- [ ] An existing sense component is reused. The same primitive is used across one feature. No unapproved new primitive
- [ ] `packages/sense` changes have no `next/*` imports and no `t()`, and include a story
- [ ] Animations have a `motion-reduce:` branch
