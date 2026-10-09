---
name: code-conventions
description: "Cross-cutting TypeScript rules for oneprojectorg/common: naming (get/assert/is, no acronyms), no as/any/!, Common errors (NotFoundError, ValidationError, UnauthorizedError), fail closed, guard every arm, logging, comments. Use when writing, refactoring or reviewing any code here."
---

Rules that apply to every file in `oneprojectorg/common`. Common's `CLAUDE.md` is the base layer. This skill adds to it and does not repeat it.

Other owners (link, do not restate):
- Scope discipline, one task per PR, stacking: `branch-and-pr`.
- Drizzle query syntax and migrations: `drizzle-migrations`.
- Cache refresh and channels: `realtime-channels`.
- UI strings: `i18n-strings`. Components: `component-file-structure`. Styling: `sense-conventions`.

Past review incidents, one line each: [references/lessons.md](references/lessons.md).

## Naming

| Prefix | Means | Example |
|---|---|---|
| `get*` | Returns a value | `getReviewsGroupedByRecommendation` |
| `list*` | Paginated or multi-row read | `listProposals` |
| `create*` / `update*` / `delete*` | Mutation | `createProposal` |
| `assert*` | Throws on failure, can return the loaded value | `assertProfileAccess` |
| `is*` / `has*` / `can*` | Boolean | `isAdmin`, `canEdit` |
| `resolve*` | Computes or disambiguates a value | `resolvePhaseWindow` |

- Write the word: `authorization` not `authz`, `organization` not `org`, `response` not `res`, `description` not `desc`. The only single letters are `i`/`j` for a loop index and `t` for translation.
- Use the vocabulary the neighbouring code uses (`isLoading`, not a new `isBusy`). Code you move inherits no excuse for an odd name.
- Name by meaning, not by location: `heroImage`, not `backgroundImage`. One concept gets one name everywhere.
- A generic name promises a generic scope. Widen the shape to match the name, or narrow the name to match the shape.
- Do not coin words (`rail`) or use qualifiers a reader must guess at (`foreign`, `raw`, `real`). Use the word the UI and the team use.
- The current behaviour is unprefixed: `DecisionHeader` and `LegacyDecisionHeader`, never `NewDecisionHeader`.
- Destructure-local names (`rest`, `others`) do not survive past the spread. Rename: `const { config, ...savedFieldsWithoutConfig } = savedFields`.
- Domain names over generic ones: `ProposalReviewCard`, not `Item` or `Card`. Exception: `@op/sense` primitives.
- A file's name matches its primary export.
- Consistency over brevity: `maxVotesPerMember`, not `maxVotes`.

## Types

| Do not | Do |
|---|---|
| `as Foo` | A type guard, a refined input, or a Zod parse at the boundary |
| `any` | `unknown` and narrowing |
| `Record<string, unknown>` for a JSON column | A Zod schema for the column, narrowed once in the service layer |
| `x!` | `if (!x) throw ...`, or restructure so `x` is not optional |

- `as const` is a const assertion, not a type assertion. Keep it.
- Cast once, at the DB boundary, never at each consumer. Fix the source type (for example, a hook returns `RefCallback<T>`) so call sites need no cast.
- One type guard (`isRecord`) at the boundary beats one `as` per property hop. Do the same in tests.
- API types come from `@op/api/encoders`, never `RouterOutput['x']['y']`.
- Compare across a library boundary with explicit casts: `String(active.id) === String(over.id)`.
- Return a tagged union for success or failure: `{ ok: true } | { ok: false; errors }`, not `undefined` on success. Use `useClaimAccount` as the model.
- More than two outcomes: a string union (`'recovered' | 'record-gone'`), not a set of booleans.
- `prop?: T`, not `prop: T | undefined`, and no alias like `type Cap = number | undefined`.
- Use `== null` for optional numbers and versions, so a real `0` is not treated as missing.

## Function shape and control flow

- A multi-argument function takes all-named params: `assertProfileAccess({ user, profileId, permissions })`. Never mix positional and named. A single argument can stay positional.
- Type params precisely (`user: User`, not `user: { id: string }`).
- No nested ternaries. Use `if`/`else` into a named variable, sibling components, or a lookup map.
- Do not add flag params or flag props (`includeDrafts?`, `forAdmin?`) to fork behaviour. Compose at the call site.
- Domain strings that cross a boundary use an enum or a Zod literal union. Extract unclear numbers (`MILLISECONDS_PER_DAY`).
- A value the deployment can configure is config with a default, not a constant (`AUTH_EMAIL_OTP_LENGTH` in `packages/core/src/config.ts`). Find every copy of the old assumption, including UI copy.
- Derive lists from their source (locales, slugs, entity types). Do not retype them.
- No `if (x) foo();`. Always use braces.

## Composition and reuse

- First copy is fine. Second copy: extract, or comment on why not. Third copy: blocks the merge.
- Prefer `children` composition over slot props with branches.
- Grep before you write a helper. Look in `packages/common/src/services/<feature>/`, `services/api/src/encoders/`, `@op/common/client` (for example `isSafeRedirectPath`) and `apps/app/src/utils/`.
- Use the platform. Node 24: `Set.prototype.difference` / `intersection` / `union` / `isSubsetOf`.
- A workspace imports only packages its own `package.json` declares. Add the dependency and the lockfile change in the same PR.
- Delete code that your change made unused, and comments that describe a mechanism you removed.
- When you re-add something the repo deleted, start from the deleted commit.
- Keep complexity measurable. Run `pnpm test:coverage`, then `pnpm health --base origin/dev`. If a function you touched gets over the threshold, split it in the same PR.

## Errors

