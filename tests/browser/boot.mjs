// Opens the built files from file:// in the installed Chrome and checks that they start and draw.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { check, finish, launch, need, root } from './lib.mjs';

const shipped = path.join(root, 'dist/index.html');
const harness = path.join(root, 'dist/index.harness.html');
need(shipped, 'run `npm run build`');
need(harness, 'run `npm run build:harness`');
const reference = JSON.parse(readFileSync(path.join(root, 'tests/unit/fixtures/reference-frames.json'), 'utf8'));

const chrome = await launch();
try {
  // the file that ships: starts from file:// and keeps drawing
  let { error, report } = await chrome.open(pathToFileURL(shipped).href);
  check(!error, `dist/index.html starts from file://${error ? ': ' + error : ''}`);
  if (report) check(true, `  device and renderer: ${report.adapter}, ${report.size.join('x')}`);
  await chrome.page.waitForTimeout(500);
  const frames = await chrome.page.evaluate(() => window.__abyssal.frames);
  check(frames > 5, `  frame loop is running (${frames} frames in the first half second)`);
  check(await chrome.page.evaluate(() => !window.__abyssal.harness), '  ships without the test hooks');

  // the harness build: the same code plus hooks
  ({ error, report } = await chrome.open(pathToFileURL(harness).href));
  check(!error, `dist/index.harness.html starts from file://${error ? ': ' + error : ''}`);
  const worker = report?.worker;
  check(
    worker?.detached && worker?.intact,
    `  worker: ${worker?.megabytes} MB transferred there and back intact (${worker?.roundTripMs.toFixed(1)} ms)`,
  );
  const frame = reference.frames[0];
  const shot = await chrome.page.evaluate(
    ([pose, time]) => window.__abyssal.harness.capture(pose, time),
    [reference.poses[frame.pose], frame.time],
  );
  const same =
    shot.uniforms.length === frame.uniforms.length && shot.uniforms.every((v, i) => Object.is(v, frame.uniforms[i]));
  check(same, `  frame uniforms in the browser equal the original's for ${frame.id} (${shot.width}x${shot.height})`);
  check(shot.png.length > 1000, '  a frame can be captured as PNG');
  const gpuErrors = await chrome.page.evaluate(() => window.__abyssal.harness.gpuErrors());
  check(
    gpuErrors.length === 0,
    `  no shader or validation errors${gpuErrors.length ? ': ' + gpuErrors.join('; ') : ''}`,
  );
  check(chrome.errors.length === 0, `no console errors${chrome.errors.length ? ': ' + chrome.errors.join('; ') : ''}`);
} finally {
  await chrome.close();
}
finish();
