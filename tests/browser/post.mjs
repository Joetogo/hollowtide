// The bloom and composite passes against the original.
// A dumped HDR scene of the original is put where the rebuild's scene would be, then the rebuild's own bloom and
// composite run on it. The result must equal the frame the original made from the same scene (with its light
// shafts switched off, since the rebuild has none yet). Needs the fixtures: `npm run ref:dump`.
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
  const { error } = await chrome.open(host.origin + '/');
  check(!error, `starts${error ? ': ' + error : ''}`);
  for (const id of Object.keys(index.frames)) {
    const pose = index.meta.poses[+id[4] - 1];
    const time = +id.split('_t')[1];
    const result = await chrome.page.evaluate(
      async ([id, pose, time]) => {
        const h = window.__abyssal.harness;
        await h.holdReferenceScene('/fixtures/', id);
        const frame = await h.compareFrame(pose, time, `/fixtures/frame_${id}_noShafts.png`);
        const bloom = await h.compareTexture('bloom0', `/fixtures/hdr_${id}_bloom0.bin`);
        h.releaseScene();
        return { frame, bloom };
      },
      [id, pose, time],
    );
    const { frame, bloom } = result;
    check(
      bloom.differing === 0,
      `${id}: bloom equals the original's bit for bit` +
        (bloom.differing ? ` (${bloom.differing} of ${bloom.values} values differ, by up to ${bloom.max})` : ''),
    );
    check(
      frame.max <= 1 && frame.over1 === 0,
      `${id}: composited frame matches the original: ${frame.differing} of ${frame.pixels} pixels differ, by at most ${frame.max}/255`,
    );
  }
  const gpuErrors = await chrome.page.evaluate(() => window.__abyssal.harness.gpuErrors());
  check(gpuErrors.length === 0, `no shader or validation errors${gpuErrors.length ? ': ' + gpuErrors.join('; ') : ''}`);
  check(chrome.errors.length === 0, `no console errors${chrome.errors.length ? ': ' + chrome.errors.join('; ') : ''}`);
} finally {
  await chrome.close();
  host.close();
}
finish();
