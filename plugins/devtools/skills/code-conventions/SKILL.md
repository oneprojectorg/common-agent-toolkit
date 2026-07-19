---
name: code-conventions
description: Cross-cutting code conventions reviewers consistently enforce on this codebase — composition over duplication (when a pattern appears twice, extract), naming (no acronyms, get/assert/is prefixes, no "New" for normal cases, consistency over brevity), scope discipline (one task per PR, follow-ups not bundles), type escape-hatch avoidance (no Record<string, unknown>, no `as`, no `!`, no `any`), casting at the DB boundary (single cast point, not at consumers), named params for multi-arg functions, prefer existing utilities (grep before writing), using Common error types (UnauthorizedError / ValidationError / NotFoundError) over raw Error or external library exceptions, structured logging (the @op/logging logger over console.*, level by severity, never log raw PII), file-name/export alignment, failing closed on ambiguous input, and validating untrusted redirect paths. Use whenever writing or refactoring code that will be reviewed — including adding logging or error handling — these patterns cut across api-endpoints, access-control, component-file-structure, and tests.
---

These are the recurring themes in `oneprojectorg/common` PR reviews. None are domain-specific to a single skill — they apply to every file the agent touches. Skip them at your peril; reviewers will catch them.

## Scope discipline — one task per PR

The PR has one job. The job is the Asana task. That's it.

- **Don't bundle adjacent fixes** into the diff. Recurring review: "Is this part of this PR?" — followed by either splitting the PR or moving the extra change to a follow-up.
- A bug fix doesn't ship a refactor; a refactor doesn't ship a feature. The rare exception is a **trivial** change that genuinely unblocks the work (e.g. a one-line docker-compose tweak) — note it in the PR description.
- When you see complexity that wants fixing but isn't your task ("this file needs a refactor"), file a follow-up Asana task or open a separate PR. Don't expand scope mid-flight.
- `/investigate` or `/autoplan` flagging adjacent issues? Open follow-ups; merge the focused fix. PR #1122 / #1208 / #1158 all closed with explicit "follow-up tracked" notes for the bigger refactor reviewers spotted.

## Composition over duplication

Single most common review-rejection theme.

- First copy: fine.
- Second copy: a flag. Comment explaining why duplication is the right call, or extract.
- Third copy: merge-blocker. Reviewers will ask to extract before approval.

The patterns reviewers cite most:

- Two list components with 80% overlap (`ManualSelectionList` / `ReviewSelectionList`) → one composable list fed by data.
- Two header components diverging by a flag → split by composition (pass `children`), not by adding the flag.
- Two procedures crammed in one file with branching → split into separate procedures.
- The same util inlined in three call sites → extract to `services/<feature>/utils.ts` or a domain-level helper.

When you compose with **`children` and slot props**, beware: arrays of slots (`headerSlot`, `footerSlot`, `actionsSlot`) with logic branches usually mean the composition should be inverted. Let the parent assemble the layout; the child just renders.

## Naming

### Function name signals intent

| Prefix | Means | Example |
|---|---|---|
| `get*` | Returns a value, pure-ish | `getProposalsForPhase`, `getReviewsGroupedByRecommendation` |
| `list*` | Returns a paginated / multi-result query | `listProposals`, `listAllProposals` |
| `create*` / `update*` / `delete*` | Mutation | `createProposal`, `updateOrganization` |
| `assert*` | Throws on failure, may return the loaded value | `assertProfileAccess`, `assertInstancePhase` |
| `is*` / `has*` / `can*` | Boolean | `isAdmin`, `hasPermission`, `canEdit` |
| `resolve*` | Computes / disambiguates a value | `resolveAccessUserIds`, `resolvePhaseWindow` |

A bare `proposalsForPhase()` is ambiguous — does it mutate? does it return? Reviewer feedback: "I tend to strongly prefer these phrased more as `getReviewsGroupedByRecommendation()`. It's a bit clearer and signals there definitely is a return value here."

### No acronyms or abbreviations

Write the word.