Common errors live in `packages/common/src/utils/error/index.ts`:

| Error | Status | When |
|---|---|---|
| `NotFoundError` | 404 | No resource for the id |
| `ValidationError` | 400 | Invalid input that Zod did not catch |
| `UnauthorizedError` | 403 | Authenticated but not permitted |
| `AccessTierError` | 401/403 | Below the procedure's tier (middleware) |
| `ConflictError` | 409 | State conflict: exists, locked |
| `ModerationError` | 422 | Rejected by moderation |
| `RateLimitError` | 429 | Rate limit |
| `NotImplementedError` | 501 | Not built yet |
| `CommonError` | 500 | Base class. Do not throw it directly |

- Services never throw a raw `Error`. Wrap library exceptions (for example `AccessControlException`) as Common errors.
- Routers do not `try`/`catch`. The tRPC formatter maps Common errors.
- Catch narrowly. Catch only the one expected error (for example `NotFoundError`) and re-throw all others. Never `.catch(() => null)`.
- A validation message names the field (never an array index). If the cause is a misconfiguration, it blames the configuration, not the user's input.
- Classify a transient error by its source, not by its code alone. A retry must drop any per-request cache that the failed attempt read.
- The retry unit matches the side-effect unit. Use one `step.run` per batch, or a counted, logged gap with a follow-up. Never re-send to recipients who already got the message.
- In a durable step, re-read a precondition for a side effect in the step that performs it. A provider result of `rejected` is a failure: throw. Do not only log it.

## Guards and inputs

- A guard covers every arm. Before you push, list them: both ends of a join, both graph directions, the set branch and the clear branch, both halves of a both-or-neither contract, every input that changes the output, the JS check and the DB constraint, a read and its write sibling, and the client's offer and the server's acceptance.
- Delete a branch that the guard above makes unreachable by construction.
- Do not add a guard for a failure nobody has seen in this repo. Name the failure you reproduced, or remove the guard.
- Fail closed. Unparseable or ambiguous input to a security decision is denied.
- Order destructive multi-step cleanup so that a partial failure leaves the safer residue.
- Fix the encoding, not the symptom. Make the representation unambiguous at the source. Reject an invalid value at the write, not with a render-side default.
- A `??` fallback cannot tell "cleared" from "not resolved". Return a tagged result.
- A uniqueness fallback loops (`while (used.has(name))`), because the generated name can collide too.
- Do not change the case of text that a person wrote.
- `{ ...a, ...b }` is shallow. Patch at the leaf, or merge nested objects explicitly.
- Normalize an identifier that crosses two systems once, at the parse boundary (for example the `+` on a phone number). Reject a missing external id. Do not default it to `''`.
- A persisted value is untrusted input to `Intl.*`, `new URL` and date parsers. Guard it in the shared helper and degrade to a displayable value.
- URL hosts: parse with `new URL(x)` and compare `hostname` exactly. Never `url.includes(host)`.
- Untrusted redirect paths go through `isSafeRedirectPath`. Check any extra structure (for example a locale segment) separately.

## Logging

Common's `CLAUDE.md` owns the basics: `@op/logging` on the server (`ctx.logger` in a tRPC procedure), `@op/logging/client` in the browser, and never `console.*`.

- Log a caught error as `logger.error('What failed', { error, proposalId })`. Pass the error object under the `error` key.
- Choose the level by severity: `error` for an unexpected state, `warn` for an expected or recoverable gap, `info` for normal flow. Do not convert `console.*` 1:1.
- Do not put personal identifiers in your own fields: email, phone, IP, token, request body. Log a stored id (`requestId`, `messageSid`) or a count instead. The logger redacts emails and phones in attributes, but that is a backstop, not permission.
- Import the logger singleton. Do not pass it through params.
- `console` is correct only outside the app runtime: `scripts/`, `services/db` migrate and seed entry points, test helpers.

## Comments

- The default is no comment. Write one only when the reason is not visible in the code and you cannot rewrite the code to show it. Examples: a why, an external constraint, a real footgun.
- One short line. No banners, no commented-out code, no history (`// was previously X`).
- A decision you made goes in the PR body, not a comment.
- A doc comment you keep documents the symbol and its params. It does not narrate your change.
- Do not import charged or neighbouring-domain terms into a general mechanism.
- Before you push, reread each comment. If the line below says the same thing, delete the comment.
- A migration that moves code is the time to fix carried-over debt (debug logs, lost guards), or to say in the PR that you kept it on purpose.
- Prose style: `technical-writing`.

## Review checklist

- [ ] Names use the prefix table, full words, the vocabulary of nearby code, and no `New` prefix
- [ ] No `as` (except `as const`), `any`, `!`, `Record<string, unknown>` or `RouterOutput`
- [ ] Multi-argument functions take all-named params. No nested ternaries, no flag params
- [ ] Services throw Common errors. Routers have no `try`/`catch`. No broad `.catch(() => null)`
- [ ] Every guard covers all its arms. Unreachable branches are deleted
- [ ] Security checks fail closed. Hosts are compared exactly. Redirects go through `isSafeRedirectPath`
- [ ] Persisted values are guarded before `Intl`/`URL`/date parsing. External ids are normalized at the parser
- [ ] `logger.error(msg, { error })` for caught errors. No `console.*` in runtime code. No PII in fields
- [ ] Retries match the side-effect unit. Durable steps re-read preconditions and treat `rejected` as failure
- [ ] No duplicated logic (third copy). No new helper that already exists. Undeclared imports are added to package.json
- [ ] Configurable numbers come from config. Lists are derived from their source
- [ ] Comments are rare, one line, and current. No change narration
- [ ] Dead code and stale comments from removed mechanisms are deleted
