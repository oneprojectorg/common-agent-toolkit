---
name: technical-writing
description: Write documentation in ASD-STE100 Simplified Technical English — 20-word instructions, 25-word descriptions, one topic per paragraph, active voice with a named actor, simple tenses, one word per meaning, and no editorializing or filler ("It is important to note", "Crucially", "Keep in mind", "not just X, it is also Y"). A structured document (an ADR, a runbook, a design note) does not explain its own template — a field holds its value and not a discussion of the value, a section describing the format gets deleted, context belonging to the change goes in the PR body, and abstract framing is replaced by the specific decisions at stake. An ADR records the target architecture and the reason for it, never the migration route, never a premise that deserves its own backfilled ADR, and never a question the team has not actually decided. ADR numbers are claimed on merge by scripts/number-adrs.sh from a `draft-*.md` file — never hand-pick or reuse one — and an Accepted ADR must not derive its rule from a Proposed one. Check a document against the code it names before delivering it: run the script it cites, read the exports it proposes deleting, confirm the example resolves, and delete a migration plan the branch has already executed. TSDoc documents the contract, not the shape the language already states — skip types, interfaces, enums, Drizzle-derived Zod schemas, `@throws` and the return type; keep `@deprecated` and a worked `@example`. Use when you write or edit a README, doc page, ADR, runbook, release note, skill body, help text, error message, or code comment that a person reads. A code comment gets one extra rule — comments decay — so write one only when the reasoning is not obvious from the code, then keep it to one short line.
---

Simplified Technical English (STE) keeps a document unambiguous. It helps a reader who skims, who translates the text, or who reads English as a second language. Apply these rules to any prose a person reads, and to your own answer when the user asks for documentation.

## Sentence and paragraph limits

- Write 20 words or fewer in an instruction or a procedure step.
- Write 25 words or fewer in a description or an explanation.
- Write one topic in each paragraph.
- Write 6 sentences or fewer in each paragraph.

Split a long sentence at its conjunction. Two short sentences beat one compound sentence.

## Voice and tense

- Use the active voice. Name the actor: "The endpoint returns a 401", not "A 401 is returned".
- Use simple tenses only: simple present, simple past, simple future, imperative.
- Start each instruction with its verb: "Run `pnpm typecheck`."
- Write one action in each step. Put a second action in a second step.

## Word choice

- Use one word for one meaning. Do not alternate between "delete", "remove", and "drop" for the same action.
- Use the same word for the same thing in every paragraph. A synonym makes the reader look for a difference.
- Write three nouns in a row at most. "user profile access check failure" becomes "a failed access check on the user profile".
- Keep the articles. Do not write telegraphic text.
- Write a list when you name more than two items or steps.
- Expand an abbreviation at its first use. Then use the abbreviation everywhere else.

## Anti-fluff rules

State the fact and stop. Do not tell the reader how to feel about the fact.

- Start with the answer. Write no intro and no outro.
- Do not build up to a point. Put the point in the first sentence.
- Never write these phrases: "It is important to note", "Crucially", "Keep in mind", "It is not just X, it is also Y", "Sure, I can help with that", "Hope this helps!".
- Cut these words: "powerful", "seamless", "robust", "comprehensive", "simply", "just".

## Before and after

| Do not write | Write |
|---|---|
| It is important to note that the migration will be applied by CI. | CI applies the migration. |
| A validation error will have been returned by the endpoint if the id is empty. | The endpoint returns a validation error when the id is empty. |
| This is not just a rename, it also changes the auth posture of every endpoint. | The change renames the procedure. It also changes the auth posture of every endpoint. |
| Simply run the dev server and you should be good to go! | Run `pnpm dev`. The app starts on http://localhost:3100. |

## Scope

Apply this skill to a README, a doc page, a runbook, a release note, a skill body, help text, an error message, a code comment, and an Asana task comment.

A code comment has one extra rule before the prose rules: comments decay, so write one only when the reasoning is not obvious from the code and cannot be made obvious by rewriting it. Then write one short line. The `code-conventions` skill owns that decision.

Other skills own their own formats. Follow them first:

- `pr-description` owns the PR body.
- `branch-and-pr` owns the commit message and the PR title.
- `i18n-strings` owns product copy in `apps/app`. Write the string in STE, then wrap it in `t()`.

STE governs the prose, not the structure. Keep the code samples, tables, and mermaid diagrams that a document needs.

## A document that follows a template does not explain the template

A structured document — an ADR, a runbook, a design note — carries a fixed set of sections, and the reader knows the format. Restating it inside the document is the failure this skill exists to prevent, at the section level rather than the sentence level. It is also the failure an agent produces most reliably, because a template invites filling every field with prose.

PR #1864 introduced ADR scaffolding under `docs/adr/` and drew five line-level review comments on one file. Three were the same instruction — *"Remove this section"* — one was *"This is too much context, likely from Opus. This should only have the 'Proposed' value"*, and one was *"This context is not helpful and should be reworded."* The corrections that closed them:

- **A field holds its value, not a discussion of the value.** A Status of `Proposed` is `Proposed`. Who ratifies it, and when, is not part of the field — that went into the PR description.
- **Delete a section that describes the format.** The template already shows its five sections; a document that lists them again has said nothing.
- **Name the specific things, not the general problem.** The abstract framing ("we need a way to record decisions") was rewritten to name the decisions actually at stake: the ORM query API, the authorization model, the design-system boundary.
- **Context that belongs to the change, not the artefact, goes in the PR body.** The relationship between the new ADRs and the existing constitution was interesting and it was not part of ADR 0001.

