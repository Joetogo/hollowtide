// What each part of the scene costs, on this machine: the frame is timed whole and with one part left out, in
// turns (A B B A, so a machine that warms up as it goes affects both alike), at the six viewpoints.
//   node tests/browser/profile.mjs [level, default 0] [pixels, default 640x360 and 2560x1440]
// At 640x360 almost nothing is spent on pixels, so what is left is the cost of the geometry itself.
import path from 'node:path';
import { launch, need, root, serve } from './lib.mjs';

const page = path.join(root, 'dist/index.harness.html');
need(page, 'run `npm run build:harness`');
const args = process.argv.slice(2);
const level = +(args[0] ?? 0);
const sizes = args[1]
  ? [[args[1], args[1].split('x').reduce((w, h) => w * h)]]
  : [
      ['640x360', 640 * 360],
      ['2560x1440', 2560 * 1440],
    ];
const PARTS = [
  'terrain',
  'solids',
  'chunks',
  'props',
  'leaves',
  'fish',
  'mantas',
  'glints',
  'bubbles',
  'snow',
  'shafts',
];
const BURST = 24;
const WARM = 4;

const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const host = await serve(page);
const chrome = await launch({ dpr: 2 });
try {
  const { error } = await chrome.open(`${host.origin}/?level=${level}`, { pause: true });
  if (error) throw new Error(error);
  await chrome.page.waitForFunction(() => document.body.className === 'home', null, { timeout: 20_000 });
  await chrome.page.waitForTimeout(2000); // the opening has played out
  await chrome.page.evaluate(() => (document.body.className = 'playing'));
  await chrome.page.waitForTimeout(1000);
  const viewpoints = await chrome.page.evaluate(() => window.__hollowtide.harness.viewpoints());

  // what one frame submits, by pipeline: draw calls, instances, vertices or indices (summed over the viewpoints)
  const counts = await chrome.page.evaluate((viewpoints) => {
    const h = window.__hollowtide.harness;
    const P = GPURenderPassEncoder.prototype;
    const { setPipeline, draw, drawIndexed } = P;
    const current = new WeakMap();
    const counts = {};
    P.setPipeline = function (p) {
      current.set(this, p.label);
      return setPipeline.call(this, p);
    };
    const tally = (pass, a) => {
      const c = (counts[current.get(pass)] ||= [0, 0, 0]);
      c[0]++;
      c[1] += a[1] ?? 1;
      c[2] += a[0] * (a[1] ?? 1);
    };
    P.draw = function (...a) {
      tally(this, a);
      return draw.apply(this, a);
    };
    P.drawIndexed = function (...a) {
      tally(this, a);
      return drawIndexed.apply(this, a);
    };
    for (const pose of viewpoints) h.capture(pose, 2);
    Object.assign(P, { setPipeline, draw, drawIndexed });
    return counts;
  }, viewpoints);
  console.log('per frame, averaged over the six viewpoints: draw calls, instances, vertices or indices');
  for (const [name, c] of Object.entries(counts)
    .sort((a, b) => b[1][2] - a[1][2])
    .slice(0, 12))
    console.log(
      `  ${name.padEnd(14)} ${String(Math.round(c[0] / 6)).padStart(5)} ${String(Math.round(c[1] / 6)).padStart(9)} ${Math.round(
        c[2] / 6,
      )
        .toLocaleString()
        .padStart(12)}`,
    );

  const cost = (pose, pixels, skip) =>
    chrome.page.evaluate(
      async ([pose, n, pixels, skip]) => {
        const h = window.__hollowtide.harness;
        h.skipDraws(...skip);
        const r = await h.frameCost([pose], n, pixels);
        h.skipDraws();
        return r.totalMs;
      },
      [pose, BURST, pixels, skip],
    );
  for (const [label, pixels] of sizes) {
    console.log(
      `\n${label}: milliseconds of the frame that go away when a part is left out (six viewpoints, then their mean)`,
    );
    const whole = [];
    const saved = Object.fromEntries(PARTS.map((p) => [p, []]));
    for (const pose of viewpoints) {
      const full = [];
      for (const part of PARTS) {
        const without = [];
        for (const side of [0, 1, 1, 0])
          (side ? without : full).push(...(await cost(pose, pixels, side ? [part] : [])).slice(WARM));
        saved[part].push(median(full.slice(-2 * (BURST - WARM))) - median(without));
      }
      whole.push(median(full));
    }
    const row = (name, values) =>
      console.log(
        `  ${name.padEnd(12)} ${values.map((v) => v.toFixed(1).padStart(6)).join('')}   ${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1).padStart(6)}`,
      );
    row('whole frame', whole);
    for (const part of PARTS) row(part, saved[part]);
  }
} finally {
  await chrome.close();
  host.close();
}
