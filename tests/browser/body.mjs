// The swimmer's body: that it is drawn where and when it should be, changes nothing when it is not, and that
// swimming with it works in the live page (strokes, the scooter, the classic glide).
import path from 'node:path';
import { check, finish, launch, need, root, serve } from './lib.mjs';

const page = path.join(root, 'dist/index.harness.html');
need(page, 'run `npm run build:harness`');
const PART = { sleeveRight: 0, handRight: 1, sleeveLeft: 2, handLeft: 3, scooter: 4, propeller: 5 };

const host = await serve(page);
const chrome = await launch();
try {
  const { error } = await chrome.open(host.origin + '/', { pause: true });
  check(!error, `starts${error ? ': ' + error : ''}`);

  // ---- drawn into a frame: only the lower part of the picture changes, and nothing is left behind
  const drawn = await chrome.page.evaluate(async () => {
    const h = window.__hollowtide.harness;
    const pose = h.viewpoints()[0];
    const shot = (state) => {
      h.poseBody(state);
      const png = h.capture(pose, 2).png;
      h.poseBody(null);
      return png;
    };
    const share = async (a, b) => {
      // the share of pixels that differ, in the top third and the bottom third of the picture
      const decode = async (url) => {
        const bitmap = await createImageBitmap(await (await fetch(url)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d');
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const [x, y] = [await decode(a), await decode(b)];
      const band = (from, to) => {
        let n = 0;
        for (let i = from * x.width * 4; i < to * x.width * 4; i += 4)
          if (x.data[i] !== y.data[i] || x.data[i + 1] !== y.data[i + 1] || x.data[i + 2] !== y.data[i + 2]) n++;
        return n / ((to - from) * x.width);
      };
      const third = Math.floor(x.height / 3);
      return { top: band(0, third), bottom: band(x.height - third, x.height) };
    };
    const none = shot(null);
    const out = {};
    for (const [name, state] of Object.entries({
      glide: { swim: 1, phase: 0 },
      press: { swim: 1, phase: 0.4 },
      scooter: { equip: 1 },
    }))
      out[name] = await share(none, shot(state));
    out.clean = shot(null) === none;
    out.hidden = shot({ shown: 0, swim: 1 }) === none;
    return out;
  });
  for (const name of ['glide', 'press', 'scooter']) {
    const { top, bottom } = drawn[name];
    check(
      bottom > 0.04 && top < 0.002,
      `${name}: the body is in the lower part of the picture (${(bottom * 100).toFixed(1)} % of the bottom third changed, ${(top * 100).toFixed(2)} % of the top third)`,
    );
  }
  check(drawn.clean, 'a frame drawn after the body is taken away is the same as one drawn before it, to the bit');
  check(drawn.hidden, 'a body that is not shown draws nothing');

  // ---- what it costs: a frame with the body against one without, in turns
  const cost = await chrome.page.evaluate(async () => {
    const h = window.__hollowtide.harness;
    const pose = h.viewpoints()[0];
    const samples = [[], []];
    for (const side of [0, 1, 1, 0, 0, 1, 1, 0]) {
      h.poseBody(side ? { swim: 1, phase: 0.1 } : null);
      samples[side].push(...(await h.frameCost([pose], 28, 1280 * 720)).totalMs.slice(4));
    }
    h.poseBody(null);
    const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
    return { without: median(samples[0]), withBody: median(samples[1]) };
  });
  check(
    cost.withBody - cost.without < 1.5,
    `drawing the body costs ${(cost.withBody - cost.without).toFixed(2)} ms of a ${cost.without.toFixed(1)} ms frame`,
  );

  // ---- live: strokes, the scooter, the classic glide
  await chrome.page.evaluate(() => (window.__hollowtide.paused = false));

  const parts = () => chrome.page.evaluate(() => window.__hollowtide.harness.bodyParts());
  check((await parts()).length === 0, 'no body behind the menu');
  await chrome.page.waitForFunction(() => document.body.className === 'home', null, { timeout: 15_000 });
  await chrome.page.keyboard.press('KeyW');
  await chrome.page.waitForFunction(() => document.body.className.startsWith('playing'), null, { timeout: 8000 });
  await chrome.page.waitForTimeout(900);
  check(
    JSON.stringify(await parts()) ===
      JSON.stringify([PART.sleeveRight, PART.handRight, PART.sleeveLeft, PART.handLeft]),
    'in the water: two arms',
  );
  /**
   * The swimmer's speed in m/s at every frame for `seconds`: how far the camera moved between two animation
   * frames over the time between them, measured inside the page so that it does not depend on this script's timing.
   */
  const speeds = (seconds) =>
    chrome.page.evaluate(
      (seconds) =>
        new Promise((resolve) => {
          const h = window.__hollowtide.harness;
          const out = [];
          let last = null;
          const end = performance.now() + seconds * 1000;
          const tick = (t) => {
            const c = h.camera();
            if (last && t > last.t)
              out.push(Math.hypot(c.x - last.x, c.y - last.y, c.z - last.z) / ((t - last.t) / 1000));
            last = { x: c.x, y: c.y, z: c.z, t };
            if (t < end) requestAnimationFrame(tick);
            else resolve(out);
          };
          requestAnimationFrame(tick);
        }),
      seconds,
    );
  const goTo = (n) => chrome.page.keyboard.press('Digit' + n); // open water ahead of viewpoints 1 and 4
  await chrome.page.keyboard.down('KeyW');
  await chrome.page.waitForTimeout(1500);
  const stroking = await speeds(2.6);
  await chrome.page.keyboard.up('KeyW');
  const [low, high] = [Math.min(...stroking), Math.max(...stroking)];
  check(
    high > low * 1.4 && low > 1.5 && high < 16,
    `strokes carry the swimmer forward in surges: between ${low.toFixed(1)} and ${high.toFixed(1)} m/s`,
  );

  await chrome.page.waitForTimeout(1800);
  await goTo(4);
  await chrome.page.keyboard.down('ShiftLeft');
  await chrome.page.waitForTimeout(1400);
  const held = await parts();
  check(
    held.includes(PART.scooter) && held.includes(PART.propeller) && held.includes(PART.handRight),
    'Shift brings up the scooter',
  );
  const jet = await speeds(1.2);
  check(Math.max(...jet) > 20 && Math.max(...jet) < 27, `the scooter pulls: ${Math.max(...jet).toFixed(1)} m/s`);
  await chrome.page.keyboard.up('ShiftLeft');
  await chrome.page.waitForTimeout(1500);
  check(!(await parts()).includes(PART.scooter), 'letting go of Shift puts it away');

  await goTo(1);
  await chrome.page.keyboard.press('KeyC');
  await chrome.page.waitForTimeout(900);
  check((await parts()).length === 0, 'C: the classic glide has no body in view');
  await chrome.page.keyboard.down('KeyW');
  await chrome.page.waitForTimeout(1500);
  const glide = await speeds(1.2);
  await chrome.page.keyboard.up('KeyW');
  check(
    Math.max(...glide) < Math.min(...glide) * 1.25,
    `and a steady speed: between ${Math.min(...glide).toFixed(1)} and ${Math.max(...glide).toFixed(1)} m/s`,
  );
  await chrome.page.keyboard.press('KeyC');
  await chrome.page.waitForTimeout(900);
  check((await parts()).length === 4, 'C again: the arms are back');

  const errors = await chrome.page.evaluate(() => window.__hollowtide.harness.gpuErrors());
  check(errors.length === 0, `no shader or validation errors${errors.length ? ': ' + errors.join('; ') : ''}`);
  check(chrome.errors.length === 0, `no console errors${chrome.errors.length ? ': ' + chrome.errors.join('; ') : ''}`);
} finally {
  await chrome.close();
  host.close();
}
finish();
