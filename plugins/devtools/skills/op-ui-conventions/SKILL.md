---
name: op-ui-conventions
description: Use the @op/ui component library, design tokens (primary-teal, neutral-gray), and the type scale (text-title-lg, text-sm) instead of native HTML, hex colors, or raw Tailwind sizes. Prefer semantic dark-mode-aware tokens (bg-muted, text-muted-foreground) over fixed palette values (bg-gray-100). Sentence-case labels matched to siblings. Accessibility and semantics — action-oriented aria-label (not the display label), render an anchor only with a real href else a div, default dir="auto" on text-bearing components, role="tabpanel" only when a paired tab exists. Keep @op/ui framework-agnostic (no next/image inside packages/ui — inject it via a render prop; package components take copy via a single i18n-agnostic prop) and use semantic heading hierarchy (the hero title is the h1). Use when writing JSX/TSX, picking a color or font size, casing a label, setting an aria-label or dir, importing from @op/ui, choosing a variant vs creating a one-off, adding an image preview to a UI primitive, setting heading levels, or editing packages/ui or packages/sense.
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

Even when a hand-rolled class list *looks* correct, reviewers still want the library component so styling stays consistent as tokens evolve (PRs #1556, #1585). The recurring specifics:

- **Standalone styled control → use the `Button` variant, not hand-rolled classes.** A back-arrow or link-styled action should be a `Button` variant (`ghost` / `link`), and its centering (`justify-center items-center`) is already built in — don't re-add it. Reserve the **`inline`** variant for a control embedded *within surrounding text*; using `inline` for a standalone button makes it wrap (PR #1585).
- **Panels / surfaces → `<Surface variant="filled">`, not a raw `<div>` with a background color** (PR #1585).
- **Prompts / empty states → the shared `EmptyState` component**, not a hand-rolled `Surface` prompt (PR #1556).
- **Rely on component defaults** (e.g. `Modal`'s built-in close X and default sizing) instead of passing redundant `className` overrides that just re-state the default (PRs #1556, #1585).

## Colors

- Use token-mapped Tailwind classes: `text-primary-teal`, `bg-neutral-gray1`, etc.
- **Never** use arbitrary hex values like `bg-[#333]` or `text-[#abc]`.
- Token source of truth: `packages/styles/tokens.css` (`--op-*` CSS vars), mapped in `packages/styles/shared-styles.css`.
- The shadcn-derived `--color-background` / `--color-foreground` vars are now defined too (PR #1223). `bg-background` is a valid class — but prefer the named-token classes when you mean a specific brand color.
- **Never a fixed Tailwind palette value (`bg-gray-100`, `text-slate-500`) — use the semantic token** (`bg-muted`, `bg-background`, `bg-accent`, `text-muted-foreground`). A fixed palette value doesn't respond to dark mode, so a `bg-gray-100` element stays light while its surrounding surface inverts — a jarring regression. Pick the token that keeps correct contrast against its surface (e.g. `bg-background` on a `bg-muted` dropzone). PR #1626 review: "`bg-gray-100` is a fixed Tailwind palette value that does not respond to dark mode, unlike every other color used in this file … Using `bg-muted` keeps it consistent and adapts automatically."
- **Links in prose must be underlined, not color-only.** A link inside a text block styled only with `text-primary-teal` fails the axe `link-in-text-block` rule when color contrast alone is insufficient — add an underline so it stays distinguishable from surrounding text. PR #1524: "links in prose need some contrast with the surrounding text to be recognizable, especially when there isn't a ton of color contrast."

## Label casing — sentence case, matched to siblings

UI label, button, and menu-item strings are **sentence case** ("Add to organization", "Edit profile", "View analytics"), not title case ("Add to Organization"). When you add a new label, match the casing of the sibling labels already in that block — a lone title-cased entry reads as a visual inconsistency. PR #1649 review: "Every other menu-item string in this block uses sentence case … but 'Add to Organization' uses title case. This will look visually inconsistent." Apply the correction across **every** locale dictionary file, not just `en.json` — they all follow the same pattern.

## Accessibility and semantics

Reviewers (and the axe / a11y CI bots) consistently flag these on new components — most surfaced during the `@op/sense` component-library port.

- **`aria-label` describes the button's ACTION, not the display label.** Reusing a display label (`aria-label="Profile photo"` on an upload button) leaves a screen-reader user unable to tell what the control *does*. Prefer an action-oriented, contextual name — `Upload ${label}`, falling back to a generic `Upload image`. PR #1626: "the camera button's accessible name becomes 'Profile photo', which doesn't communicate what the button does."
- **Only render an `<a>` when a real `href`/`url` is present; render a plain `<div>` otherwise.** An href-less anchor that still carries `target="_blank"` / `rel="noopener noreferrer"` is a semantically ambiguous element that assistive tech may announce as an unlabelled link. PR #1626: "card only wraps in an `<a>` when a url is present; otherwise it renders a plain `<div>`."
- **Default `dir` to `"auto"` on text-bearing components** (`dir = 'auto'` as a param default), so RTL content resolves its own writing direction. Keep this consistent across sibling components in a file — a new header that spreads `...props` without the default is a gap. PR #1622: "Every other component in this file (Header1-Header4) defaults dir to 'auto' … GradientHeader spreads ...props but there is no default."
- **Apply `role="tabpanel"` only when an associated tab element actually exists**, and pair it with `aria-labelledby` pointing at that tab. ARIA requires each tabpanel to be labelled by its tab; applying the role unconditionally (e.g. in a single-pane layout where the `Tabs`/`TabsList` tree isn't rendered) leaves the panel with no accessible name. PR #1622.

## Type scale

- Use the custom scale: `text-title-lg`, `text-title-md`, `text-sm`, `text-body`, etc., defined in `packages/styles/shared-styles.css`.
- Do **not** use raw Tailwind sizes (`text-[14px]`, `text-2xl`) unless that exact token is defined.
- `<Header3>` already includes `text-title-base` and `font-weight: 300`. If you're composing a typography style, check what the heading component already gives you before stacking classes (PR #1039 review pattern).
- Use the `<Header1>` … `<Header4>` heading components (in `@op/ui`) instead of raw `<h1>` / `<h2>` with handcrafted class lists. If a heading tier doesn't exist yet (`<Header4>`), add it — don't reach for `<h4 className="text-title-sm">` ad-hoc. PR #1262 review: "we can use the `<HeaderX>` components here. If there is no `<Header4>` then one can be added."
- **Semantic hierarchy: the page's main title is the `h1`.** The primary page title (usually in the hero) is the semantic `<h1>`; a secondary top-header-bar title is an `<h2>`. PR #1482 review: "It's better for page structure if the title that's in the hero is the `<h1>` element."
- **Escape hatch — raw `<h1>` with custom classes.** The `@op/ui` `Header` components (`<Header1>` / `<GradientHeader>`) hardcode specific `text-title-*` sizes, and `twMerge` won't dedupe those custom tokens — so they can fight a hero's custom responsive gradient sizing. When the fixed sizing fights the design, a raw `<h1>` with custom classes is acceptable and preserves the main-heading semantics (PR #1439).
- **twMerge misreads custom `text-title-*` sizes as text-color classes.** Because a custom size token like `text-title-lg` starts with `text-`, `twMerge` classifies it as a *color* utility and strips a base `text-neutral-black` (or other shared color) merged from the same className — the element then falls back to the inherited color. Don't share a base color class across elements that also set a custom size token; set the intended color explicitly on each (PR #1543 review).

## Tailwind sizing — stay on the scale

Reach for the named Tailwind sizing scale (`max-w-96`, `max-w-112`, `gap-4`, `p-6`) before arbitrary values. PR #1323 review: "We should probably just fit this to a proper tailwind sizing. I would recommend one rem off here for max-w-112."

- The scale already covers every multiple of `0.25rem` (`w-1` → `w-96`) and many beyond (`max-w-112` = 28rem). Snap to the nearest tier.
- `w-[27rem]`, `max-w-[450px]`, `p-[14px]` are the smell. If a design genuinely needs an off-scale value, add a token in `packages/styles/tokens.css` and a class in `shared-styles.css` rather than sprinkling arbitrary values.

## Reach for the existing component before writing a new one

Most "I need a small X" components already exist. The recurring review-rejection shape is "we have a `<Y>` for this — use that." Examples from recent reviews:

| You think you need… | Reach for | Source |
|---|---|---|
| A loading placeholder for a card / line / image | `<Skeleton>` | `@op/ui/Skeleton` |
| A rich text editor with the Common toolbar | `<RichTextEditor>` | `@op/ui/RichTextEditor` |
| A heading | `<Header1>` … `<Header4>` | `@op/ui` |
| A page-level "you can't see this" / "this isn't here" screen | `<StatusScreen>` / `<ForbiddenScreen>` / `<PageError>` | `apps/app/src/components/screens/` |
| An external link with consistent styling | `<ExternalLink>` (extract if it doesn't exist yet) | grep first |

PR #1262 review: "We can use our `<Skeleton>` component here." PR #1287: "Can we use the standard RichTextEditor for this that has Tiptap and the Common styles builtin already?" PR #1360: extracted `StatusScreen` so `PageError` and `ForbiddenScreen` couldn't drift.

When the existing component is *close* but not quite right, extend it (add a variant or a prop) instead of forking a new one — the second-use threshold from the variant section above applies to whole components too.

When you must open an external link programmatically, always pass the features string: `window.open(url, '_blank', 'noopener,noreferrer')` — the missing opener reference prevents reverse-tabnabbing. PR #1522: `SupportLink` opens with `window.open(SUPPORT_URL, '_blank', 'noopener,noreferrer')`.

## Menu already brings its own Popover

`@op/ui` `<Menu>` renders its own `Popover` — do NOT wrap it in a second `Popover`. Make the trigger element (e.g. a picker) the direct target of `<MenuTrigger>` and forward `placement` to the `Menu` so a single popover is used, following the existing `OptionMenu` pattern (PR #1544 self-review: renders the picker as the direct target of MenuTrigger and forwards placement to the Menu, so a single popover is used — exactly the pattern OptionMenu already uses).

Corollary: when you render menu content **directly inside a `Modal` / `Sheet`** with no `MenuTrigger` (the mobile bottom-sheet case), use `<MenuList>`, not `<Menu>`. `<Menu>` is a `Popover` + `MenuList` combo that needs a trigger; without one it renders an orphan popover. PR #1597 fixed three mobile sheets that rendered `<Menu>` inside a sheet without a trigger by swapping them to `<MenuList>`.

## Cap bottom-sheet / drawer height

Cap bottom-sheet and drawer content at `max-h-[85svh]` (matching the `Sheet` bottom variant) so long content can't stretch it full-screen — which hides the overlay and breaks tap-outside-to-dismiss. PR #1597: "Capped the avatar drawer at `max-h-[85svh]` … so a long profile list can't stretch it full-screen — the overlay stays visible and tap-outside-to-dismiss works."

## Variants and design parity

- When the design changes a state (e.g. a confirm button grows from "approve" to "confirmed"), the border-radius and size of the active variant should match the inactive variant. Reviewers will catch the regression visually (PR #1068: "the checkmark grows the button when you set it active").
- If a design references a color or radius that doesn't map to a token yet, prefer adding the token over the inline value.

## When in doubt

Read `packages/ui/src/<component>` to confirm the API before introducing a new component. The Storybook (`pnpm w:ui dev` at port 3600) is the fastest way to scan available variants.

## Keep `@op/ui` framework-agnostic

`packages/ui` must NOT depend on `next` — never import `next/image` (or any `next/*`) inside a `@op/ui` primitive. When a primitive needs an optimized image, take a render/slot prop and let the **app** inject `next/image`.

- PR #1480: `BannerImageField` added a `renderPreview` prop so the app passes a Next `<Image fill>` while `@op/ui` stays `next`-free — same reason `AvatarUploader` uses a plain `<img>`. Review: "Can this be a NextImage so that we get the benefits of that? or we simply pass in the image which is what we do with the Avatar."
- Wrinkle: `next/image` can't optimize a transient `blob:` optimistic URL, so the internal fallback renders a plain `<img>` for the blob frame while the stable public URL gets the optimized image.
- **Same rule for i18n: a package component can't call the app's translation hook, so it must accept all user-facing copy from the caller.** Group the strings into a single `copy` prop object rather than spraying many individual string props across every call site. PR #1626 (`BannerImageField`): "All user-facing copy, grouped into one prop so the component stays i18n-agnostic … without spraying six string props across every call site."

## React/Next.js performance

For anything beyond layout — data fetching, dynamic imports, memoization, transitions — defer to the `vercel-react-best-practices` skill. It owns React/Next.js performance conventions in this repo.
