---
name: i18n-strings
description: Wrap user-facing strings with translations in apps/app. Triggers when adding or editing display text, button labels, headings, error messages, empty states, toasts, or any string a user will see. Trigger phrases — "translate", "translation", "i18n", "useTranslations", "TranslatedText", "dictionary", "en.json", "locale", "label", "error message", "placeholder", "string", "copy".
---

## Rule

Every user-facing string goes through translation. Never hardcode display text.

## Client components

```tsx
import { useTranslations } from "next-intl";

const t = useTranslations();
return <span>{t("Save changes")}</span>;
```

## Server components

```tsx
import { TranslatedText } from "@/components/TranslatedText";
return <TranslatedText id="Save changes" />;
```

## Interpolation

- Simple values: `t("Hello {name}", { name: userName })`
- Rich content (with components): `t.rich("Read the {link}", { link: chunks => <a>{chunks}</a> })`

## Dictionary location

`apps/app/src/lib/i18n/dictionaries/<lang>.json` — one file per language. Keys are the English source strings. The set of supported locales is whichever `.json` files live in that directory — check the folder, don't hardcode the list here.

## Adding a new string

1. Use `t("New string")` in code first.
2. Add `"New string": "New string"` to `en.json`.
3. Add a translation for **every other `.json` file** in `apps/app/src/lib/i18n/dictionaries/`. List them with `ls apps/app/src/lib/i18n/dictionaries/` so you don't miss one when the locale set changes. Translate the value into the target language; keep the key identical to the English source. Don't leave a locale missing or stubbed with the English string.
