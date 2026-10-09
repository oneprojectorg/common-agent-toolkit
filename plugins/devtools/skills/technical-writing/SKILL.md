---
name: technical-writing
description: "Simplified Technical English for READMEs, ADRs (docs/adr), runbooks, TSDoc, comments, error messages, commit messages, PR and Asana comments. Use when writing or editing docs or an ADR, or when asked to make text clearer or shorter."
---

Apply these rules to any prose a person reads. Other skills own their formats; follow them first: `pr-description` (PR body), `branch-and-pr` (commit message, PR title), `i18n-strings` (product copy), `code-conventions` (whether to write a comment at all). STE governs prose, not structure: keep the code samples, tables and diagrams a document needs.

## Sentences and paragraphs

- 20 words or fewer in an instruction; 25 or fewer in a description.
- One topic per paragraph, 6 sentences or fewer.
- Split a long sentence at its conjunction.

## Voice and tense

- Active voice with a named actor: "The endpoint returns a 401", not "A 401 is returned".
- Simple tenses only: present, past, future, imperative.
- Start each instruction with its verb. One action per step.

## Words

- One word per meaning, the same word every time. A synonym makes the reader look for a difference.
- Three nouns in a row at most.
- Keep the articles; no telegraphic text.
- Use a list for more than two items.
- Expand an abbreviation at first use.

## No filler

- Start with the answer. No intro, no outro, no build-up.
- Never write: "It is important to note", "Crucially", "Keep in mind", "It is not just X, it is also Y", "Hope this helps".
- Cut: "powerful", "seamless", "robust", "comprehensive", "simply", "just".

| Do not write | Write |
|---|---|
| It is important to note that the migration will be applied by CI. | CI applies the migration. |
| A validation error will have been returned by the endpoint if the id is empty. | The endpoint returns a validation error when the id is empty. |

## Structured documents (ADRs, runbooks, design notes)

`docs/adr/README.md` owns the ADR format, status values and numbering. Follow it. On top of it:

- A field holds its value, not a discussion of it. Status `Proposed` is just `Proposed`.
- Do not describe the template inside the document. Delete any section that only restates the format.
- Name the specific decisions at stake, not the general problem.
- Context about the change, not the decision, goes in the PR body.
- An ADR records the target architecture and why. Cut the migration route and in-flight work.
- One decision per ADR. A premise worth stating gets its own ADR.
- Record only what the team decided. Most of the length is the why.
- An `Accepted` ADR must not derive a rule from a `Proposed` one.
- Before delivering a document that names code, open each name: run the script, read the exports, check the example resolves. Delete a plan section the branch already carried out.

## TSDoc

- Document the contract, not what the types already say. Skip types, interfaces, enums and Drizzle-derived Zod schemas.
- No `@throws`; do not restate the return type.
- Keep `@deprecated` and a worked `@example` on public or intricate APIs.

Past review incidents: [references/lessons.md](references/lessons.md).

## Review checklist

- [ ] Every sentence is within its word limit, active, simple tense, with a named actor
- [ ] Each paragraph has one topic and 6 sentences or fewer
- [ ] One word per meaning across the document
- [ ] No banned phrase, intro or outro
- [ ] Structured docs: no template explanation, no migration route, nothing undecided
- [ ] New ADR is a `draft-*.md` per `docs/adr/README.md`; no hand-picked number
- [ ] Every script, file, export and example the document names exists and resolves
- [ ] TSDoc has no type restatement or `@throws`
