// The one-time bakes against the original: the rock detail texture, the water texture and the sun shadow map.
// The shadow map is baked from the original's dumped world, so only Hollowtide's shaders and draw calls are
// under test. Needs the fixtures: `npm run ref:dump`.
import path from 'node:path';
import { check, finish, fixturesDir, launch, need, root, serve } from './lib.mjs';

const page = path.join(root, 'dist/index.harness.html');
const fixtures = fixturesDir(0);
need(page, 'run `npm run build:harness`');
need(path.join(fixtures, 'index.json'), 'run `npm run ref:dump`');

const host = await serve(page, fixtures);
const chrome = await launch();
const describe = (d) =>
  d.differing ? `${d.differing} of ${d.values} values differ, by up to ${d.max}` : `all ${d.values} values equal`;
try {
  const { error } = await chrome.open(host.origin + '/?world=none', { pause: true });
  check(!error, `starts${error ? ': ' + error : ''}`);
  const compare = (name, file) =>
    chrome.page.evaluate(
      ([name, file]) => window.__hollowtide.harness.compareTexture(name, '/fixtures/' + file),
      [name, file],
    );

  const detail = await compare('detail', 'tex_detail.bin');
  check(detail.max <= 1, `rock detail texture: ${describe(detail)} (in 1/255 steps)`);

  // the water texture depends only on time; the reference dump is from a frame at 2 s
  await chrome.page.evaluate(() => window.__hollowtide.harness.capture([10, -41.7, 7, -9, -31, -10], 2));
  const water = await compare('water', 'tex_water_t2.bin');
  check(water.max <= 1e-3, `water texture at 2 s: ${describe(water)}`);

  await chrome.page.evaluate(() => window.__hollowtide.harness.loadReferenceWorld('/fixtures/'));
  const shadow = await compare('shadow', 'tex_shadow.bin');
  check(shadow.max <= 1e-6, `shadow map baked from the original's world: ${describe(shadow)} (depth 0..1)`);

  const gpuErrors = await chrome.page.evaluate(() => window.__hollowtide.harness.gpuErrors());
  check(gpuErrors.length === 0, `no shader or validation errors${gpuErrors.length ? ': ' + gpuErrors.join('; ') : ''}`);
  check(chrome.errors.length === 0, `no console errors${chrome.errors.length ? ': ' + chrome.errors.join('; ') : ''}`);
} finally {
  await chrome.close();
  host.close();
}
finish();
