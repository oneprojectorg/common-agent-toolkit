---
name: code-conventions
description: Cross-cutting code conventions reviewers consistently enforce on this codebase — composition over duplication (when a pattern appears twice, extract), naming (no acronyms, get/assert/is prefixes, no "New" for normal cases, consistency over brevity), scope discipline (one task per PR, follow-ups not bundles — disclosing the bundling in the PR body is not a substitute for unbundling, and naming the upstream cause when you patch a call site), type escape-hatch avoidance (no Record<string, unknown>, no `as`, no `!`, no `any`), one type guard at the boundary instead of an `as` per property hop, `as const` is a const assertion and NOT a type assertion (don't let a review bot talk you into removing it — rebut with load-bearing evidence and precedent counts), casting at the DB boundary (single cast point, not at consumers), named params for multi-arg functions, prefer existing utilities (grep before writing), using Common error types (UnauthorizedError / ValidationError / NotFoundError) over raw Error or external library exceptions, validation errors that name the field and blame the right party (never leak an array index as a field name, never reject the user's input for a misconfiguration only an admin can fix) and diagnostics that don't read domain meaning into generic constructs, narrow error catching (catch the one expected error and re-throw the rest, never a broad .catch(() => null)), tagged-union returns (an explicit ok-true / ok-false discriminant) over undefined-on-success, explicit String() casts when comparing across a library boundary, resolving or explicitly deferring debt a migration carries over (debug code, dropped guards) rather than porting it in silence, structured logging (the @op/logging logger over console.*, level by severity, never log raw PII), comment restraint (comments decay, so the default is none — write one only when the reasoning is not obvious and cannot be made obvious by rewriting the code, then keep it to one short line), file-name/export alignment, failing closed on ambiguous input, and validating untrusted redirect paths. Use whenever writing or refactoring code that will be reviewed — including adding logging or error handling — these patterns cut across api-endpoints, access-control, component-file-structure, and tests.
---

These are the recurring themes in `oneprojectorg/common` PR reviews. None are domain-specific to a single skill — they apply to every file the agent touches. Skip them at your peril; reviewers will catch them.

## Scope discipline — one task per PR

The PR has one job. The job is the Asana task. That's it.

- **Don't bundle adjacent fixes** into the diff. Recurring review: "Is this part of this PR?" — followed by either splitting the PR or moving the extra change to a follow-up.
- A bug fix doesn't ship a refactor; a refactor doesn't ship a feature. The rare exception is a **trivial** change that genuinely unblocks the work (e.g. a one-line docker-compose tweak) — note it in the PR description.
- When you see complexity that wants fixing but isn't your task ("this file needs a refactor"), file a follow-up Asana task or open a separate PR. Don't expand scope mid-flight.
- `/investigate` or `/autoplan` flagging adjacent issues? Open follow-ups; merge the focused fix. PR #1122 / #1208 / #1158 all closed with explicit "follow-up tracked" notes for the bigger refactor reviewers spotted.

### Disclosing the bundling is not a substitute for unbundling

The tempting move — "I'll flag it in the PR body rather than unbundle it" — does not clear the bar. PR #1750 (an export feature) carried a setState-in-render fix, a stale-template-cache fix, and a schema-validator diagnostic fix, all disclosed in the body as *"All four came out of debugging this feature. Flagging rather than unbundling."* The reviewer flagged each one anyway — *"This feels a bit unrelated to this PR … There are a few others like this in the PR that we should watch out for"* — and the outcome was three separate PRs (#1783, #1785, #1786). The disclosure bought nothing except a wider diff that no longer matched its title.

**This is the failure mode agents are most prone to**, and the reason is structural: an agent driving one task fixes whatever blocks it, because deferring means a new branch and another review cycle for something it has already diagnosed. Every bundled change in #1750 was hit *en route* to exercising the feature — you can't export proposals without first creating a decision, a proposal, and a rubric.

So when you fix something you tripped over rather than something you set out to fix:

- **Split it out as you go**, on its own branch off `dev`, while the change is small and independently revertible — which is exactly what makes extraction cheap and what makes leaving it in look lazy.
- The exception is genuinely trivial and genuinely load-bearing for the work: a one-line docker-compose tweak without which nothing runs. "It was broken and I knew how to fix it" is not that.
- If you truly can't unbundle, the PR body has to say which commit carries it and why extraction was rejected — not just that bundling happened.

### Fix the cause, or say plainly that you didn't

When the honest fix is upstream and you patch the call site instead, name the upstream cause in the code comment and file it. PR #1750 patched a `Template with ID '<uuid>' not found` failure by switching a cached `ensureData` to a revalidating `fetch`; the reviewer's instinct went straight past it — *"I wonder if it matters much since they won't change but we might get new ones. Or if the problem is further up where we query by name instead of id."* It was: the seed dedupes templates on **name** while regenerating the **id**, so a logically identical row gets a new id on every seed. The call-site fix is defensible (a data-layer identity change is out of scope for a feature PR); the silence about it would not have been.

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

