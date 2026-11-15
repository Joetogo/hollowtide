// The whole scene pass against the original: everything in the opaque test plus kelp, plants, glints, fish,
// mantas, bubbles and drifting particles, at three times (plants sway and animals move). Only the light shafts
// are off, on both sides. The rebuild draws the original's dumped world. Needs the fixtures: `npm run ref:dump`.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { check, finish, fixturesDir, launch, need, root, serve } from './lib.mjs';

const page = path.join(root, 'dist/index.harness.html');
const fixtures = fixturesDir(0);
need(page, 'run `npm run build:harness`');
need(path.join(fixtures, 'index.json'), 'run `npm run ref:dump`');
const index = JSON.parse(readFileSync(path.join(fixtures, 'index.json'), 'utf8'));
const times = [2, 11, 47].filter((t) => existsSync(path.join(fixtures, `frame_pose1_t${t}_noShafts.png`)));

const host = await serve(page, fixtures);
const chrome = await launch();
try {
  const { error } = await chrome.open(host.origin + '/', { pause: true });
  check(!error, `starts${error ? ': ' + error : ''}`);
  await chrome.page.evaluate(() => window.__abyssal.harness.loadReferenceWorld('/fixtures/'));
  for (const [i, pose] of index.meta.poses.entries()) {
    for (const time of times) {
      const id = `pose${i + 1}_t${time}`;
      const frame = await chrome.page.evaluate(
        ([id, pose, time]) => window.__abyssal.harness.compareFrame(pose, time, `/fixtures/frame_${id}_noShafts.png`),
        [id, pose, time],
      );
      const percent = ((frame.differing / frame.pixels) * 100).toFixed(3);
      check(
        frame.max <= 2 && frame.over1 / frame.pixels < 1e-4,
        `${id}: ${frame.differing} of ${frame.pixels} pixels differ (${percent} %), ` +
          `${frame.over1} by more than 1/255, largest ${frame.max}/255`,
      );
    }
  }
  const gpuErrors = await chrome.page.evaluate(() => window.__abyssal.harness.gpuErrors());
  check(gpuErrors.length === 0, `no shader or validation errors${gpuErrors.length ? ': ' + gpuErrors.join('; ') : ''}`);
  check(chrome.errors.length === 0, `no console errors${chrome.errors.length ? ': ' + chrome.errors.join('; ') : ''}`);
} finally {
  await chrome.close();
  host.close();
}
finish();
