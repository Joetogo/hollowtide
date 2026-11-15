// Whole frames against the original, light shafts included, at all three detail levels: six viewpoints at three
// times each, and at High also 30 frames along the fly-through. The rebuild draws the original's dumped world of
// the same level. Needs, per level: `npm run ref:capture -- --level N` and `npm run ref:dump -- --level N`.
//   node tests/browser/frame.mjs [levels, default 0,1,2]
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { check, finish, fixturesDir, launch, need, root, serve, shotsDir } from './lib.mjs';

const page = path.join(root, 'dist/index.harness.html');
need(page, 'run `npm run build:harness`');
const levels = (process.argv[2] ?? '0,1,2').split(',').map(Number);
const NAMES = ['High', 'Medium', 'Low'];

const host = await serve(page);
for (const level of levels) {
  const base = `/reference/L${level}/`;
  need(path.join(fixturesDir(level), 'index.json'), `run \`npm run ref:dump -- --level ${level}\``);
  need(path.join(shotsDir(level), 'pose1_t2.png'), `run \`npm run ref:capture -- --level ${level}\``);
  const index = JSON.parse(readFileSync(path.join(fixturesDir(level), 'index.json'), 'utf8'));
  const chrome = await launch();
  try {
    const { error } = await chrome.open(`${host.origin}/?level=${level}`, { pause: true });
    check(!error, `${NAMES[level]}: starts${error ? ': ' + error : ''}`);
    await chrome.page.evaluate((base) => window.__abyssal.harness.loadReferenceWorld(base + 'fixtures/'), base);
    // At Low (no anti-aliasing) the scene is not exactly repeatable on this GPU: a few hundred isolated pixels on
    // the plants can change from one render to the next, in the original (tests/browser/noise.mjs measures it)
    // and in the rebuild alike. So a frame gets up to three renders there, and passes on a looser limit.
    const limit = level === 2 ? { over1: 2e-3, max: 255, tries: 3 } : { over1: 1e-4, max: 2, tries: level ? 3 : 1 };
    const compare = async (label, pose, time, file) => {
      let frame;
      for (let attempt = 0; attempt < limit.tries; attempt++) {
        const next = await chrome.page.evaluate(
          ([pose, time, url]) => window.__abyssal.harness.compareFrame(pose, time, url),
          [pose, time, `${base}shots/${file}`],
        );
        if (!frame || next.over1 < frame.over1) frame = next;
        if (frame.max <= limit.max && frame.over1 / frame.pixels < limit.over1) break;
      }
      const percent = ((frame.differing / frame.pixels) * 100).toFixed(3);
      check(
        frame.max <= limit.max && frame.over1 / frame.pixels < limit.over1,
        `${NAMES[level]} ${label}: ${frame.differing} of ${frame.pixels} pixels differ (${percent} %), ` +
          `${frame.over1} by more than 1/255, largest ${frame.max}/255`,
      );
    };
    for (const [i, pose] of index.meta.poses.entries()) {
      for (const time of [2, 11, 47])
        await compare(`viewpoint ${i + 1} at ${time} s`, pose, time, `pose${i + 1}_t${time}.png`);
    }
    // the fly-through: frame i of 30 is taken (i + 0.5) / 30 of the way through the 60 s flight
    const flyFrames = level === 0 ? 30 : 0;
    for (let i = 0; i < flyFrames; i++) {
      const file = `fly${String(i).padStart(2, '0')}.png`;
      if (!existsSync(path.join(shotsDir(level), file))) continue;
      const seconds = ((i + 0.5) * 60) / flyFrames;
      const pose = await chrome.page.evaluate((s) => window.__abyssal.harness.flyPose(s), seconds);
      await compare(`fly-through at ${seconds} s`, pose, seconds, file);
    }
    const gpuErrors = await chrome.page.evaluate(() => window.__abyssal.harness.gpuErrors());
    check(
      gpuErrors.length === 0,
      `${NAMES[level]}: no shader or validation errors${gpuErrors.length ? ': ' + gpuErrors.join('; ') : ''}`,
    );
    check(
      chrome.errors.length === 0,
      `${NAMES[level]}: no console errors${chrome.errors.length ? ': ' + chrome.errors.join('; ') : ''}`,
    );
  } finally {
    await chrome.close();
  }
}
host.close();
finish();
