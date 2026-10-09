# Local adapter (spec file or prompt)

Used when the input is a path to a spec file (`spec:<path>`, or any existing `.md`/`.txt` path) or free text.

## Fetch

- Spec file: read it. Title is the first heading; verification steps come from its acceptance / verification section.
- Prompt: the text is the task. If it gives no acceptance criteria, write 1–3 concrete ones into the plan and state them in the PR body.
- If the request is ambiguous enough that two reasonable readings lead to different diffs, ask the user before branching.

## Claim, transitions, comments

None. No external tracker is touched. Progress notes go in the final report; anything a reviewer must know goes in the PR body.

## Branch

`<type>/<slug>`: `type` is the conventional-commit type (`feat`, `fix`, `refactor`, `chore`, `docs`, `test`), `slug` is 2–5 kebab-case words from the title (`fix/proposal-vote-count`).

## Hand-off (PR open)

Report the PR URL to the user with a one-line summary and any open review findings.

## On failure

Stop and report to the user: what you tried, what failed, and what you need to continue. Leave the branch as is.