- `authorization`, not `authz` (PR #1257 review: "let's just use the few extra characters to make this shortening clear")
- `description`, not `desc`
- `organization`, not `org` (variable names — directory names like `org/` are fine)
- `AccessTier`, not just `Tier` (PR #1225 review: "Keeping it consistent means it's easier to grep generally")
- `response`, not `res` — even in tight loops
- The ONLY acceptable single-letter names are the universal conventions: `i` / `j` as a loop index and `t` as the translation function. Don't alias your own helpers to a single letter — no `h()` for a `createElement`-style shortcut. PR #1405 review: "we don't need to make this harder to read and reason about by calling it h() ... We always prefer longer names unless it is REALLY a common shortening (like `t()` or `i` in a loop)."

### Consistency over brevity

- `maxVotesPerMember` over `maxVotes` — leaves naming room for `maxVotesPerOrganization`, `maxVotesPerProposal` later.
- `addedByProfileUserId` over `addedById` — matches neighboring columns in the schema.
- Don't shorten a name just because it appears in two places — repeated long names are easier to search than synonyms.

### Name by meaning, not by location

Name a property for what it *is*, not for the one place it's currently rendered. A field displayed as a background today will appear in headers, cards, and previews tomorrow — a location-based name goes stale the moment a second use site lands. PR #1480 review on an image field named `backgroundImage`: "backgroundImage is an odd naming since it's not the background of the decision and will be displayed in many more places than a background. Maybe heroImage or headerImage is a better bet." Resolution: renamed to `heroImage` across schema / encoders / services / hooks.

Corollary: don't mix multiple terms for one concept. Juggling `Banner` vs `OverviewImage` vs `backgroundImage` for the same field is a smell — pick one semantic name for the backend property and use it everywhere.

### Keep the file name and its primary export aligned

A file's name should match its main export — name the file after the function or the function after the file, not two different things. PR #1580 review on `addRelationship.ts`: "We should either name the file after the function or name the function after the file." Mismatched names make a symbol hard to locate from its file and vice versa.

### Don't prefix the normal case

The current behavior is unprefixed. Only legacy gets the modifier.

- ✅ `DecisionHeader` and `LegacyDecisionHeader`
- ❌ `NewDecisionHeader` and `DecisionHeader`

PR #1145 review: "We should never call these 'New'. This is the normal case whereas Legacy is an old case."

### Don't keep destructure-local names in the outer scope

A name like `rest`, `others`, `props` is meaningful inside the spread that produced it — but the moment that variable is used three lines later, it's a black box. Recurring review (PR #1293): "usage of the variable name 'rest' is really local to this spread.. beyond this line it's not really descriptive. We should give them better variable names."

```ts
// ❌ `rest` reads as "the leftovers from this destructure" — useless 10 lines later.
const { config, ...rest } = savedFields;
persist(rest);

// ✅ Name it for what it actually is.
const { config, ...savedFieldsWithoutConfig } = savedFields;
persist(savedFieldsWithoutConfig);
```

Same rule for anonymous map callbacks (`(p) => …`) where the variable escapes the immediate scope.

### Domain-specific over generic

Names should carry domain meaning. `Item`, `Row`, `Card` (alone) are red flags in component / function names.

- ✅ `ProposalReviewCard`, `BallotEntryRow`, `CollectionItem`
- ❌ `Item`, `Card`, `Box`, `Container`

Exception: truly-generic primitives in `@op/ui` / `@op/sense` (`<Card>`, `<Button>`) — those are the leaves and earn the generic name.

## Type discipline

### No escape hatches

| Bad | Fix |
|---|---|
| `as Foo` | Type guard, refined input, or a Zod parse at the boundary |
| `any` | `unknown` + narrowing |
| `Record<string, unknown>` for JSON columns | Zod schema for the column, narrowed once at the service layer |
| `!` non-null assertion | Guard with `if (!x) throw …` or restructure so it's never optional |

Recurring review on JSON: "I feel like this `Record<string, unknown>` is really seeping into our code a lot and I don't think it's necessary that it's unknown. The JSON type in the database wasn't meant to be untyped as much as it is meant to simply not be typed at the database level."

- **Fix the *source* type, not each consumer.** When a hook returns a ref, type it as `RefCallback<T>` (or the exact `RefObject<T>`) so call sites put the ref straight on the element — delete the `as React.RefObject<HTMLDivElement>` casts rather than papering over ref typing at every use site. PR #1558 self-review: the hook now returns a properly typed `RefCallback<T>`, so every `as React.RefObject<HTMLDivElement>` cast at the call sites is deleted and the ref goes straight onto the element.

### Cast at the boundary, not at the consumer

Cast as **close to the DB query as possible** — a single cast point where untyped data enters the typed system. Then downstream code is strictly typed.

```ts
// ✅ Cast once in the service / schema layer
const instance = await getInstance(id); // returns Instance with typed instanceData

// ❌ Cast at every consumer
const rubric = (instance.instanceData as InstanceData).rubricTemplate;
```

When the inferred Drizzle type isn't precise enough, narrow it once with a Zod schema in `services/<feature>/schemas.ts` or with a typed wrapper on the table reference. Don't propagate the cast.

### API types from `@op/api/encoders`, never `RouterOutput`

Already covered in `api-endpoints` and `component-file-structure` skills. Re-stating because it's recurrent: `RouterOutput['x']['y']` couples callers to the router shape; encoder `z.infer` types are the source of truth.

## URL host checks — compare the exact host, never a substring

Never authorize or route an external request by checking whether a token appears *inside* a URL (`url.includes('openl-translate.p.rapidapi.com')`). Arbitrary hosts can sit before or after the token (`evil.com/?x=openl-translate.p.rapidapi.com`, `openl-translate.p.rapidapi.com.evil.com`), so the substring passes but the request goes somewhere unintended. CodeQL flags this as "Incomplete URL substring sanitization" and it will block the merge. Pin the host as a constant and compare it exactly — parse with `new URL(x)` and check `url.hostname === EXPECTED_HOST`. PR #1523 review (CodeQL): "'openl-translate.p.rapidapi.com' can be anywhere in the URL, and arbitrary hosts may come before or after it."

## Fix the encoding, not the symptom

When an input can be misinterpreted, make the representation unambiguous at the source rather than adding a guard that patches the bad case downstream. PR #1540 self-review: array elements were re-keyed `field[index]` instead of `field:index` so a numeric-string id can never be parsed as an array index — "make the encoding unambiguous instead of guarding the symptom." A guard leaves the ambiguity live for the next caller; an unambiguous encoding removes the failure class.

## Function parameter shape

- **All-named for multi-arg functions.** Mixing one positional + one named-object is the most common review-rejection on service signatures. PR #1245 review: "more about the parameter shape since it is mixing named params with ordered params. When that happens I switch to all named params."
  - ✅ `assertProfileAccess({ user, profileId, permissions })`
  - ❌ `assertProfileAccess(user, { profileId, permissions })`
- A single-arg function can stay positional (`getCurrentProfileId(authUserId)`).
- Be deliberate about which type goes into the param. `user: User` carries type safety; `user: { id: string }` will compile against any object with an `id`. PR #1245 review: "We probably want the User type here as well since we could inadvertently pass the wrong 'user' type here."

## Control flow — no nested ternaries

A single ternary for an obvious binary choice is fine. Stack two or more and reviewers will push back. PR #1332 review: "Not usually a fan of these nesting ternaries. we should try to avoid them generally."

Three approved rewrites in roughly increasing order of cost:

1. **Pull the choice into a named variable with `if` / `else`**, then return once. PR #1332 follow-up: "Picks the body via if/else into one variable, then a single guard + return."
2. **Split the branches into sibling components** when each branch carries non-trivial JSX or its own props. PR #1317: "small thing, can we split these three into components so we don't have a big 'ol if statement in the function. this way we can easily see the branching and can isolate each component's dependencies — even a good use-case for a `match()`!" Resolved with a thin dispatcher + one component per treatment (`CompletedPhaseCard` / `CurrentPhaseCard` / `AdvanceablePhaseCard` / `UpcomingPhaseCard`).
3. **Use `ts-pattern`'s `match()`** when the choice is a discriminated union — the type narrowing falls out for free.

Inverse principle: don't add a flag prop (`isAdmin?`, `variant?`) to a component just to fork its render. Compose at the call site.

## Derive lists from the source of truth, don't hardcode

When the same list already exists somewhere (locales, slugs, entity types, env names), import it — don't re-type it. PR #1387 review: "We should probably create this from our locale list instead rather than hardcoding." A duplicated list is a source of skew, not a documentation aid; the moment a locale is added the hardcoded copy is wrong.

If the source is exported from a different package and importing it would pull in a heavy graph, factor the list into a small standalone module that both can import. Don't keep the duplicate "just for now."

## Magic numbers and inline strings

- Extract numeric constants when the meaning isn't obvious. `86_400_000` → `MILLISECONDS_PER_DAY` (or reach for `date-fns`).
- Domain strings (`'yes'`, `'no'`, `'pending'`) that cross a boundary should be enum-backed or use a Zod literal union.
- Don't hardcode UI strings — see the `i18n-strings` skill.

## Errors — use Common error types

The `@op/common` package exports a Common error hierarchy in `packages/common/src/utils/error/index.ts`:

| Error | Status | When |
|---|---|---|
| `NotFoundError` | 404 | Resource not found by id |
| `ValidationError` | 400 | Invalid input that wasn't caught by Zod |
| `UnauthorizedError` | 403 | Caller authenticated but lacks permission |
| `AccessTierError` | 401 / 403 | Caller below the procedure's tier (thrown by middleware) |
| `ConflictError` | 409 | State conflict (already exists, locked, etc.) |
| `ModerationError` | 422 | Content rejected by moderation |
| `RateLimitError` | 429 | Rate limit exceeded |
| `CommonError` | 500 | Base class — don't throw directly |

- **Don't throw raw `Error`** from services — the router has no way to map it to a status code. PR #1017 fixed an inviteUser bug where the service threw `new Error(...)` and the router was string-matching to recover.
- **Rethrow external library exceptions** as Common errors. `access-zones` throws `AccessControlException`; the assertion wrappers in `services/assert` already rethrow it as `UnauthorizedError` — don't let the library type leak into your service signatures.
- **Don't catch-and-rethrow** in routers. The tRPC error formatter handles Common errors directly. A `try` / `catch` in a router is almost always wrong (PR #1017).

## Logging — structured logger, right level, no PII

Server-side logging goes through the structured `@op/logging` logger, never `console.*`. The recurring migration across PRs #1550, #1569, #1587, #1605 established four rules:

- **Use `@op/logging`, not `console.error` / `console.log`.** Structured records carry `traceId` / `spanId` (OTLP correlation), and the logger serializes `Error` values properly — `JSON.stringify(new Error(...))` is `"{}"`, so a raw `console.error(err)` loses the stack. PR #1550 migrated ~90 server error sites (tRPC `onError`, webhooks, redis/realtime, `@op/common` services, app API routes) off `console.error`.
- **Pick the level by severity — don't map `console.*` → `logger.*` 1:1.** `error` is for genuinely unexpected states only; an expected-but-recoverable absence (missing optional data, a best-effort snapshot) is `warn`; normal flow is `info`. PR #1587 review: a blanket 1:1 conversion logged recoverable states at `info` when a sibling logged the same case at `warn`. PR #1605: a collab-doc field that's absent for legacy proposals was logging `error` ~10×/day in PostHog — narrowed to the one genuinely unexpected case at `warn`.
- **Never log raw PII.** Don't emit email addresses (or similar) to logs. Log a count plus a `sha256`-prefixed hash so records stay correlatable without exposing the value (PR #1569 — batch-send and per-invite error logs).
- Applies in the service layer too — `@op/common` services log through the structured logger at appropriate levels, not `console.log` (PR #1569).

## Fail closed on ambiguous input; order destructive steps for the safer residue

- **A security decision on parsed/compared input fails closed.** When a gate hinges on parsing a value (a timestamp, a token expiry), treat unparseable or ambiguous input as denied rather than proceeding. PR #1507: "Unparseable timestamps fail closed."
- **Order multi-step destructive cleanup so a partial failure leaves the safer residue.** Delete the owning/primary record first, so a crash mid-cleanup strands a harmless orphaned dependent row rather than a live resource missing its owner. PR #1507: the auth user is deleted before its profile, so a partial failure leaves a dead unowned profile row, not a real account stranded without a profile.
- **Use `== null` for optional numeric/version fields** so a legitimate `0` (version 0, count 0) isn't treated as missing. PR #1605 (mirrors the cursor `!= null` rule in the `service-layer-structure` skill).

## Validate untrusted paths before building URLs from them

When a redirect target or path comes from user-controllable input, validate it before use — run it through `isSafeRedirectPath`, and separately check any structural assumption you're about to rely on (e.g. a leading `[locale]` segment) rather than trusting the shape. PR #1556: `const safeDest = dest && isSafeRedirectPath(dest) ? dest : '/'`, with a follow-up check that a safe path isn't necessarily locale-prefixed (`/info/tos`) before building the `/start` URL from its first segment.

## Reuse before writing

Before adding a helper, **grep for one**. Recurring review pattern across PRs: "I'm pretty sure we are already doing this for other server-side posthog events. We should re-use it." / "Found it."

Most "I need a function that …" requests already have an answer in the codebase:
- Format display name? `services/profile/utils`.
- Server-side feature flag? `apps/app/src/lib/getServerFeatureFlag.ts`.
- Locale-aware router? `@/lib/i18n` `useRouter`.
- Encoder for table X? `services/api/src/encoders/`.
- Schema for input Y? `packages/common/src/services/<feature>/schemas/`.

Use `Explore` or `Grep` for two minutes before writing 30 lines.

## Don't

- **Don't bundle scope.** One PR, one task.
- **Don't extract too early either.** A first occurrence is fine. Don't pre-compose for hypothetical second uses.
- **Don't add comments that just restate the code.** Comments answer "why" questions, not "what" — the code says what it does.
- **Don't leave `// TODO: this is temporary` without an Asana follow-up.** Follow-ups land in the task tracker, not in TODOs.
- **Don't pile flags onto a function.** When a function grows `includeDrafts?: boolean` plus `forAdmin?: boolean` plus `withReviews?: boolean`, compose call sites instead. PR #1084 review: "I like the composable approach more here because the choice is pretty specific to the use-case... not a big fan of the flags approach generally."
- **Don't leave code the refactor orphaned.** When a component or asset stops being used after your change, delete it — don't leave it in the tree. PR #1517 self-review: the FullScreenSplit* components and the SideImage asset were only used by the old layout, so they're deleted.
