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
    /** Opens a URL and waits until the app has finished starting (or failed to). */
    async open(url) {
      await page.goto(url);
      await page.waitForFunction(() => window.__abyssal?.ready, null, { timeout: 60_000 });
      return page.evaluate(() => ({ error: window.__abyssal.error, report: window.__abyssal.report }));
    },
    async close() {
      await context.close();
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

/** Serves one built page at / and the reference fixtures at /fixtures/. */
export function serve(pageFile, fixtures) {
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    const file =
      pathname === '/'
        ? pageFile
        : /^\/fixtures\/[\w.-]+$/.test(pathname)
          ? path.join(fixtures, pathname.slice(10))
          : null;
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
