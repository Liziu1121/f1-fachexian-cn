import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { photoIdentity } from './home-photo.mjs';
import { mirrorCalendar } from './live-data.mjs';

const snapshotPath = '.live-cache/home-photo-checks.json';
const now = Date.now();
const day = 24 * 3600_000;
const [schedule, previous] = await Promise.all([
  readFile('public/data.js', 'utf8').then(mirrorCalendar),
  readFile(snapshotPath, 'utf8').then(JSON.parse, error => {
    if (error.code === 'ENOENT') return {};
    throw error;
  }),
]);
const checked = previous.checked || {};
const sessionId = session => `${session.meeting}:${session.name}:${session.startsAt}`;
const pending = schedule.filter(session => session.startsAt <= now &&
  session.startsAt > Math.max(previous.startedAt ?? now - 3600_000, now - 14 * day) && !checked[sessionId(session)])
  .sort((a, b) => a.startsAt - b.startsAt);

if (process.argv.includes('--pending')) {
  console.log(pending.length > 0);
  if (!previous.startedAt) await writeFile(snapshotPath, JSON.stringify({ startedAt: now - 3600_000, checked }));
} else if (!pending.length) {
  if (!previous.startedAt) await writeFile(snapshotPath, JSON.stringify({ startedAt: now, checked }));
} else {
  const { chromium } = createRequire(import.meta.url)(process.env.F1_PLAYWRIGHT);
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      const file = pathname === '/' ? 'index.html' : pathname.slice(1);
      const types = { html: 'text/html', css: 'text/css', js: 'text/javascript', json: 'application/json' };
      response.setHeader('Content-Type', types[file.split('.').at(-1)] || 'application/octet-stream');
      response.end(await readFile(join('public', file)));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const root = `http://127.0.0.1:${server.address().port}/#/home`;
  try {
    const browser = await chromium.launch({ executablePath: process.env.F1_CHROME || undefined });
    try {
      for (const session of pending) {
        const pages = [320, 390, 430].map((width, index) => ({ width, height: [568, 844, 932][index] }));
        for (const viewport of pages) {
          const page = await browser.newPage({ viewport, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
          try {
            await page.clock.setFixedTime(session.startsAt + 1000);
            await page.goto(root, { waitUntil: 'domcontentloaded', timeout: 15_000 });
            await page.waitForFunction(() => {
              const image = document.querySelector('[data-hero-frame].active');
              return image?.naturalWidth > 0 && document.querySelector('#heroCaption')?.textContent.includes('官方赛道精选');
            }, null, { timeout: 15_000 });
            const state = await page.locator('[data-hero-frame].active').evaluate(image => {
              const css = getComputedStyle(image);
              return { original: image.src, variant: image.currentSrc, fit: css.objectFit, position: css.objectPosition,
                height: image.clientHeight, width: image.clientWidth, naturalWidth: image.naturalWidth,
                naturalHeight: image.naturalHeight, blurredBackdrop: Boolean(document.querySelector('.hero-mobile-backdrop')) };
            });
            assert.equal(state.fit, 'cover');
            assert.equal(state.position, '50% 50%');
            assert(!state.blurredBackdrop && state.width >= viewport.width - 1 && state.height >= viewport.height - 73);
            assert.notEqual(state.original, state.variant);
            assert.equal(photoIdentity(state.original), photoIdentity(state.variant));
            assert(state.naturalHeight > state.naturalWidth && /g_(?:xy_center|auto:subject)/.test(state.variant));
          } catch (error) {
            const name = `home-photo-${session.startsAt}-${viewport.width}.png`;
            await page.screenshot({ path: name, timeout: 4000 }).catch(() => {});
            throw new Error(`${session.location} ${session.name}, ${viewport.width}px: ${error.message}`);
          } finally {
            await page.close();
          }
        }
        checked[sessionId(session)] = session.startsAt;
        await writeFile(snapshotPath, JSON.stringify({ startedAt: previous.startedAt ?? now - 3600_000,
          checked: Object.fromEntries(Object.entries(checked).filter(([, time]) => time > now - 14 * day)) }));
        console.log(`Mobile homepage photo verified for ${session.location} ${session.name}.`);
      }
    } finally {
      await browser.close();
    }
  } finally {
    server.close();
  }
}
