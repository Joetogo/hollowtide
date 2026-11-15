// Saves frames from the rebuild (drawing the original's dumped world) to test-results/shots/, for looking at.
//   node tests/browser/shots.mjs [time in seconds, default 2]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fixturesDir, launch, need, root, serve } from './lib.mjs';

const page = path.join(root, 'dist/index.harness.html');
const fixtures = fixturesDir(0);
need(page, 'run `npm run build:harness`');
need(path.join(fixtures, 'index.json'), 'run `npm run ref:dump`');
const index = JSON.parse(readFileSync(path.join(fixtures, 'index.json'), 'utf8'));
const time = +(process.argv[2] ?? 2);
const out = path.join(root, 'test-results/shots');
mkdirSync(out, { recursive: true });

const host = await serve(page, fixtures);
const chrome = await launch();
try {
  await chrome.open(host.origin + '/', { pause: true });
  await chrome.page.evaluate(() => window.__abyssal.harness.loadReferenceWorld('/fixtures/'));
  for (const [i, pose] of index.meta.poses.entries()) {
    const shot = await chrome.page.evaluate(
      ([pose, time]) => window.__abyssal.harness.capture(pose, time),
      [pose, time],
    );
    const file = path.join(out, `rebuild_pose${i + 1}_t${time}.png`);
    writeFileSync(file, Buffer.from(shot.png.slice(shot.png.indexOf(',') + 1), 'base64'));
    console.log(path.relative(root, file));
  }
} finally {
  await chrome.close();
  host.close();
}
