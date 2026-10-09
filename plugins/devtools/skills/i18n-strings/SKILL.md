---
name: i18n-strings
description: "next-intl in apps/app: useTranslations / getTranslations from @/lib/i18n, namespaced keys in lib/i18n/dictionaries/*.json, pnpm i18n:check, i18n useRouter, error copy. Use when adding or editing a label, toast, aria-label, error, page title or dictionary key."
---

Common's `CLAUDE.md` (Internationalization) owns the basics: the dictionary location, wrapping every string in `t()`, namespaced camelCase ids, top-level short labels (at most four words, no `{`, `<` or `.`), no periods in keys, and interpolation. This skill adds to it.

Past review incidents, one line each: [references/lessons.md](references/lessons.md).

## APIs

```tsx
// Client components and hooks
import { useTranslations } from '@/lib/i18n';
const t = useTranslations('decisions.proposals');
t('amountRequested');

// Server components and generateMetadata (no TranslatedText; it is gone)
import { getTranslations } from '@/lib/i18n'; // re-exports @/lib/i18n/server
const t = await getTranslations({ locale, namespace: 'decisions' });
const t2 = await getTranslations('decisions'); // request-scoped call
```

- A server component calls `getTranslations`. It does not become a client component to call `useTranslations`.
- Every key in a scoped `t` lives under that namespace. A key that reaches into another namespace resolves to nothing at runtime.
- Navigate with `useRouter`, `redirect` and `Link` from `@/lib/i18n`, never `next/navigation`. Those keep the `[locale]` segment.
- In a redirect URL built by hand on the server, use the real locale (the first segment of `x-pathname`). Never hard-code `/en`.
- Client pages cannot use `generateMetadata`. Keep their title in the client tree.

## What counts as user-facing

- Visible text, toasts (title and description), empty states, validation messages.
- `aria-label`, `aria-description`, `aria-valuetext`, `placeholder`, `title`, `alt`, and strings used for typeahead or filtering.
- Copy passed to `@op/sense` components. Sense ships English defaults and never calls `t()`, so the app call site is the only place that can translate it.
- Hooks translate their own toast copy with `useTranslations()`. Translate every string in one surface, so no toast mixes languages.
- Messages composed in `@op/common` that a user reads. The service layer has no `t()`, so return a stable code plus params and let the app map it to `t()` copy.
- Not in scope: `services/emails` and `services/workflows` (email, SMS). They have no next-intl, no stored locale and no render boundary. Decline bot findings there and cite PR #2161 / #2163.

## Errors shown to users

- Never render `error.message` or a raw upstream string. `toast.error(error.message)` leaks ids and serialized Zod payloads in English.
- Switch on `error.data?.code` or the Common error type, render a `t()` string for each case, and fall back to one localized generic message.
- Send the raw error to `@op/logging/client` (`logger.error(msg, { error })`), never to `console`.
- If the UI can trigger the failure, also prevent it in the UI (`component-file-structure`).

## Keys and dictionaries

- Files: `apps/app/src/lib/i18n/dictionaries/*.json`. Check the folder for the locale set. Do not hard-code the list.
- A namespaced id names the string's role: use the `…Heading`, `…Title`, `…Description`, `…Label`, `…Action`, `…Hint`, `…Status`, `…Count`, `…Error` and `…Success` suffixes. Match the neighbouring keys.
- A key belongs to the feature that owns the concept. Do not borrow another feature's key. Write a second key with the same English value instead.
- A noun and a verb with the same English spelling ("Review", "Vote") get two keys.
- Use a literal key with interpolation, never concatenation (`t('Hello ' + name)`).
- Add every new key to every locale, at the same position, with a real translation, not English.
- Delete orphaned keys from every locale in the same PR. First check whether any value from the database is translated as a key (for example a persisted phase name).
- When you repoint an existing key at a new case, read its value in every dictionary, not only `en.json`. A different meaning usually needs its own key.
- A missing key renders as the raw key with no interpolation. That is invisible in an `aria-label`.
- Never hard-code a list separator. Use `Intl.ListFormat` with the active locale, or render separate elements.
- Write the English source in Simplified Technical English first (`technical-writing`).

## Checks

- `pnpm w:app test` runs `dictionaries.test.ts`: key parity, naming rules, ICU parity.
- `pnpm i18n:check` is a CI merge gate. If a key's English value changed since `origin/dev`, it must change in every other locale. Run it before you push any copy edit.
- If someone reports dictionary corruption, scan every locale for U+FFFD before you edit. An RTL rendering artifact can look like corruption.

```bash
grep -n $'\xef\xbf\xbd' apps/app/src/lib/i18n/dictionaries/*.json
```

## Review checklist

- [ ] No hardcoded user-facing text, including `aria-*`, `placeholder`, `title`, `alt`, toast descriptions and sense copy props
- [ ] Server components use `getTranslations` from `@/lib/i18n`. No `TranslatedText`. No unneeded `'use client'`
- [ ] Every key in a scoped `t` is under that namespace. No borrowed keys from other features
- [ ] New keys exist in every locale file, at the same position, translated
- [ ] English edits change every locale (`pnpm i18n:check` passes)
- [ ] Orphaned keys are removed from all locales. Keys looked up from data are kept
- [ ] No `toast.error(error.message)` or raw upstream strings. Errors map codes to `t()` copy
- [ ] Service-layer messages a user reads are returned as codes, not English
- [ ] `useRouter` / `Link` / `redirect` come from `@/lib/i18n`. No hardcoded `/en`
- [ ] No string concatenation in keys. No hardcoded list separators
- [ ] Noun and verb uses of one English word have separate keys
- [ ] No `t()` added to `services/emails` / `services/workflows`
