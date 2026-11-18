// Shared by the browser tests: Chrome, a local page host and a pass/fail tally.
// WebGPU needs the real GPU, so these run in a visible Chrome window and are not part of CI.
import { execFileSync } from 'node:child_process';
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
  // what the original's data takes is not obvious from the name of a script
  if (hint.includes('ref:'))
    console.error(
      'That takes a clone of the original first: see "The reference rig" in the README. The tests that need ' +
        'none of it are boot, shell, panel, body, life, mood and touch (for example: node tests/browser/boot.mjs).',
    );
  process.exit(2);
}

/**
 * Chrome with a throwaway profile; the window is 1280x720 CSS pixels at the given device pixel ratio.
 * `memory` samples the browser's resident memory from outside while it runs (see `peak` on the result).
 */
export async function launch({
  dpr = 1,
  memory = false,
  args = [],
  viewport = { width: 1280, height: 720 },
  touch = false,
} = {}) {
  const profile = mkdtempSync(path.join(os.tmpdir(), 'hollowtide-test-'));
  const peak = { rendererMB: 0, gpuMB: 0, totalMB: 0 };
  const sampler = memory
    ? setInterval(() => {
        let rows;
        try {
          rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,command='], {
            encoding: 'utf8',
            maxBuffer: 1 << 26,
          }).split('\n');
        } catch {
          return;
        }
        const procs = rows
          .map((r) => r.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/))
          .filter(Boolean)
          .map((m) => ({ pid: m[1], ppid: m[2], mb: m[3] / 1024, cmd: m[4] }));
        const main = procs.find((p) => p.cmd.includes(profile) && !p.cmd.includes('--type='));
        if (!main) return;
        let total = main.mb;
        for (const p of procs) {
          if (p.ppid !== main.pid) continue;
          total += p.mb;
          if (p.cmd.includes('--type=renderer')) peak.rendererMB = Math.max(peak.rendererMB, p.mb);
          if (p.cmd.includes('--type=gpu-process')) peak.gpuMB = Math.max(peak.gpuMB, p.mb);
        }
        peak.totalMB = Math.max(peak.totalMB, total);
      }, 250)
    : null;
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless: false,
    viewport,
    deviceScaleFactor: dpr,
    // a phone: fingers instead of a mouse, and the page laid out as on one
    hasTouch: touch,
    isMobile: touch,
    args,
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return {
    page,
    errors,
    /** peak resident memory in MB so far, if launched with `memory` */
    peak,
    /**
     * Opens a URL and waits until the app has finished starting (or failed to). With `pause`, the app's own
     * frame loop then stops drawing, so the only frames are the ones the test asks for. The page draws with
     * the original's distances (`tuning: 'faithful'`) unless told to use the ones that ship (`'tuned'`).
     */
    async open(url, { pause = false, tuning = 'faithful' } = {}) {
      // (the original's own draw distances, unless a test is about the tuned ones that ship)
      if (/^https?:/.test(url) && !/[?&]tuning=/.test(url)) {
        // (before the #, if the address has one)
        const [address, hash = ''] = url.split(/(?=#)/);
        url = address + (address.includes('?') ? '&' : '?') + 'tuning=' + tuning + hash;
      }
      // an address that differs from the page's own only after the # would not load the page again
      if (url.includes('#')) await page.goto('about:blank');
      await page.goto(url);
      await page.waitForFunction(() => window.__hollowtide?.ready, null, { timeout: 60_000 });
      return page.evaluate((pause) => {
        window.__hollowtide.paused = pause;
        return { error: window.__hollowtide.error, report: window.__hollowtide.report };
      }, pause);
    },
    async close() {
      if (sampler) clearInterval(sampler);
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
 *   /original.html                        the original with the timing hooks (tools/reference/build-ref.mjs)
 */
export function serve(pageFile, fixtures = fixturesDir(0)) {
  const resolve = (pathname) => {
    if (pathname === '/') return pageFile;
    if (pathname === '/original.html') return path.join(root, '.cache/reference/reference-bench.html');
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
      'content-type': /^\/(original\.html)?$/.test(pathname) ? 'text/html; charset=utf-8' : 'application/octet-stream',
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