Exception: truly-generic primitives in `@op/sense` (`<Card>`, `<Button>`) — those are the leaves and earn the generic name.

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
- **One type guard at the boundary beats an `as` per access.** Traversing an untyped structure (a React Query cache entry, a parsed JSON blob) tends to grow one assertion per property hop. Write a single narrowing predicate — `const isRecord = (value: unknown): value is Record<string, unknown> => …` — and bind the leaf behind a `typeof` check, so future shape changes stay compiler-checked. PR #1770 replaced four object assertions with one `isRecord`, leaving no `as` in the file besides `as const`. **Take the tests with it**: the same PR dropped seven `as ReturnType<typeof …>` casts and asserted the whole returned shape instead, which tightened three tests that had been silently ignoring a second row.

### `as const` is not a type assertion — don't "fix" it

`as Foo` suppresses a check; `as const` **narrows** a literal instead of widening it to `string`. They share a keyword and nothing else. Review bots conflate them — Greptile flagged `method: 'manual' as const` in an e2e fixture as a convention violation in #1788 and again in #1797 — but the rule targets suppression casts, and removing the const assertion would widen the literal until it no longer satisfies a `'date' | 'manual'` union.

The wider lesson is how that thread was closed, because it's the model for any convention flag you think is wrong:

- **Name the distinction** — const assertion vs suppression cast — rather than asserting "this one's fine."
- **Show it's load-bearing** — drop it and the type no longer checks.
- **Count the precedent** — `as const` appeared 32 times across `tests/e2e`, four of them already on `dev` in the same file, so changing 2 of 32 would make the suite *less* consistent.
- **Concede the good half separately.** The reviewer's underlying suggestion (annotate the fixture with the process-schema type so the literals are contextually typed) was a real improvement — acknowledged, and deferred to its own PR rather than folded into a feature branch.

Greptile accepted the correction outright. A bot finding is evidence, not a verdict; a documented rebuttal is a valid resolution and cheaper than a wrong change.

### Cast at the boundary, not at the consumer

Cast as **close to the DB query as possible** — a single cast point where untyped data enters the typed system. Then downstream code is strictly typed.

```ts
// ✅ Cast once in the service / schema layer
const instance = await getInstance(id); // returns Instance with typed instanceData

// ❌ Cast at every consumer
const rubric = (instance.instanceData as InstanceData).rubricTemplate;
```

When the inferred Drizzle type isn't precise enough, narrow it once with a Zod schema in `services/<feature>/schemas.ts` or with a typed wrapper on the table reference. Don't propagate the cast.

### Cast explicitly when comparing across a library boundary

When a third-party runtime type is wider than what you actually pass (dnd-kit ids typed `string | number`, for example), cast explicitly at the comparison point — `String(a) === String(b)` — rather than trusting the implicit runtime contract. A strict `===` between a stringified value and an untyped-but-numeric library value is always `false` when a number slips through, so an index lookup returns `-1` and downstream logic (`arrayMove`) silently corrupts data with no error. PR #1624 fixed a `findIndex` mismatch with `String(active.id) === String(over.id)`.

## Return a tagged union for success/failure, not undefined-on-success

A function or hook that can succeed or fail validation returns an explicit discriminated union — `{ ok: true } | { ok: false; errors }` — never `undefined` on success with error data on failure. An ambiguous return makes it trivial for a caller to invoke it without capturing the result and silently drop the errors (no feedback shown). The codebase already does this (`useClaimAccount`) — follow it. PR #1624: "`nextStep` returns undefined on success and fieldErrors on failure … An explicit shape like `{ ok: true } | { ok: false; errors }` (or throwing) makes this impossible to miss."

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

## Comments — only where necessary, then keep them short

Comments decay so only include them when it is necessary and not obvious from the code. The code around a comment keeps changing and the comment doesn't, so every comment is a claim that will potentially be false in the future while still reading as true — and a confidently wrong comment costs more than no comment. Code that needs a comment to be understood is usually code that should be renamed or split instead. Do that first; the comment stops being necessary in a lot of cases.

A comment earns its place in one case: **the reasoning is not obvious from the code and cannot be made obvious by writing the code differently.** That is a narrow set:

- **Why**, not what: the reason for a non-obvious choice, a workaround, or an ordering constraint — including the option that looks right and was rejected.
- A constraint that lives outside the file (an upstream bug, a provider quirk, a spec requirement).
- A warning about a real footgun at a call site.

