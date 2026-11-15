// The opaque scene against the original: terrain, rocks, set pieces, sponges, corals, water surface, backdrop.
// The rebuild draws the original's dumped world; the original's frames were captured with its leaves, animals,
// particles and light shafts switched off. Needs the fixtures: `npm run ref:dump`.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { check, finish, fixturesDir, launch, need, root, serve } from './lib.mjs';

const page = path.join(root, 'dist/index.harness.html');
const fixtures = fixturesDir(0);
need(page, 'run `npm run build:harness`');
need(path.join(fixtures, 'index.json'), 'run `npm run ref:dump`');
const index = JSON.parse(readFileSync(path.join(fixtures, 'index.json'), 'utf8'));

const host = await serve(page, fixtures);
const chrome = await launch();
try {
  const { error } = await chrome.open(host.origin + '/', { pause: true });
  check(!error, `starts${error ? ': ' + error : ''}`);
  await chrome.page.evaluate(() => window.__abyssal.harness.loadReferenceWorld('/fixtures/'));
  for (const id of Object.keys(index.frames)) {
    const pose = index.meta.poses[+id[4] - 1];
    const time = +id.split('_t')[1];
    const { frame, scene } = await chrome.page.evaluate(
      async ([id, pose, time]) => {
        const h = window.__abyssal.harness;
        const frame = await h.compareFrame(pose, time, `/fixtures/frame_${id}_opaque.png`);
        const scene = await h.compareTexture('scene', `/fixtures/hdr_${id}_opaqueScene.bin`);
        return { frame, scene };
      },
      [id, pose, time],
    );
    const percent = ((frame.differing / frame.pixels) * 100).toFixed(3);
    check(
      frame.max <= 2 && frame.over1 / frame.pixels < 1e-4,
      `${id}: frame matches the original: ${frame.differing} of ${frame.pixels} pixels differ (${percent} %), ` +
        `${frame.over1} by more than 1/255, largest ${frame.max}/255`,
    );
    console.log(`       HDR scene: ${scene.differing} of ${scene.values} values differ, by up to ${scene.max}`);
  }
  const gpuErrors = await chrome.page.evaluate(() => window.__abyssal.harness.gpuErrors());
  check(gpuErrors.length === 0, `no shader or validation errors${gpuErrors.length ? ': ' + gpuErrors.join('; ') : ''}`);
  check(chrome.errors.length === 0, `no console errors${chrome.errors.length ? ': ' + chrome.errors.join('; ') : ''}`);
} finally {
  await chrome.close();
  host.close();
}
finish();
