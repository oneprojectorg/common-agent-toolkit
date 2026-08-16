---
name: i18n-strings
description: Wrap every user-facing string in apps/app with translations (i18n) — useTranslations in client, TranslatedText in server components, getTranslations for generateMetadata. Accessibility-facing strings (aria-label, placeholder, title, alt) count as user-facing and must go through t() too, and so do validation diagnostics composed in @op/common — the service layer has no useTranslations, so return a code the app maps to t() copy rather than a hardcoded English message. @op/sense components are i18n-agnostic and ship English defaults, so the app call site is the only place that can translate them. Hooks call useTranslations directly rather than hardcoding toast copy. A t() key missing from the dictionaries renders as the raw key with no ICU interpolation, so verify the key exists in every locale. Delete stale keys across all dictionaries when their UI goes away, and never hardcode a list separator. Also use the i18n useRouter (not next/navigation), and thread the actual locale into hand-built server-side redirect URLs (extract it from x-pathname; never hardcode /en). Use when adding or editing display text, button labels, headings, page titles, error messages, toasts, aria-labels, or any string a user or a screen reader will encounter; when navigating programmatically; or when building a redirect URL in a server utility or middleware.
---

## Rule

Every user-facing string goes through translation. Never hardcode display text.

## "User-facing" includes the strings the user never sees

The visible label is the easy half. The accessibility-facing and assistive-tech-facing attributes are user-facing too, and they're the half that gets missed — a screen-reader user gets English no matter their locale, and the visible label being correctly wrapped makes the gap invisible in review. Wrap **all** of these:

- `aria-label`, `aria-description`, `aria-valuetext`
- `placeholder`, `title`, `alt`, and any string a component consumes for typeahead or filtering rather than display
- Toast titles and descriptions, empty-state copy, validation messages

PR #1654: "`aria-label` prop values … are hardcoded English … Because `aria-label` is consumed directly by screen readers … non-English users relying on assistive technology will always see the English copy. The visible `label` correctly uses `<TranslatedText>`, but the accessibility-facing attributes were missed." When only these attributes need `t()`, calling `useTranslations()` in a file that otherwise renders `<TranslatedText>` is fine — it doesn't force a `'use client'` directive that wasn't already there.

Sense components are i18n-agnostic by design — they take copy as props with English defaults and never call `t()` — so **the app is the only place that can translate them**. A missing `t()` at the call site ships the English default silently, with nothing in `packages/sense` to catch it.

## Hooks translate their own copy

A React hook can call `useTranslations()` directly — so a hook that raises a toast owns translating that toast. Don't leave the copy hardcoded in the hook "because it isn't a component." PR #1674: `useFileUpload` shipped `"That didn't work"` and `'Something went wrong on our end. Please try again'` as raw English toast strings; the fix wrapped them with the hook's own `useTranslations()`, matching `useProfileImageUpload` in the same PR.

Translate **every** string that lands in the same surface. The same PR also wrapped the two `validateFile` descriptions, because a translated title over an untranslated description is a mixed-language toast — worse than either alone.

## Client components

```tsx
import { useTranslations } from "@/lib/i18n";

const t = useTranslations();
return <span>{t("Save changes")}</span>;
```

## Server components

```tsx
import { TranslatedText } from "@/components/TranslatedText";
return <TranslatedText text="Save changes" />;
```

## `generateMetadata` (page titles, descriptions)

Server-side metadata uses `getTranslations` from `next-intl/server`:

```ts
import { getTranslations } from 'next-intl/server';

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t('Overview') };
}
```

