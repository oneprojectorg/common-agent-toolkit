---
name: i18n-strings
description: Wrap every user-facing string in apps/app with translations (i18n) — useTranslations in client, TranslatedText in server components, getTranslations for generateMetadata. Also use the i18n useRouter (not next/navigation). Use when adding or editing display text, button labels, headings, page titles, error messages, toasts, or any string a user will see; or when navigating programmatically.
---

## Rule

Every user-facing string goes through translation. Never hardcode display text.

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

## Don't

- Don't pass dynamic concatenation as a translation key (`t('Hello ' + name)`). Use interpolation (`t('Hello {name}', { name })`) so the key is a literal the extractor can find.
- Don't ship a `t('foo')` without adding `foo` to every dictionary — CI will fail or, worse, the user will see the raw key.
- Don't sprinkle `useTranslations` to read a single button label in an otherwise-server component — render `<TranslatedText>` instead (see `component-file-structure` skill on `'use client'` discipline).
