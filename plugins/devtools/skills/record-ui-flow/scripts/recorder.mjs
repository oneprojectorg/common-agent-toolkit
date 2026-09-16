/**
 * Records a multi-actor UI flow as video: one browser context per actor, a
 * caption pill on every step, and four cuts rendered with ffmpeg.
 *
 * Import it from a file that knows your app — this module knows nothing about
 * your auth, routes or selectors, and deliberately does not import Playwright:
 * the caller passes `chromium` in, so this file can live outside the workspace
 * that has Playwright installed. See example-flow.mjs.
 */
import { execFile } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE ?? 'ffprobe';

const DEFAULTS = {
  viewport: { width: 1440, height: 900 },
  slowMo: 350,
  hold: 1800,
  gifWidth: 960,
  gifMaxBytes: 15e6,
};

const log = (message) => process.stdout.write(`${message}\n`);

// --- the caption pill -------------------------------------------------------

/**
 * Installed on every navigation. The text lives in sessionStorage so a caption
 * set before a `goto` still reads after it.
 */
const CAPTION_INIT = () => {
  const KEY = '__recCaption';
  const render = (text) => {
    let pill = document.getElementById('__rec-caption');
    if (!pill) {
      pill = document.createElement('div');
      pill.id = '__rec-caption';
      pill.style.cssText = [
        'position:fixed',
        'top:16px',
        'left:50%',
        'transform:translateX(-50%)',
        'z-index:99999',
        'padding:8px 16px',
        'border-radius:999px',
        'background:#111',
        'color:#fff',
        'font:600 15px system-ui, sans-serif',
        'box-shadow:0 2px 12px rgba(0,0,0,.35)',
        'pointer-events:none',
        'white-space:nowrap',
      ].join(';');
      document.documentElement?.appendChild(pill);
    }
    pill.textContent = text;
  };
  window.__rec = (text) => {
    try {
      sessionStorage.setItem(KEY, text);
    } catch {
      /* the caption just will not survive a navigation */
    }
    render(text);
  };
  const boot = () => {
    const style = document.createElement('style');
    style.textContent =
      'nextjs-portal,[data-nextjs-dev-tools-button]{display:none !important}';
    document.documentElement?.appendChild(style);
    let text = null;
    try {
      text = sessionStorage.getItem(KEY);
    } catch {
      /* ignore */
    }
    if (text) render(text);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
};

export async function caption(page, text) {
  await page.evaluate((value) => window.__rec?.(value), text).catch(() => {});
}


// --- the pointer ------------------------------------------------------------

/**
 * Draws the pointer inside the page. Playwright's video never paints the real
 * cursor, so without this a viewer sees state change with nothing to explain
 * why. The dot follows the synthetic mouse events Playwright dispatches, turns
 * red and ripples on a click.
 */
const CURSOR_INIT = () => {
  const install = () => {
    if (document.getElementById('__rec-cursor')) return;
    const dot = document.createElement('div');
    dot.id = '__rec-cursor';
    dot.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'width:20px',
      'height:20px',
      'margin:-10px 0 0 -10px',
      'border-radius:50%',
      'background:rgba(17,17,17,.55)',
      'border:2px solid #fff',
      'box-shadow:0 0 0 2px rgba(0,0,0,.55)',
      'z-index:2147483647',
      'pointer-events:none',
      'opacity:0',
      'transition:transform .08s ease-out, background .08s linear',
    ].join(';');
    document.documentElement.appendChild(dot);

    const place = (event) => {
      dot.style.opacity = '1';
      dot.style.left = `${event.clientX}px`;
      dot.style.top = `${event.clientY}px`;
    };
    const ripple = (event) => {
      const wave = document.createElement('div');
      wave.style.cssText = [
        'position:fixed',
        `left:${event.clientX}px`,
        `top:${event.clientY}px`,
        'width:12px',
        'height:12px',
        'margin:-6px 0 0 -6px',
        'border-radius:50%',
        'border:2px solid rgba(220,38,38,.9)',
        'z-index:2147483647',
        'pointer-events:none',
      ].join(';');
      document.documentElement.appendChild(wave);
      wave
        .animate(
          [
            { transform: 'scale(1)', opacity: 1 },
            { transform: 'scale(4)', opacity: 0 },
          ],
          { duration: 500, easing: 'ease-out' },
        )
        .addEventListener('finish', () => wave.remove());
    };

    window.addEventListener('mousemove', place, true);
    window.addEventListener(
      'mousedown',
      (event) => {
        place(event);
        dot.style.transform = 'scale(.6)';
        dot.style.background = 'rgba(220,38,38,.55)';
        ripple(event);
      },
      true,
    );
    window.addEventListener(
      'mouseup',
      () => {
        dot.style.transform = 'scale(1)';
        dot.style.background = 'rgba(17,17,17,.55)';
      },
      true,
    );
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
};

/**
 * Clicks the way a person would: the pointer travels to the target, presses,
 * releases. `locator.click()` teleports, which reads as nothing happening.
 *
 * It drives the mouse directly, so Playwright's actionability checks do not
 * run: if something covers the target, the click lands on the cover and
 * nothing fails. When a step acts as if nothing was clicked, go back to
 * `locator.click()` for that one step.
 */
export async function pointerClick(locator, { steps = 24, button = 'left' } = {}) {
  const page = locator.page();
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('pointerClick: the target has no box on screen');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps });
  await page.waitForTimeout(120);
  await page.mouse.down({ button });
  await page.waitForTimeout(80);
  await page.mouse.up({ button });
}

