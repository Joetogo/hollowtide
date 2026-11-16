// Load time, memory and frame cost of the hollowtide next to the original's, on this machine.
// Leave both Chrome windows visible and untouched while it runs (about five minutes).
//   node tests/browser/bench.mjs [level, default 0] [--quick]      --quick skips the fly-through
//
// Both pages are open at once and take turns, a few dozen frames each, in the order A B B A. A laptop slows down
// by half as it warms up, so timings taken minutes apart cannot be compared; timings taken in turns can, because
// both sides see the same machine. Frames run one at a time, each waited for until the GPU has finished it, so
// the numbers are the cost of a frame and do not depend on the display's refresh rate.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildReference } from '../../tools/reference/build-ref.mjs';
import { launch, need, root, serve } from './lib.mjs';

const page = path.join(root, 'dist/index.harness.html');
need(page, 'run `npm run build:harness`');
buildReference();
const level = +(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 0);
const quick = process.argv.includes('--quick');

const BURST = 35; // frames per turn
const WARM = 5; // of which this many are not counted: the first frames after the other side had the GPU
const FLY_FRAMES = 600;
const FLY_SEGMENT = 50;
const SIZES = [
  ['2560x1440', 2560 * 1440],
  ['1280x720', 1280 * 720],
  ['640x360', 640 * 360],
];

const round = (x) => +x.toFixed(1);
const sorted = (a) => [...a].sort((x, y) => x - y);
const median = (a) => round(sorted(a)[a.length >> 1]);
const stats = (a) => {
  const s = sorted(a);
  return {
    avg: round(s.reduce((x, y) => x + y, 0) / s.length),
    p50: median(a),
    p99: round(s[Math.floor(s.length * 0.99)]),
    max: round(s.at(-1)),
  };
};
const percent = (mine, theirs) => `${mine <= theirs ? '' : '+'}${Math.round((mine / theirs - 1) * 100)} %`;
const long = (tasks) => ({
  longestTaskMs: Math.round(Math.max(0, ...tasks)),
  blockedMs: Math.round(tasks.reduce((a, b) => a + b, 0)),
});