Reasoning is the one thing that survives a refactor, which is why it's the one thing worth writing down. Anything describing *what the code does* is the part that decays first.

When you do write one, write the shortest form that carries the information:

- One line where one line works. No preamble, no restating the signature, no "This function ...".
- No decorative banners, section dividers, or commented-out code.
- No changelog narration (`// added in the refactor`, `// was previously X`) — that is what git history is for.
- Delete a comment the code has outgrown. A stale comment is worse than none.

Comments follow the `technical-writing` skill: active voice, simple tense, no filler.

| Do not write | Write |
|---|---|
| `// Loop over the users and send each an invite` | *(nothing — the code says this)* |
| `// This is a helper function that formats the display name for a profile` | *(nothing — the name says this)* |
| `// Sort the array` | `// Stripe returns events unordered; sort before replaying.` |
| `// We use setTimeout here because of a race condition that happens when the modal unmounts before the focus handler runs, so we defer it` | `// Defer focus: the modal unmounts before the handler runs.` |

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
- **A validation error names the field, and blames the right party.** Two defects that shipped together in the same message (PR #1786, extracted from #1750): submitting a proposal could fail with `0 is invalid` — the `0` was an array index leaking out, because the formatter took the last segment of AJV's `/category/0` path as the field name and fell through to the index when `properties["0"]` didn't exist. And the actual cause was a *configuration* fault: two categories sharing one label make the `oneOf` branch ambiguous, so every proposal choosing that option fails on every attempt until an admin removes the duplicate. Reporting it as an invalid *selection* sends the one person who cannot fix it back to re-pick a value that can never validate. Say which field, and when the fault is upstream of the user, say that instead of rejecting their input.
- **Don't read domain meaning into a generic construct.** The same formatter assumed `oneOf` / `const` / `uniqueItems` always describe configured selection options, so any custom form, rubric, or phase-settings schema using those keywords for ordinary data got told it had invalid or duplicate options — a confident diagnosis pointing at the wrong remediation. If a shared validator accepts arbitrary schemas, key your diagnostics on something that identifies *your* construct, and fall back to a generic message otherwise.
- **Never a broad catch-all (`.catch(() => null)`) around a call that can throw for more than one reason.** When only one error is expected and recoverable (e.g. a `NotFoundError` from an assert helper when the row is legitimately absent), catch *that* narrowly and re-throw everything else. A catch-all also swallows transient failures (a DB hiccup) and lets the code fall through to wrong behavior with no error surfaced. PR #1633: `assertUserByAuthId(...).catch(() => null)` absorbed both the absent-row case *and* transient DB errors, so a short-lived hiccup silently skipped an access-filtering exclusion and returned an unfiltered list including proposals the caller must not see. Re-throw anything that isn't the expected `NotFoundError`.

## A migration is the moment to resolve carried-over debt, not to launder it

Porting a component or module verbatim carries its problems into the new file, where they now read as *your* decision — and reviewers will read them that way. When a migration diff picks up exploratory debug code (a stray `console.log('submit')`, an unawaited `refetch()` under `// TODO: trying this out to see if it helps`), a lost conditional guard, or a dropped state (an "Advancing" label that no longer appears), that's the moment to fix it. PRs #1661, #1685, #1711 each shipped one of these.

The judgment call is scope, and both answers are defensible — say which one you picked and why:

- **Fix it** when the resolution is contained and obvious: debug logging, a missing `orgProfiles?.length &&` guard on a divider, a label that stopped tracking its state.
- **Port it unchanged and file a follow-up** when removing it needs context you don't have. PR #1661: "Ported unchanged from the old SiteHeader — out of scope for this swap. Leaving as-is: removing it blind risks the profile-switch behavior the TODO was chasing; better as a separate cleanup with the original author's context." The reviewer accepted that immediately — "porting it unchanged is the safer call."

What isn't defensible is silence. An unremarked `// TODO: something is happening when switching so trying this out` in a new file reads as freshly written.

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
- **Don't add comments that just restate the code.** See *Comments* above — comment only where the code cannot carry the information, and keep it to one short line.
- **Don't leave `// TODO: this is temporary` without an Asana follow-up.** Follow-ups land in the task tracker, not in TODOs.
- **Don't pile flags onto a function.** When a function grows `includeDrafts?: boolean` plus `forAdmin?: boolean` plus `withReviews?: boolean`, compose call sites instead. PR #1084 review: "I like the composable approach more here because the choice is pretty specific to the use-case... not a big fan of the flags approach generally."
- **Don't leave code the refactor orphaned.** When a component or asset stops being used after your change, delete it — don't leave it in the tree. PR #1517 self-review: the FullScreenSplit* components and the SideImage asset were only used by the old layout, so they're deleted.
