// Swimming against the original: the same scripted input, frame by frame, must move the camera along the same
// path, through easing, turning, a capped time step and sliding along rock. Hollowtide swims in the world it
// generated itself. Needs a reference capture: `npm run ref:capture`.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { check, finish, launch, need, root, serve, shotsDir } from './lib.mjs';

const page = path.join(root, 'dist/index.harness.html');
need(page, 'run `npm run build:harness`');
const traceFile = path.join(shotsDir(0), '../trace.json');
need(traceFile, 'run `npm run ref:capture`');
const reference = JSON.parse(readFileSync(traceFile, 'utf8'));
const manifest = JSON.parse(readFileSync(path.join(shotsDir(0), '../manifest.json'), 'utf8'));

const host = await serve(page);
const chrome = await launch();
try {
  const { error } = await chrome.open(host.origin + '/', { pause: true });
  check(!error, `starts and builds its world${error ? ': ' + error : ''}`);
  const viewpoints = await chrome.page.evaluate(() => window.__hollowtide.harness.viewpoints());
  const samePoses = JSON.stringify(viewpoints) === JSON.stringify(manifest.meta.poses);
  check(samePoses, "the six viewpoints stand on the generated seabed exactly where the original's do");

  const { script } = reference;
  const mine = await chrome.page.evaluate(
    ([pose, steps]) => window.__hollowtide.harness.trace(pose, steps),
    [viewpoints[script.pose], script.steps],
  );
  let worst = 0,
    at = -1;
  for (let i = 0; i < reference.path.length; i++) {
    const d = Math.abs(mine[i] - reference.path[i]);
    if (d > worst) [worst, at] = [d, i];
  }
  const end = reference.path
    .slice(-5)
    .map((v) => v.toFixed(2))
    .join(', ');
  const far = Math.hypot(
    reference.path.at(-5) - reference.path[0],
    reference.path.at(-4) - reference.path[1],
    reference.path.at(-3) - reference.path[2],
  );
  check(
    mine.length === reference.path.length && worst === 0,
    `${script.steps.length} frames of scripted swimming trace the original's path exactly` +
      (worst
        ? ` (largest difference ${worst} at step ${Math.floor(at / 5)}, value ${at % 5})`
        : ` (it ends ${far.toFixed(1)} m away, at ${end})`),
  );
  check(chrome.errors.length === 0, `no console errors${chrome.errors.length ? ': ' + chrome.errors.join('; ') : ''}`);
} finally {
  await chrome.close();
  host.close();
}
finish();
if (!existsSync(traceFile)) process.exitCode = 2;
