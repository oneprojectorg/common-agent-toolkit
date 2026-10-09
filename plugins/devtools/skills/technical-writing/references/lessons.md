# technical-writing: review lessons

- An ADR field holds only its value; who ratifies it and when goes in the PR body (PR #1864)
- Delete ADR sections that restate the template (PR #1864)
- Cut how the codebase migrates to the architecture; keep how the architecture is meant to be (PR #2074)
- Split an ADR's premise ("an entity is a profile") into its own backfilled ADR (PR #2074)
- Remove material the team has not decided, such as slug behaviour next to a phase decision (PR #2074)
- Add a clear "why" section; it is most of what an ADR should carry (PR #2074, #2075)
- A hand-numbered ADR collided with an existing reference to the same number; name it `draft-*` and let the merge job number it (PR #2145)
- An ADR named a script that does not exist (`check-missing-intl-keys.ts` vs `check-dictionaries.ts`); open every name before delivery (PR #2082)
- An ADR's migration plan listed steps already done and deletions that would break imports; delete plans the branch has outlived (PR #2082)
- An example scoped `t` to one namespace and read a key from another; check examples resolve (PR #2082)
- TSDoc on types, interfaces, enums and `@throws` was rejected as restating the code (PR #2075)