Before you deliver a structured document, read each section and ask what a reader loses if you delete it. Delete the ones with no answer.

### An ADR records the architecture, not the route to it

The second ADR review pass (#2074, #2075) drew the same correction from a different angle: the documents were accurate and still mostly needed deleting, because they described *the migration* rather than *the decision*. Four rules came out of it, and they apply to any architecture document here.

- **Cut the in-flight work.** How the codebase gets from the current shape to the decided one is a process detail with a shelf life of weeks; the ADR outlives it. #2074: *"I think we should remove anything related to HOW we migrate towards this architecture and keep it scoped to how the architecture is meant to be."*
- **One decision per ADR — split the premise out and backfill it.** ADR 0005 opened by establishing that an entity in this codebase is a profile, then decided that phases are entities. The reviewer wanted two documents: *"This should just be a separate ADR that we should backfill describing that 'in this codebase an entity is a profile'."* A premise worth stating is worth its own number.
- **Don't record what the team hasn't decided.** A paragraph on slug behaviour went in because it was adjacent, and came out because no decision stood behind it: *"Let's just remove this about slugs.. I'm not sure we've decided anything on that."* Undecided material in a decision record reads as settled to the next person who greps it.
- **The why is the content.** The same review that cut three sections asked for one to be *added*: *"I wonder if we can articulate why we would need them and where … Let's add a big ol' 'why' to this ADR?"* Most of the length an ADR should carry is the reason, not the rule.

The compression target is real. One eight-paragraph Context section was answered with two sentences the reviewer wrote out in the comment: phases are baked into `instance_data` today, and we want them as separate entities so they gain what profile entities have. If your Context can be said that briefly, say it that briefly.

### ADR numbers are claimed on merge, and an Accepted ADR can't rest on a Proposed one

A new ADR lands as `docs/adr/draft-<slug>.md`; `scripts/number-adrs.sh` assigns the number when it merges, so two branches in flight can't both claim 0005. PR #2145 wrote `0005-declare-budget-units-on-the-template.md` by hand while `CLAUDE.md` and `AGENTS.md` already pointed "ADR 0005" at the i18n-key decision — two documents under one identifier, and every existing reference silently repointed. Name the file `draft-*` and let the merge job number it; never reuse or hand-pick a number.

**And check the status of anything your decision depends on.** `Proposed` means not in force, so an `Accepted` ADR that derives a rule from a `Proposed` one has a contract that can change underneath it. Either promote the dependency or mark your own as Proposed too.

### A document is reviewed against the code, not against itself

The #2082 review pass found nothing wrong with the ADR's prose. Every finding was the document disagreeing with the repository it described, and each one would have sent an implementer somewhere real:

- **A named artefact that does not exist.** The ADR said a test replaces `check-missing-intl-keys.ts`; the script in the tree is `check-dictionaries.ts`, and it catches a different thing (translations left unchanged after an English edit) than the test does (key parity). Naming the wrong file is how a live check gets deleted as redundant.
- **A migration plan describing work already done.** The steps said to namespace the dictionaries, prohibit dotted keys and delete `messageKeys.ts` — all already true — and then to delete `translate.ts` and `server.ts`, which still export types and `getTranslations` that the app imports. A plan written before the branch landed is a plan to break the build.
- **A rule its own example contradicts.** "At most one level deep" sat next to `decisions.comments.off` and an existing `decisions.processBuilder` hierarchy, so the reader cannot tell whether the limit is on namespaces or on message ids.
- **An example that borrows from the wrong scope.** The snippet scoped `t` to one namespace and then looked up a key belonging to another, so copying it produces a missing-message at runtime.

Before you deliver a document that names code, open each name: run the script, read the exports, check the example resolves. A document that records a decision is held to the same standard as a comment — it is a claim, and a wrong claim costs more than a missing one. When the plan section has outlived the branch, delete it rather than updating it; the ADR is about the architecture, not the route (above).

### TSDoc: document the contract, not the shape the language already states

The TSDoc ADR (#2075) was closed rather than merged, and the review that closed it is the usable guidance:

- **Types, interfaces and enums are their own documentation.** *"These will rarely need documentation since types, interfaces, and enums are essentially documentation of something already. The var name should be clear. If it needs documentation at this level I think it's poorly named."* Same for a Zod schema derived from a Drizzle type — it is visibly a representation of the table.
- **Don't write `@throws`, and don't restate the return type.** Both are inferable from the code; a tag that repeats the signature is maintenance with no reader.
- **`@deprecated` and `@example` earn their place.** `@deprecated` tells a caller something the type cannot. Examples pay off on anything public-facing or intricate — and the ADR was asked to say *why* and *where*, not just to allow them.
- **A convention document needs its own why.** *"Let's add a big ol' 'why' to this ADR"* — a rule with no stated reason gets applied by rote and argued about forever.

## Checklist

Check each item before you deliver the text:

1. Every sentence is under its word limit.
2. Every sentence names its actor and uses a simple tense.
3. Each paragraph covers one topic in 6 sentences or fewer.
4. One word carries each meaning across the whole document.
5. No banned phrase, intro, or outro remains.
