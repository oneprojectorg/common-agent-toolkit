---
name: record-ui-flow
description: Record a user flow through the app as video with Playwright — work out from the diff what the change actually does, drive it with one window per actor, caption every step, render side-by-side and story cuts plus a preview gif, and attach them to the PR. Use when someone asks for a recording, video, screen capture or demo of a change or flow, or wants to show reviewers that a multi-user or realtime behaviour works without driving it by hand.
---

# Record a UI flow

## 1. Decide what to record

Read the change first — the flow comes from the diff, never from a guess.

```sh
gh pr diff <number> --name-only      # or: git diff --name-only <base>...HEAD
gh pr view <number> --json title,body
```

Write the flow as one line before you touch Playwright: **who does what, and what has to be on screen afterwards.** A change only two users can show (realtime, permissions, hand-offs, notifications) needs two actors; most changes need one.

**Ask the user, once, with options, when:**

- the diff touches no UI, or only code with no visible surface
- more than one unrelated flow changed — list them and ask which to record
- you cannot tell which role or actor sees the change
- the flow needs a route, slug, account or seed you cannot derive from the repo

Do not record a guess, and do not record five flows because you could not choose.

## 2. Prepare

1. **Verify the app is up. Never start, stop or restart a server you do not own** — ask instead, and say what you found.
2. **Seed your own data.** A flow that mutates state cannot be re-run against the same seed; re-seed before every take.
3. **Clear any cache the seed wrote behind** (Redis, in-process), or a stale policy or onboarding modal covers every frame.
4. **Log every actor in before recording, through the API, not the login screen.** `signIn` in `scripts/example-flow.mjs` returns a Playwright `storageState`.

## 3. Write the flow

Copy `scripts/example-flow.mjs` into a directory where `@playwright/test` resolves (in a pnpm monorepo, the e2e workspace), keep `signIn`, replace the steps. Import `scripts/recorder.mjs` by path; it needs no install.

The rules that make a recording worth watching:

- **Open every actor's context up front and close them together.** That is what puts the videos on one clock and makes the side-by-side line up.
- **The observer's page opens before the actor mutates**, and **never reloads**. A page loaded afterwards shows the new state either way, so it proves nothing. If you must reload, say so in the caption.
- **Caption every step** — `A3 · Reviewer A · Request sent`. The harness re-injects it after navigations.
- **Click with `pointerClick`, type with `pointerType`.** Playwright's video never paints the real cursor, so the harness draws one in the page: a dot that travels to the target and ripples red on the click. `locator.click()` teleports and reads as nothing happening; `locator.fill()` pastes a value with no pointer at all. `pointerClick` drives the mouse directly and so skips Playwright's actionability checks — if a step behaves as if nothing was clicked, use `locator.click()` for that one step.
- **Assert, then hold.** `slowMo: 350` plus the 1.8 s hold after each assertion is what makes the video readable.
- **Poll a control's enabled state, never read it once.** A control re-renders when its mutation settles, a moment after the alert you just asserted on. Use `waitForEnabledState`. A single read reports a bug that is not there.
- **Let a failing step fail.** The harness screenshots it, records it and carries on. Never reload or re-seed to make a step green — report it.

## 4. Run

```sh
node your-flow.mjs --base http://localhost:3100 --out "$PWD/recordings/$(date +%F)-<flow>"
```

Needs `ffmpeg` and `ffprobe` on PATH. Delete the copied flow file afterwards and leave `git status` as you found it.

Output, for a flow named `a`:

- `a-<actor>.mp4` — one per actor
- `a-side-by-side.mp4` — the actors on one clock, so the observer's update is visible while the other acts (two actors only)
- `a-story.mp4` — chronological cut following whoever is acting
- `a-preview.gif` — 960 px, under 15 MB
- `a-0N-<what>.png` per step, plus `a-results.json` with pass/fail

## 5. Attach to the PR

A reviewer will not open a local path. When the change has a PR:

```sh
gh pr comment <number> \
  --body "Flow: <the one-line flow>. Steps 1-N pass; <any failure>." \
  --attach "$OUT/a-story.mp4#chronological cut" \
  --attach "$OUT/a-side-by-side.mp4#both actors, one clock"
```

Use `gh pr edit <number> --attach …` instead when the artifacts belong in the PR body. Both are writes to a shared PR: ask first unless the user asked for the attachment.

## Done when

The one-line flow matches what the diff changed, every step is PASS or reported as FAIL with its screenshot, the cuts exist with non-zero duration, the gif is under 15 MB, and you have said in one line per step what the recording shows.
