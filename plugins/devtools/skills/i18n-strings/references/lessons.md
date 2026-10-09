# i18n-strings: review lessons

One line per lesson. Each one gives the incident behind a rule in SKILL.md.

- Visible labels were translated but `aria-label` values were English (PR #1654)
- `useFileUpload` toasts and `validateFile` descriptions were hardcoded. The hook now calls `useTranslations` (PR #1674)
- A bare `next/navigation` `useRouter` dropped the locale (PR #1145)
- `buildOnboardingRedirect` always returned `/en/start`. Read the locale from `x-pathname` (PR #1638)
- New validation diagnostics in `@op/common` were English in every locale (PR #1786)
- `email_exists` maps to localized copy with a generic fallback (PR #1556)
- The assign dialog toasted a uuid list and a raw Zod payload (PR #1848)
- Keep `getTranslations` keys free of ICU punctuation (PR #1248)
- Keep key order in sync across locales (PR #1480)
- `pnpm i18n:check` replaced `check:i18n`. Id keys mean an English edit no longer renames the key (PR #2097, #2082, #2107–#2122)
- A scoped `t` reached into another namespace and resolved to nothing (PR #2082)
- A phone conflict reused an account-conflict key, and seven locales said "email" (PR #2069, #2070)
- Noun and verb "Review" need separate keys (PR #1905)
- `services/emails` stays English-only (PR #1834). SMS and workflow copy too (PR #2161, #2163)
- The namespace sweep borrowed keys across features (`editor.undoAction`, `admin.clearSearchAction`) (PR #2120, #2122)
- `DecisionCardHeader` translates a stored phase name, so grep cannot find that key
- `Remove {name}` was missing from every dictionary and was read aloud literally (PR #1683)
- Removed "Coverage" keys stayed in seven dictionaries (PR #1682). Cleanup followed (PR #1684)
- An `ar.json` corruption report was an RTL artifact, and the scan found real corruption in `bn.json` (PR #1851)
- `AssignedCategoriesSuffix` joined names with a hardcoded `, ` (PR #1689)