// a 1280x720 window at 2x is 2560x1440, the resolution the original was tuned for
const options = {
  dpr: 2,
  memory: true,
  args: [
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ],
};
const host = await serve(page);
const out = { level, date: new Date().toISOString(), load: {}, poses: {}, fly: {} };
const browsers = [];
try {
  // ---- the original: loads first, so the hollowtide is the one that loads on the warmer, fuller machine
  const theirs = await launch(options);
  browsers.push(theirs);
  await theirs.page.addInitScript((level) => {
    try {
      localStorage.setItem('abyssal', String(level));
      localStorage.removeItem('abyssalLoad');
    } catch {
      // storage can be blocked: the level check below then fails
    }
  }, level);
  await theirs.page.goto(`${host.origin}/original.html?ref=bench`);
  await theirs.page.waitForFunction(() => window.__ref && (window.__ref.ready || window.__ref.error), null, {
    timeout: 240_000,
  });
  const original = await theirs.page.evaluate(() => ({
    error: window.__ref.error,
    loadMs: window.__ref.loadMs,
    longTasks: window.__ref.longTasks.map((t) => t[1]),
    level: window.__ref.meta?.level,
  }));
  if (original.error) throw new Error('the original failed to start: ' + original.error);
  if (original.level !== undefined && original.level !== level)
    throw new Error(`the original started at level ${original.level}`);
  await theirs.page.evaluate(() => (window.__ref.dive(), window.__ref.pause()));
  out.load.original = {
    totalMs: Math.round(original.loadMs),
    ...long(original.longTasks),
    peakMemory: { ...theirs.peak },
  };

  // ---- the hollowtide
  const mine = await launch(options);
  browsers.push(mine);
  await mine.page.addInitScript(() => {
    // long tasks with their start times, and when each loading message appeared, so a long task can be placed
    window.__load = { tasks: [], stages: [] };
    new PerformanceObserver((l) =>
      l.getEntries().forEach((e) => window.__load.tasks.push([Math.round(e.startTime), Math.round(e.duration)])),
    ).observe({ type: 'longtask', buffered: true });
    addEventListener('DOMContentLoaded', () => {
      const status = document.getElementById('status');
      const note = () => window.__load.stages.push([status.textContent, Math.round(performance.now())]);
      new MutationObserver(note).observe(status, { childList: true, characterData: true, subtree: true });
    });
  });
  const { error, report } = await mine.open(`${host.origin}/?level=${level}`, { pause: true });
  if (error) throw new Error(error);
  // out of the menu, like the original: the menu's blur over the canvas costs GPU time of its own
  // (once the opening has played out: the home view would otherwise come up in the middle of the measurements)
  await mine.page.waitForFunction(() => document.body.className === 'home', null, { timeout: 20_000 });
  await mine.page.waitForTimeout(2000);
  const loading = await mine.page.evaluate(() => ((document.body.className = 'playing'), window.__load));
  // each long task with the loading message that was up when it began
  const placed = loading.tasks.map(([at, ms]) => ({
    at,
    ms,
    during: loading.stages.findLast(([, since]) => since <= at)?.[0] ?? 'before the first loading message',
  }));
  out.load.hollowtide = {
    totalMs: report.loadMs,
    ...long(loading.tasks.map((t) => t[1])),
    longTasks: placed,
    peakMemory: { ...mine.peak },
  };

  const [a, b] = [out.load.original, out.load.hollowtide];
  console.log('                  original        Hollowtide');
  const row = (label, x, y) => console.log(`${label.padEnd(18)}${String(x).padEnd(16)}${y}`);
  row('load', `${(a.totalMs / 1000).toFixed(1)} s`, `${(b.totalMs / 1000).toFixed(1)} s`);
  row('main thread held', `${a.blockedMs} ms`, `${b.blockedMs} ms`);
  row('longest task', `${a.longestTaskMs} ms`, `${b.longestTaskMs} ms`);
  row('peak memory, page', `${Math.round(a.peakMemory.rendererMB)} MB`, `${Math.round(b.peakMemory.rendererMB)} MB`);
  row('peak, browser', `${Math.round(a.peakMemory.totalMB)} MB`, `${Math.round(b.peakMemory.totalMB)} MB`);
  for (const t of placed) console.log(`  hollowtide: a ${t.ms} ms task ${t.at} ms in, during "${t.during}"`);
  await mine.page.waitForTimeout(1500);

  // ---- frame cost, in turns
  const viewpoints = await mine.page.evaluate(() => window.__hollowtide.harness.viewpoints());
  const flySeconds = Array.from({ length: FLY_FRAMES }, (_, i) => ((i + 0.5) * 60) / FLY_FRAMES);
  const flyPath = await mine.page.evaluate(
    (seconds) => seconds.map((s) => window.__hollowtide.harness.flyPose(s)),
    flySeconds,
  );
  const turns = async (first, second) => {
    const results = [[], []];
    for (const side of [0, 1, 1, 0]) results[side].push(...(await [first, second][side]()));
    return results;
  };
  for (const [label, pixels] of SIZES) {
    const size = await theirs.page.evaluate((pixels) => window.__ref.hold(pixels), pixels);
    const poses = (out.poses[label] = { size, original: [], hollowtide: [] });
    for (let p = 0; p < 6; p++) {
      const [o, r] = await turns(
        async () =>
          (await theirs.page.evaluate(([p, n]) => window.__ref.costPose(p, n), [p, BURST])).totalMs.slice(WARM),
        async () =>
          (
            await mine.page.evaluate(
              ([pose, n, pixels]) => window.__hollowtide.harness.frameCost([pose], n, pixels),
              [viewpoints[p], BURST, pixels],
            )
          ).totalMs.slice(WARM),
      );
      poses.original.push(median(o));
      poses.hollowtide.push(median(r));
    }
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    console.log(`\n${label}, the six viewpoints, median frame in ms`);
    console.log(`  original  ${poses.original.map((v) => String(v).padStart(5)).join(' ')}`);
    console.log(
      `  hollowtide   ${poses.hollowtide.map((v) => String(v).padStart(5)).join(' ')}   ${percent(sum(poses.hollowtide), sum(poses.original))}`,
    );
    if (quick || label === '640x360') continue;

    const o = [],
      r = [];
    for (let from = 0, turn = 0; from < FLY_FRAMES; from += FLY_SEGMENT, turn++) {
      const to = from + FLY_SEGMENT;
      const original = async () =>
        o.push(
          ...(
            await theirs.page.evaluate(
              ([n, from, to, warm]) => window.__ref.costFlyRange(n, from, to, warm),
              [FLY_FRAMES, from, to, WARM],
            )
          ).totalMs,
        );
      const hollowtide = async () => {
        const lead = Array(WARM).fill(from);
        const frames = [...lead, ...Array.from({ length: FLY_SEGMENT }, (_, i) => from + i)];
        const cost = await mine.page.evaluate(
          ([poses, n, pixels, seconds]) => window.__hollowtide.harness.frameCost(poses, n, pixels, seconds),
          [frames.map((i) => flyPath[i]), frames.length, pixels, frames.map((i) => flySeconds[i])],
        );
        r.push(...cost.totalMs.slice(WARM));
      };
      for (const run of turn % 2 ? [hollowtide, original] : [original, hollowtide]) await run();
    }
    const fly = (out.fly[label] = { original: stats(o), hollowtide: stats(r) });
    console.log(`${label}, the 60 s fly-through, ${FLY_FRAMES} frames`);
    console.log(`  original  avg ${fly.original.avg}  p99 ${fly.original.p99}  worst ${fly.original.max} ms`);
    console.log(
      `  hollowtide   avg ${fly.hollowtide.avg}  p99 ${fly.hollowtide.p99}  worst ${fly.hollowtide.max} ms   ${percent(fly.hollowtide.avg, fly.original.avg)}`,
    );
  }
  const dir = path.join(root, 'test-results');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `bench-L${level}.json`), JSON.stringify(out, null, 1) + '\n');
} finally {
  for (const b of browsers) await b.close().catch(() => {});
  host.close();
}
