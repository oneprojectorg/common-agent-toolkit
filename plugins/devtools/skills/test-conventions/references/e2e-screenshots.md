# E2E specs with screenshots

Agents cannot run `pnpm build:e2e`. Run the spec against `pnpm dev:e2e` instead: the branch in dev mode, against the E2E Supabase, on app :4100 and API :4300. This never touches the shared :3100 server. The same run takes the screenshots for the PR body. Method from common PR #2314.

## 1. Prerequisites

- E2E Supabase is up on 563xx: `pnpm w:e2e supabase:setup` (or `supabase:start` if it is already set up).
- Nothing listens on :4100 or :4300: `lsof -nP -iTCP:4100 -iTCP:4300 -sTCP:LISTEN`.

## 2. Start the branch with `dev:e2e`

`dev:e2e` sets the E2E Supabase URL and database, but the app also needs the values in `.env.docker`. Do not `source` that file: `SSR_SECRETS_KEY` is JSON and the shell breaks it. Save this launcher outside the repo (for example `../run-dev-e2e.mjs`) and run it from the repo root:

```js
// Starts `pnpm dev:e2e` (app :4100, API :4300) against the E2E Supabase.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const dotenv = createRequire(join(process.cwd(), 'tests/e2e/package.json'))('dotenv');
const env = { ...process.env, ...dotenv.parse(readFileSync('.env.docker')) };
delete env.PORT_PREFIX; // dev:e2e pins its own ports
delete env.NEXT_PUBLIC_POSTHOG_KEY; // no consent banner, as in the E2E build

// The E2E Supabase keys live in the Playwright env shim.
const shim = readFileSync('tests/e2e/playwright.config.ts', 'utf8');
const readKey = (name) => shim.match(new RegExp(`${name}:\\s*'([^']+)'`))?.[1];
const anonKey = readKey('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const serviceRole = readKey('SUPABASE_SERVICE_ROLE');
if (!anonKey || !serviceRole) {
  throw new Error('E2E Supabase keys not found in tests/e2e/playwright.config.ts');
}
Object.assign(env, {
  NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
  SUPABASE_SERVICE_ROLE: serviceRole,
  SUPABASE_SERVICE_ROLE_KEY: serviceRole,
});
const child = spawn('pnpm', ['dev:e2e'], { env, stdio: 'inherit', detached: true });
console.log(`dev:e2e process group ${child.pid}`);
```

```bash
nohup node ../run-dev-e2e.mjs > ../dev-e2e.log 2>&1 &
sleep 3; PG=$(grep -o "process group [0-9]*" ../dev-e2e.log | awk '{print $3}')
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4100/en)
  [ "$code" = "307" ] || [ "$code" = "200" ] && break; sleep 5
done
```

`detached: true` puts every child in one process group. Stop it with `kill -- -$PG` and nothing else. Never kill by name: other agents' servers and the multica daemon run on the same machine.

A `RESEND_PASSWORD` error in the log is email sending. It does not block a UI flow.

## 3. Capture in the spec

Take a screenshot at each step of the basic flow: the start state, the main interaction, the result, and the edge the change adds (for example "the form does not show again").

```ts
await expect(dialog.getByRole('textbox', { name: 'Reason' })).toBeVisible();
await page.screenshot({
  path: test.info().outputPath('02-form-open.png'),
  animations: 'disabled',
});
```

- Wait for settled content first: a heading, a field, a toast. A screenshot after `goto` alone shows a skeleton.
- `animations: 'disabled'` stops a dialog from being caught mid-fade.
- Number the files in step order (`01-…png`, `02-…png`).
- `localStorage` is not available on the first `about:blank` page. Clear the persisted query cache only after the first `goto`.
- The red "Issues" badge in the corner is the Next.js development overlay. Say so in the caption.

## 4. Run the spec, then stop the servers

```bash
rm -rf tests/e2e/test-results
pnpm w:e2e exec playwright test tests/<spec>.spec.ts --project=e2e --reporter=list
mkdir -p ../screenshots && cp tests/e2e/test-results/*/*.png ../screenshots/
kill -- -$PG
rm -rf tests/e2e/test-results tests/e2e/playwright-report
```

Open each PNG and check that it shows the step its name says.

## 5. Put the screenshots in the PR body

GitHub has no API for PR image uploads. Push the images to a separate `pr-<n>-screenshots` branch, so they stay out of the PR diff. A temporary index builds the commit without touching the working tree or the PR branch:

```bash
PR=<n>
export GIT_INDEX_FILE="$(git rev-parse --git-dir)/screenshots.index"
git read-tree HEAD
for f in ../screenshots/*.png; do
  git update-index --add --cacheinfo "100644,$(git hash-object -w "$f"),pr-$PR-shots/$(basename "$f")"
done
COMMIT=$(printf 'docs: add screenshots for PR %s\n\nCo-Authored-By: <task owner>\n' "$PR" | git commit-tree "$(git write-tree)" -p HEAD)
rm -f "$GIT_INDEX_FILE"; unset GIT_INDEX_FILE
git push origin "${COMMIT}:refs/heads/pr-$PR-screenshots"
```

Write `${COMMIT}` with braces. In zsh, `$COMMIT:r` is a path modifier and breaks the refspec.

Link each image as `https://github.com/<owner>/<repo>/raw/pr-<n>-screenshots/pr-<n>-shots/<file>.png` under `## Screenshots`, with a one-line caption per step. Check each URL with `curl -sL -o /dev/null -w "%{http_code} %{content_type}\n" <url>` (expect `200 image/png`). The branch can be deleted after merge.

Write the body to a file and run `gh pr edit <n> --body-file <file>` as its own command. The protected-branch hook blocks a `gh` command whose text names `dev` or `main`, and caption text counts.
