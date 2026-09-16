/**
 * Template: two actors on the same page. One acts, the other must show the
 * result without reloading. Replace the placeholders in the flow below; keep
 * `signIn` and the shape.
 *
 * Copy this file into a directory where `@playwright/test` resolves (in a pnpm
 * monorepo, the e2e workspace), keep `signIn`, replace the steps. `recorder.mjs`
 * stays where it is — import it by path.
 *
 *   node example-flow.mjs --base http://localhost:3100 --out ./runs/today
 */
import { chromium } from '@playwright/test';

import { pointerClick, pointerType, recordFlow, waitForEnabledState } from './recorder.mjs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:54324';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]]);
    return pairs;
  }, []),
);

// --- login without touching the login screen --------------------------------

/**
 * Signs in over the email OTP the local stack sends to mailpit, then returns a
 * Playwright `storageState`. No login form is driven, so a slow or changing
 * sign-in screen cannot break the recording.
 */
async function signIn(email, base) {
  const sentAt = Date.now();
  const otp = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email, create_user: false }),
  });
  if (!otp.ok) throw new Error(`OTP request for ${email}: ${otp.status}`);

  let token = null;
  for (let attempt = 0; attempt < 30 && !token; attempt += 1) {
    const { messages = [] } = await fetch(`${MAILPIT}/api/v1/messages?limit=30`).then((r) => r.json());
    const match = messages.find(
      (message) =>
        message.To?.some((to) => to.Address?.toLowerCase() === email.toLowerCase()) &&
        new Date(message.Created).getTime() >= sentAt - 2000 &&
        /\b\d{6}\b/.test(message.Snippet ?? ''),
    );
    token = match?.Snippet?.match(/\b(\d{6})\b/)?.[1] ?? null;
    if (!token) await new Promise((done) => setTimeout(done, 1000));
  }
  if (!token) throw new Error(`No login code arrived in mailpit for ${email}`);

  const verify = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ type: 'email', email, token }),
  });
  if (!verify.ok) throw new Error(`OTP verify for ${email}: ${verify.status}`);
  const session = await verify.json();

  // The chunked base64 cookie `@supabase/ssr` reads, plus the same value in
  // localStorage for the browser client. Mirror your own e2e auth fixture here.
  const storageKey = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
  const value = JSON.stringify(session);
  const encoded = `base64-${Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
  const chunks = [];
  for (let i = 0; i < encoded.length; i += 3180) chunks.push(encoded.slice(i, i + 3180));

  return {
    cookies: chunks.map((chunk, index) => ({
      name: chunks.length === 1 ? storageKey : `${storageKey}.${index}`,
      value: chunk,
      domain: new URL(base).hostname,
      path: '/',
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    })),
    origins: [{ origin: new URL(base).origin, localStorage: [{ name: storageKey, value }] }],
  };
}

// --- the flow ---------------------------------------------------------------

const base = args.base ?? 'http://localhost:3100';
const URL_ACTOR = '<the page the acting user opens>';
const URL_OBSERVER = '<the page the watching user opens>';
const ACTION = '<the control the acting user clicks>';
const RESULT = '<the text that proves the change landed>';

const { failed } = await recordFlow({
  chromium,
  flow: 'a',
  base,
  outDir: args.out,
  actors: [
    { key: 'actor', storageState: await signIn('<acting user email>', base) },
    { key: 'observer', storageState: await signIn('<watching user email>', base) },
  ],
  run: async ({ actors, step, caption }) => {
    const actor = actors.actor;
    const observer = actors.observer;

    await step(actor, 'a-01-start-actor', 'A1 · Actor · the starting state', async () => {
      await actor.page.goto(URL_ACTOR, { waitUntil: 'domcontentloaded' });
      await actor.page.getByText('<something only the loaded page has>').first().waitFor({ timeout: 60_000 });
      // The caption is re-set after the navigation that follows a goto.
      await caption(actor.page, 'A1 · Actor · the starting state');
      await waitForEnabledState(
        actor.page.getByRole('button', { name: ACTION }).first(),
        false,
        ACTION,
      );
    });

    // The observer opens BEFORE the actor mutates. A page loaded afterwards
    // shows the new state either way, so it would prove nothing.
    await step(observer, 'a-02-watching-observer', 'A2 · Observer · watching, opened before the actor acts', async () => {
      await observer.page.goto(URL_OBSERVER, { waitUntil: 'domcontentloaded' });
      await observer.page.getByText('<something only the loaded page has>').first().waitFor({ timeout: 60_000 });
      await caption(observer.page, 'A2 · Observer · watching, opened before the actor acts');
    });

    await step(actor, 'a-03-acted-actor', 'A3 · Actor · acts', async () => {
      await pointerClick(actor.page.getByRole('button', { name: ACTION }).first());
      await actor.page.getByText(RESULT).first().waitFor({ timeout: 20_000 });
      // The control re-renders when the mutation settles, after the text above.
      await waitForEnabledState(
        actor.page.getByRole('button', { name: ACTION }).first(),
        true,
        ACTION,
      );
    });

    // No reload here: that is the whole claim.
    await step(observer, 'a-04-live-observer', 'A4 · Observer · arrives live, no reload', async () => {
      await observer.page.getByText(RESULT).first().waitFor({ timeout: 20_000 });
    });
  },
});

process.exit(failed.length > 0 ? 1 : 0);
