// What each part of a frame costs, on this machine: the frame is timed whole and with one part left out, in many
// short alternating turns (a laptop that is warm slows down and speeds up from one second to the next, and a few
// long turns measure that instead).
//   node tests/browser/profile.mjs [level, default 0] [size, default 640x360 and 1600x900] [--parts a,b,c]
// At 640x360 almost nothing is spent on pixels, so what is left is the cost of the geometry and of the passes.
import path from 'node:path';
import { launch, need, root, serve } from './lib.mjs';

const page = path.join(root, 'dist/index.harness.html');
need(page, 'run `npm run build:harness`');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (name) => {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? null : process.argv[i + 1];
};
const level = +(args[0] ?? 0);
const sizes = args[1] ? [args[1]] : ['640x360', '1600x900'];
const PARTS = (
  flag('parts') ??
  'terrain,solids,chunks,props,leaves near,leaves mid,leaves far,leaves small,fish,mantas,glints,bubbles,snow,shafts,water,bloom'
).split(',');
const VIEWPOINTS = [0, 2, 3, 5];
const ROUNDS = 10;

const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const host = await serve(page);
const chrome = await launch({ dpr: 2 });
try {
  const { error } = await chrome.open(`${host.origin}/?level=${level}`, {
    pause: true,
    tuning: flag('tuning') ?? 'tuned',
  });
  if (error) throw new Error(error);
  await chrome.page.waitForFunction(() => document.body.className === 'home', null, { timeout: 20_000 });
  await chrome.page.waitForTimeout(2000); // the opening has played out
  await chrome.page.evaluate(() => (document.body.className = 'playing'));
  await chrome.page.waitForTimeout(500);

  for (const size of sizes) {
    const pixels = size.split('x').reduce((w, h) => w * h);
    // one page call per viewpoint: every part against the whole frame, ROUNDS turns of ten frames each
    const rows = Object.fromEntries(PARTS.map((p) => [p, []]));
    const whole = [];
    for (const v of VIEWPOINTS) {
      const r = await chrome.page.evaluate(
        async ([v, pixels, parts, rounds]) => {
          const h = window.__hollowtide.harness;
          const pose = h.viewpoints()[v];
          const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
          const time = async (skip) => {
            h.skipDraws(...skip);
            const r = await h.frameCost([pose], 10, pixels);
            h.skipDraws();
            return r.totalMs.slice(3);
          };
          const out = { whole: [], saved: {} };
          for (const part of parts) {
            const samples = [[], []];
            for (let round = 0; round < rounds; round++)
              for (const side of round % 2 ? [1, 0] : [0, 1]) samples[side].push(...(await time(side ? [part] : [])));
            out.saved[part] = median(samples[0]) - median(samples[1]);
            out.whole.push(median(samples[0]));
          }
          out.whole = median(out.whole);
          return out;
        },
        [v, pixels, PARTS, ROUNDS],
      );
      whole.push(r.whole);
      for (const p of PARTS) rows[p].push(r.saved[p]);
    }
    const row = (name, values) =>
      console.log(
        `  ${name.padEnd(13)} ${values.map((x) => x.toFixed(1).padStart(6)).join('')}   ${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(2).padStart(6)}`,
      );
    console.log(
      `\n${size}: milliseconds a frame gets shorter when a part is left out (viewpoints ${VIEWPOINTS.map((v) => v + 1).join(', ')}, then their mean)`,
    );
    row('whole frame', whole);
    for (const p of [...PARTS].sort((a, b) => median(rows[b]) - median(rows[a]))) row(p, rows[p]);
  }
} finally {
  await chrome.close();
  host.close();
}