/** Types visibly, key by key, instead of pasting the whole value at once. */
export async function pointerType(locator, text, { delay = 25 } = {}) {
  await pointerClick(locator);
  await locator.page().keyboard.type(text, { delay });
}

// --- polling helpers --------------------------------------------------------

/**
 * Polls a control's enabled state. A control re-renders when its mutation
 * settles, a moment after the alert you just asserted on, so a single read
 * catches the old state and reports a bug that is not there.
 */
export async function waitForEnabledState(locator, shouldBeDisabled, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let disabled = null;
  while (Date.now() < deadline) {
    disabled = await locator.isDisabled();
    if (disabled === shouldBeDisabled) return;
    await locator.page().waitForTimeout(250);
  }
  throw new Error(
    `${label} is ${disabled ? 'disabled' : 'enabled'}, expected ${shouldBeDisabled ? 'disabled' : 'enabled'}`,
  );
}

// --- the run ----------------------------------------------------------------

/**
 * @param {object} options
 * @param {object} options.chromium  `chromium` from the caller's @playwright/test
 * @param {string} options.flow      short name, prefixes every output file
 * @param {string} options.base      base URL of the app under test
 * @param {string} options.outDir    where the mp4s, gif and PNGs land
 * @param {Array}  options.actors    [{ key, storageState }] — one context each
 * @param {Function} options.run     async ({ actors, step }) => void
 */
