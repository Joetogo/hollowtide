// Pictures of the swimmer's body, for looking at.
//   node tests/browser/body-shots.mjs [viewpoint 1-6, default 1]
// Saves to test-results/shots/:
//   body_stroke.png    twelve moments of a stroke, in reading order
//   body_others.png    at rest (three moments), the scooter coming up and held, looking down, looking up
//   body_<name>.png    a few of them full size
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { launch, need, root, serve } from './lib.mjs';

const page = path.join(root, 'dist/index.harness.html');
need(page, 'run `npm run build:harness`');
const viewpoint = +(process.argv[2] ?? 1) - 1;
const out = path.join(root, 'test-results/shots');
mkdirSync(out, { recursive: true });
const save = (name, png) => {
  const file = path.join(out, `body_${name}.png`);
  writeFileSync(file, Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
  console.log(path.relative(root, file));
};

const STROKE = Array.from({ length: 12 }, (_, i) => ({ swim: 1, phase: i / 12 }));
const OTHERS = [
  { swim: 0, scullClock: 0.6 },
  { swim: 0, scullClock: 2.4 },
  { swim: 0, scullClock: 4.2, scull: 1 },
  { equip: 0.72 },
  { equip: 1, throttle: 1, spin: 0.4 },
  { equip: 1, throttle: 1, spin: 1.3, swayX: 1.5 },
];
const FULL = {
  glide: { swim: 1, phase: 0 },
  catch: { swim: 1, phase: 0.36 },
  rest: { swim: 0, scullClock: 1.5 },
  scooter: { equip: 1, throttle: 1, spin: 0.4 },
};

const host = await serve(page);
const chrome = await launch();
try {
  const { error } = await chrome.open(host.origin + '/', { pause: true });
  if (error) throw new Error(error);
  /** Draws each state and tiles the frames, `columns` to a row, at a third of their size. */
  const sheet = (states, columns) =>
    chrome.page.evaluate(
      async ([viewpoint, states, columns]) => {
        const h = window.__hollowtide.harness;
        const pose = h.viewpoints()[viewpoint];
        let canvas, context, w, hgt;
        for (const [i, state] of states.entries()) {
          h.poseBody(state);
          const bitmap = await createImageBitmap(await (await fetch(h.capture(pose, 2).png)).blob());
          if (!canvas) {
            w = Math.round(bitmap.width / 2.4);
            hgt = Math.round(bitmap.height / 2.4);
            canvas = new OffscreenCanvas(w * columns, hgt * Math.ceil(states.length / columns));
            context = canvas.getContext('2d');
          }
          // the lower two thirds of the frame, where the body is
          context.drawImage(
            bitmap,
            0,
            0,
            bitmap.width,
            bitmap.height,
            (i % columns) * w,
            Math.floor(i / columns) * hgt,
            w,
            hgt,
          );
        }
        h.poseBody(null);
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      },
      [viewpoint, states, columns],
    );
  save('stroke', await sheet(STROKE, 4));
  save('others', await sheet(OTHERS, 3));
  for (const [name, state] of Object.entries(FULL)) {
    save(
      name,
      await chrome.page.evaluate(
        ([viewpoint, state]) => {
          const h = window.__hollowtide.harness;
          h.poseBody(state);
          const shot = h.capture(h.viewpoints()[viewpoint], 2);
          h.poseBody(null);
          return shot.png;
        },
        [viewpoint, state],
      ),
    );
  }
  const errors = await chrome.page.evaluate(() => window.__hollowtide.harness.gpuErrors());
  if (errors.length) console.log('GPU errors:\n  ' + errors.join('\n  '));
  if (chrome.errors.length) console.log('console errors:\n  ' + chrome.errors.join('\n  '));
} finally {
  await chrome.close();
  host.close();
}
