// Shared by the browser tests: Chrome, a local page host and a pass/fail tally.
// WebGPU needs the real GPU, so these run in a visible Chrome window and are not part of CI.
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const upstream = JSON.parse(readFileSync(path.join(root, 'tools/reference/upstream.json'), 'utf8'));
/** Where `npm run ref:dump` puts the original's data for a detail level. */
export const fixturesDir = (level = 0) =>
  path.join(root, '.cache/reference', upstream.sha.slice(0, 7), 'L' + level, 'fixtures');

const failures = [];
export const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
  return ok;
};
export const finish = () => {
  if (failures.length) console.log(`\n${failures.length} failed`);
  process.exitCode = failures.length ? 1 : 0;
};

export function need(file, hint) {
  if (existsSync(file)) return;
  console.error(`${path.relative(root, file)} is missing: ${hint}`);
  process.exit(2);
}

/** Chrome with a throwaway profile; the window is 1280x720 CSS pixels at the given device pixel ratio. */
export async function launch({ dpr = 1 } = {}) {
  const profile = mkdtempSync(path.join(os.tmpdir(), 'abyssal-test-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: dpr,
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return {
    page,
    errors,
    /**
     * Opens a URL and waits until the app has finished starting (or failed to). With `pause`, the app's own
     * frame loop then stops drawing, so the only frames are the ones the test asks for.
     */
    async open(url, { pause = false } = {}) {
      await page.goto(url);
      await page.waitForFunction(() => window.__abyssal?.ready, null, { timeout: 60_000 });
      return page.evaluate((pause) => {
        window.__abyssal.paused = pause;
        return { error: window.__abyssal.error, report: window.__abyssal.report };
      }, pause);
    },
    async close() {
      await context.close();
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

/** Where `npm run ref:capture` puts the original's frames for a detail level. */
export const shotsDir = (level = 0) =>
  path.join(root, '.cache/reference', upstream.sha.slice(0, 7), 'L' + level, 'shots');

/**
 * Serves one built page at / and what the reference rig recorded:
 *   /fixtures/<file>                      the dumped world and textures at High detail
 *   /reference/L<level>/fixtures/<file>   the same for any level
 *   /reference/L<level>/shots/<file>      the captured frames
 */
export function serve(pageFile, fixtures = fixturesDir(0)) {
  const resolve = (pathname) => {
    if (pathname === '/') return pageFile;
    let m = /^\/fixtures\/([\w.-]+)$/.exec(pathname);
    if (m) return path.join(fixtures, m[1]);
    m = /^\/reference\/L([012](?:-\w+)?)\/(fixtures|shots)\/([\w.-]+)$/.exec(pathname);
    if (m) return path.join(m[2] === 'shots' ? shotsDir(m[1]) : fixturesDir(m[1]), m[3]);
    return null;
  };
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    const file = resolve(pathname);
    if (!file || !existsSync(file)) {
      res.writeHead(pathname === '/favicon.ico' ? 204 : 404);
      res.end();
      return;
    }
    res.writeHead(200, {
      'content-type': pathname === '/' ? 'text/html; charset=utf-8' : 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () =>
      ok({ origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }),
    ),
  );
}