export async function recordFlow(options) {
  const config = { ...DEFAULTS, ...options };
  const { chromium, flow, base, outDir, actors: actorSpecs, run } = config;
  if (!chromium) throw new Error('Pass `chromium` from @playwright/test');
  const videoDir = join(outDir, 'raw');
  const scratchDir = join(outDir, 'scratch');
  await mkdir(videoDir, { recursive: true });
  await mkdir(scratchDir, { recursive: true });

  const results = [];
  const timeline = [];

  /**
   * One step: caption, act, assert, hold, PNG. A throw is recorded and
   * swallowed, so a broken step costs one screenshot, not the recording.
   */
  async function step(actor, name, label, body) {
    log(`  · ${name}`);
    const startedAt = Date.now();
    await caption(actor.page, label);
    let error = null;
    try {
      await body();
    } catch (caught) {
      error = caught;
    }
    try {
      await actor.page.waitForTimeout(config.hold);
      await actor.page.screenshot({
        path: join(outDir, `${name}.png`),
        fullPage: true,
      });
    } catch (shotError) {
      log(`    ! screenshot failed: ${String(shotError?.message ?? shotError)}`);
    }
    timeline.push({ actor: actor.key, name, startedAt, endedAt: Date.now() });
    if (error) {
      log(`    ✗ ${String(error?.message ?? error).split('\n')[0]}`);
      results.push({ name, ok: false, error: String(error?.message ?? error) });
    } else {
      results.push({ name, ok: true });
    }
  }

  const browser = await chromium.launch({
    headless: true,
    slowMo: config.slowMo,
  });
  const actors = {};
  try {
    // Every context opens before any of them acts, so the recordings share one
    // clock and the side-by-side lines up.
    for (const spec of actorSpecs) {
      const context = await browser.newContext({
        baseURL: base,
        viewport: config.viewport,
        deviceScaleFactor: 1,
        colorScheme: 'light',
        recordVideo: { dir: videoDir, size: config.viewport },
        ...(spec.storageState ? { storageState: spec.storageState } : {}),
      });
      await context.addInitScript(CAPTION_INIT);
      await context.addInitScript(CURSOR_INIT);
      for (const script of spec.initScripts ?? []) {
        await context.addInitScript(script.body, script.arg);
      }
      const page = await context.newPage();
      actors[spec.key] = {
        key: spec.key,
        context,
        page,
        startedAt: Date.now(),
      };
    }

    await run({ actors, step, caption });

    for (const actor of Object.values(actors)) {
      await caption(actor.page, `${flow} · done`);
    }
    await Object.values(actors)[0].page.waitForTimeout(config.hold);

    for (const actor of Object.values(actors)) {
      actor.video = await actor.page.video().path();
      await actor.context.close();
    }
  } finally {
    await browser.close();
  }

  log('rendering');
  const files = await produce({ config, actors, timeline, scratchDir });

  for (const result of results) {
    log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.ok ? '' : ` — ${result.error}`}`);
  }
  for (const file of files) {
    log(`out ${file} (${(await duration(file).catch(() => 0)).toFixed(1)}s)`);
  }
  await writeFile(
    join(outDir, `${flow}-results.json`),
    JSON.stringify({ flow, results, timeline }, null, 2),
    'utf8',
  );
  return { results, files, failed: results.filter((result) => !result.ok) };
}

// --- rendering --------------------------------------------------------------

async function ffmpeg(args) {
  await exec(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
}

async function duration(path) {
  const { stdout } = await exec(FFPROBE, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nw=1:nk=1',
    path,
  ]);
  return Number(stdout.trim());
}

const H264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p'];

async function produce({ config, actors, timeline, scratchDir }) {
  const { flow, outDir } = config;
  const made = [];

  for (const actor of Object.values(actors)) {
    actor.mp4 = join(outDir, `${flow}-${actor.key}.mp4`);
    await ffmpeg(['-i', actor.video, '-r', '30', ...H264, actor.mp4]);
    made.push(actor.mp4);
  }

  const keys = Object.keys(actors);
  if (keys.length === 2) {
    const [left, right] = keys.map((key) => actors[key]);
    const base = Math.min(left.startedAt, right.startedAt);
    const side = join(outDir, `${flow}-side-by-side.mp4`);
    await ffmpeg([
      '-itsoffset', `${(left.startedAt - base) / 1000}`, '-i', left.mp4,
      '-itsoffset', `${(right.startedAt - base) / 1000}`, '-i', right.mp4,
      '-filter_complex',
      '[0:v]scale=960:600,setsar=1[l];[1:v]scale=960:600,setsar=1[r];[l][r]hstack=inputs=2,fps=30[v]',
      '-map', '[v]', ...H264, side,
    ]);
    made.push(side);
  }

  // The story cut follows whoever was acting, each span rebased on that
  // actor's own recording start.
  const pieces = [];
  for (const [index, span] of timeline.entries()) {
    const actor = actors[span.actor];
    if (!actor) continue;
    const piece = join(scratchDir, `piece-${String(index).padStart(2, '0')}.mp4`);
    await ffmpeg([
      '-i', actor.mp4,
      '-ss', `${Math.max(0, (span.startedAt - actor.startedAt) / 1000 - 0.3)}`,
      '-to', `${(span.endedAt - actor.startedAt) / 1000 + 0.2}`,
      '-r', '30', ...H264, piece,
    ]);
    pieces.push(piece);
  }
  const list = join(scratchDir, 'story.txt');
  await writeFile(list, pieces.map((piece) => `file '${piece}'`).join('\n'), 'utf8');
  const story = join(outDir, `${flow}-story.mp4`);
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', story]);
  made.push(story);

  const palette = join(scratchDir, 'palette.png');
  const gif = join(outDir, `${flow}-preview.gif`);
  for (const fps of [10, 8, 6]) {
    const scale = `fps=${fps},scale=${config.gifWidth}:-2:flags=lanczos`;
    await ffmpeg(['-i', story, '-vf', `${scale},palettegen=max_colors=128`, palette]);
    await ffmpeg([
      '-i', story, '-i', palette,
      '-filter_complex', `${scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
      gif,
    ]);
    const { size } = await stat(gif);
    log(`  gif at ${fps} fps: ${(size / 1e6).toFixed(1)} MB`);
    if (size <= config.gifMaxBytes) break;
  }
  made.push(gif);

  return made;
}
