---
name: technical-writing
description: Write documentation in ASD-STE100 Simplified Technical English — 20-word instructions, 25-word descriptions, one topic per paragraph, active voice with a named actor, simple tenses, one word per meaning, and no editorializing or filler ("It is important to note", "Crucially", "Keep in mind", "not just X, it is also Y"). A structured document (an ADR, a runbook, a design note) does not explain its own template — a field holds its value and not a discussion of the value, a section describing the format gets deleted, context belonging to the change goes in the PR body, and abstract framing is replaced by the specific decisions at stake. Use when you write or edit a README, doc page, ADR, runbook, release note, skill body, help text, error message, or code comment that a person reads. A code comment gets one extra rule — comments decay — so write one only when the reasoning is not obvious from the code, then keep it to one short line.
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

## Checklist

Check each item before you deliver the text:

1. Every sentence is under its word limit.
2. Every sentence names its actor and uses a simple tense.
3. Each paragraph covers one topic in 6 sentences or fewer.
4. One word carries each meaning across the whole document.
5. No banned phrase, intro, or outro remains.
