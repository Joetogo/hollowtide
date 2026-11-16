// The pictures in the README.
//   npm run shots:readme        (builds the harness build, then writes docs/*.jpg)
// Each is one frame of the page itself at a fixed place and moment, drawn at twice the size and scaled down, so
// they can be made again whenever the look changes.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { launch, need, root, serve } from './lib.mjs';

const page = path.join(root, 'dist/index.harness.html');
need(page, 'run `npm run build:harness`');
const out = path.join(root, 'docs');
mkdirSync(out, { recursive: true });

/**
 * What to take in each light. `view` picks the place: a viewpoint by number, or something found in the world.
 * `body`: the swimmer's body as it is to be seen (see src/body/rig.ts), or none. `lamp`: switched on.
 */
const SHOTS = {
  noon: [
    { name: 'hero', view: { viewpoint: 1 }, time: 3, body: { swim: 1, phase: 0.08 } },
    { name: 'kelp', view: { viewpoint: 5 }, time: 3 },
    { name: 'wreck', view: { viewpoint: 2 }, time: 3 },
    { name: 'turtle', view: { turtle: 0 }, time: 6 },
    { name: 'scooter', view: { viewpoint: 4 }, time: 3, body: { equip: 1, throttle: 1, spin: 0.4, lean: 1 } },
    { name: 'legs', view: { down: 4 }, time: 3, body: { pitch: -1.31, kick: 1.6 } },
  ],
  dusk: [{ name: 'dusk', view: { viewpoint: 5 }, time: 3 }],
  moon: [
    { name: 'moon', view: { viewpoint: 1 }, time: 3 },
    { name: 'jellyfish', view: { jelly: true }, time: 3 },
    { name: 'lamp', view: { turtle: 0 }, time: 6, lamp: true },
  ],
};

const host = await serve(page);
for (const [mood, shots] of Object.entries(SHOTS)) {
  const chrome = await launch({ dpr: 2 });
  try {
    const { error } = await chrome.open(`${host.origin}/?mood=${mood}`, { pause: true, tuning: 'tuned' });
    if (error) throw new Error(error);
    await chrome.page.waitForFunction(() => window.__hollowtide.harness.turtles().length > 0, null, {
      timeout: 30_000,
    });
    for (const shot of shots) {
      const jpeg = await chrome.page.evaluate(async ({ view, time, body, lamp }) => {
        const h = window.__hollowtide.harness;
        let pose;
        if (view.viewpoint) pose = h.viewpoints()[view.viewpoint - 1];
        else if (view.down) {
          // from two and a half metres above a viewpoint, looking ahead and 75 degrees down
          const [x, y, z] = h.viewpoints()[view.down - 1];
          pose = [x, y + 2.5, z, x + 0.155, y + 2.5 - 0.966, z + 0.207];
        } else if (view.turtle !== undefined) {
          // where its loop has the turtle at this moment (src/life/turtle.ts), from ahead and to one side
          const [cx, cy, cz, R, phase, speed, size, second] = h.turtles().slice(view.turtle * 8, view.turtle * 8 + 8);
          const at = (t) => {
            const a = t * speed + phase;
            return [cx + R * Math.cos(a), cy + 1.1 * Math.sin(2 * a + second), cz + R * 0.8 * Math.sin(a)];
          };
          const [p, q] = [at(time), at(time + 0.5)];
          const length = Math.hypot(q[0] - p[0], q[2] - p[2]);
          const ahead = [(q[0] - p[0]) / length, (q[2] - p[2]) / length];
          const d = 2.2 * size;
          pose = [
            p[0] + (ahead[0] * 0.8 + ahead[1] * 0.55) * d,
            p[1] + 0.25 * d,
            p[2] + (ahead[1] * 0.8 - ahead[0] * 0.55) * d,
            ...p,
          ];
        } else {
          // the biggest jellyfish, from five of its radii away
          const j = h.jellies();
          let big = 0;
          for (let i = 0; i < j.length; i += 8) if (j[i + 3] > j[big + 3]) big = i;
          const [x, y, z, r] = j.slice(big, big + 4);
          pose = [x + r * 4.5, y - r * 0.6, z + r * 3.6, x, y - r * 1.3, z];
        }
        h.lamp(lamp ? 1 : 0);
        h.poseBody(body ?? null);
        const png = h.capture(pose, time).png;
        h.poseBody(null);
        h.lamp(0);
        // scaled down to 1600 wide and saved as a JPEG
        const bitmap = await createImageBitmap(await (await fetch(png)).blob());
        const canvas = new OffscreenCanvas(1600, Math.round((1600 * bitmap.height) / bitmap.width));
        const context = canvas.getContext('2d');
        context.imageSmoothingQuality = 'high';
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.86 });
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      }, shot);
      const file = path.join(out, `${shot.name}.jpg`);
      const bytes = Buffer.from(jpeg.slice(jpeg.indexOf(',') + 1), 'base64');
      writeFileSync(file, bytes);
      console.log(`${path.relative(root, file)}  ${(bytes.length / 1024).toFixed(0)} kB`);
    }
  } finally {
    await chrome.close();
  }
}
host.close();