**Key punctuation caveat**: `getTranslations` parses keys for ICU-style punctuation. Keep server-side keys plain (`'Overview'`, `'Current Phase'`) — avoid colons / braces / pipes in the key. Client-side `useTranslations` is more forgiving, but consistency is easier when you keep keys plain on both sides (PR #1248 discussion).

Client pages (e.g. the proposal editor) can't use `generateMetadata` — keep the page title in the client tree and accept the lower-priority browser-window-only title for those routes.

## Navigation — use the i18n `useRouter`

The `next-intl` setup ships its own `useRouter` (and `Link`) that preserves the `[locale]` segment. Use those, **not** the bare `next/navigation` versions:

```tsx
// ✅
import { useRouter } from '@/lib/i18n';

// ❌
import { useRouter } from 'next/navigation';
```

The bare router strips the locale prefix on `router.push('/foo')` and the user lands on the default-locale page. Reviewer flag (PR #1145): "Should we import our i18n version of `useRouter`?"

**Server-side redirects: thread the actual locale, don't hardcode a segment.** When you build a redirect / navigation URL by hand (a server utility, middleware — anywhere the i18n `useRouter` isn't available), never hardcode a locale segment like `/en/start`. Hardcoding `/en` sends a non-English user (e.g. at `/fr/decisions`) to the English page. The current locale is already the leading segment of `x-pathname` — extract it and build `/${locale}/start`. PR #1638: "`buildOnboardingRedirect` always returns `/en/start` regardless of the user's locale … the user's current locale is already available on `x-pathname` (it's the leading segment)."

## A string written in `@op/common` is still user-facing if a user reads it

The rule is usually stated as "wrap every string in `apps/app`", which quietly implies the service layer is exempt. It isn't. A validation diagnostic composed in `packages/common` and surfaced verbatim in a form error is English in every locale, and no dictionary check catches it because there's no `t()` to grep for. PR #1786 shipped a batch of new proposal / review / vote / custom-form / instance-update diagnostics that way: "these new user-facing validation messages are hardcoded in English, so … consumers display them untranslated in non-English locales."

The service layer has no `useTranslations`, so pick one:

- **Return a stable code plus structured params** (`{ code: 'DUPLICATE_OPTION_LABEL', field }`) and let the app map it to `t()` copy — the shape the app already uses for known error flags.
- **Route the message through the app's translation layer** at the boundary that renders it.

Either way the raw English string is a debugging detail, not the thing the user reads. See also `code-conventions` on naming the field and blaming the right party in a validation error.

## User-facing errors are localized copy, never the raw upstream message

Never render a raw upstream / library / API error string to the user — it's untranslated and often leaks internals. Map known error flags to localized strings, fall back to a localized generic message otherwise, and send the raw error to the console for debugging. PR #1556: "Let's surface a friendlier error (that can be localized) instead" → `email_exists` maps to localized copy with a localized generic fallback, "raw error still goes to the console for debugging."

## Interpolation

- Simple values: `t("Hello {name}", { name: userName })`
- Rich content (with components): `t.rich("Read the {link}", { link: chunks => <a>{chunks}</a> })`

## Dictionary location

`apps/app/src/lib/i18n/dictionaries/<lang>.json` — one file per language. Keys are the English source strings. The set of supported locales is whichever `.json` files live in that directory — check the folder, don't hardcode the list here.

## Adding a new string

1. Use `t("New string")` (or `<TranslatedText>`) in code first.
2. Add `"New string": "New string"` to `en.json`.
3. Add a translation for **every other `.json` file** in `apps/app/src/lib/i18n/dictionaries/`. List them with `ls apps/app/src/lib/i18n/dictionaries/` so you don't miss one when the locale set changes. Translate the value into the target language; keep the key identical to the English source. Don't leave a locale missing or stubbed with the English string.
4. **Keep key order in sync across every locale file.** Put new keys in the same position — one contiguous block — in every `.json`, not appended in random order per file, so the dictionaries diff side by side. PR #1480 review: "a nit here.. it's nice to keep the languages in sync in terms of order of keys so they can be easily compared."

### A missing key degrades silently — and worst on the invisible strings

`next-intl` returns the **raw key string, with no ICU interpolation**, for a key it can't find. So `t('Remove {name}', { name })` on an unregistered key renders the literal `Remove {name}` — braces and all — in every locale including English. When the string is an `aria-label`, nothing on screen looks wrong; only a screen-reader user hits it. PR #1683 shipped exactly that: "the `Remove {name}` aria-label is passed to `t()` as a lookup key, but the key is absent from all seven dictionary files including `en.json` … every reviewer chip's remove button exposes the literal text 'Remove {name}' to screen readers across all locales — a real accessibility defect shipped with the feature."

Before you open the PR, grep each new key back out of `en.json` and confirm the count of dictionary files carrying it matches `ls apps/app/src/lib/i18n/dictionaries/ | wc -l`.

### Delete the keys your change orphaned

Removing or replacing UI means removing its dictionary keys — in **every** locale file, in the same PR. Dead keys mislead translators and hide which copy is live. PR #1682 review: the "Coverage" radio group was replaced by a "Scope" section but `"How should proposals get distributed to reviewers?"`, `"Full coverage"`, and `"Every reviewer scores every proposal"` "remain across all 7 language dictionaries." PR #1684 was the follow-up cleanup: a codebase-wide search confirmed no remaining references, then the keys came out of all seven files at once.

## Composing strings: don't hardcode the separator

Joining a list with a literal `', '` bakes an English punctuation convention into every locale — Arabic and several others use a different list separator. When you render a joined list, either build it through the i18n layer (`Intl.ListFormat` with the active locale) or render the items as discrete elements and let CSS space them. PR #1689 review: `AssignedCategoriesSuffix` "joins category names with a hardcoded `, ` — worth a follow-up for Arabic and other locales where a different list separator applies."

## Don't

- Don't pass dynamic concatenation as a translation key (`t('Hello ' + name)`). Use interpolation (`t('Hello {name}', { name })`) so the key is a literal the extractor can find.
- Don't ship a `t('foo')` without adding `foo` to every dictionary — CI will fail or, worse, the user will see the raw key.
- Don't sprinkle `useTranslations` to read a single button label in an otherwise-server component — render `<TranslatedText>` instead (see `component-file-structure` skill on `'use client'` discipline).
