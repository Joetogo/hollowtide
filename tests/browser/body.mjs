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
  const { error } = await chrome.open(host.origin + '/', { pause: true, tuning: 'tuned' });
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

  // ---- the legs: there for a swimmer who hangs upright and looks down, and behind one who swims
  const legs = await chrome.page.evaluate(async () => {
    const h = window.__hollowtide.harness;
    const [x, y, z] = h.viewpoints()[3];
    // from two and a half metres above the fourth viewpoint, looking ahead and 75 degrees down
    const pose = [x, y + 2.5, z, x + 0.155, y + 2.5 - 0.966, z + 0.207];
    const decode = async (url) => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height);
    };
    const shot = async (state) => {
      h.poseBody(state);
      const image = await decode(h.capture(pose, 3).png);
      h.poseBody(null);
      return image;
    };
    // the share of the lower middle of the picture, where legs would be, that differs between two pictures
    const share = (a, b) => {
      const { width, height } = a;
      let [n, total] = [0, 0];
      for (let py = Math.floor(height * 0.45); py < height; py++)
        for (let px = Math.floor(width * 0.3); px < width * 0.7; px++) {
          const i = (py * width + px) * 4;
          total++;
          if (
            Math.abs(a.data[i] - b.data[i]) +
              Math.abs(a.data[i + 1] - b.data[i + 1]) +
              Math.abs(a.data[i + 2] - b.data[i + 2]) >
            12
          )
            n++;
        }
      return n / total;
    };
    // The arms do not depend on which way the swimmer looks, the legs do: the same body told that it looks
    // level has the same arms and no legs in the picture.
    const upright = share(await shot({ pitch: -1.31, kick: 1 }), await shot({ pitch: 0, kick: 1 }));
    const swimming = { lean: 1, swim: 1, phase: 0 };
    const prone = share(await shot({ pitch: -1.31, ...swimming }), await shot({ pitch: 0, ...swimming }));
    return { upright, prone, errors: h.gpuErrors() };
  });
  check(
    legs.upright > 0.2,
    `upright and looking down, the swimmer sees their legs: ${(legs.upright * 100).toFixed(0)} % of the lower middle of the picture`,
  );
  check(legs.prone === 0, `swimming, they trail behind out of sight (${(legs.prone * 100).toFixed(1)} % of it)`);
  check(
    legs.errors.length === 0,
    `no shader or validation errors with the legs${legs.errors[0] ? ': ' + legs.errors[0] : ''}`,
  );

  // ---- what it costs: a frame with the body against one without. A warm laptop slows down and speeds up from
  // one second to the next, so the two are timed in short turns side by side, and what counts is the difference
  // within each pair of turns, not between two pools of frames taken at different temperatures.
  const cost = await chrome.page.evaluate(async () => {
    const h = window.__hollowtide.harness;
    const pose = h.viewpoints()[0];
    const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
    const turn = async (withBody) => {
      h.poseBody(withBody ? { swim: 1, phase: 0.1 } : null);
      return median((await h.frameCost([pose], 9, 1280 * 720)).totalMs.slice(3));
    };
    const differences = [];
    const frames = [];
    for (let round = 0; round < 24; round++) {
      // without, with; then with, without: whichever comes second in a warming machine is not always the same one
      const first = await turn(round % 2 === 1);
      const second = await turn(round % 2 === 0);
      const [without, withBody] = round % 2 ? [second, first] : [first, second];
      differences.push(withBody - without);
      frames.push(without);
    }
    h.poseBody(null);
    return { extra: median(differences), frame: median(frames) };
  });
  check(
    // (it measures at 0 to 3 % of a frame; the limit is there to catch it going badly wrong, on a machine whose
    // own speed moves by more than that while this runs)
    cost.extra < Math.max(2, cost.frame * 0.12),
    `drawing the body costs ${cost.extra.toFixed(2)} ms of a ${cost.frame.toFixed(1)} ms frame`,
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
            // (over a tenth of a second at a time: a machine that draws every second frame the screen asks
            // for moves the camera every second time this is called)
            if (!last || t - last.t >= 100) {
              const c = h.camera();
              if (last) out.push(Math.hypot(c.x - last.x, c.y - last.y, c.z - last.z) / ((t - last.t) / 1000));
              last = { x: c.x, y: c.y, z: c.z, t };
            }
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
  const said = await chrome.page.evaluate(() => {
    const note = document.getElementById('note');
    return note.className === 'on' ? note.textContent : '';
  });
  check(/no arms/.test(said) && /C brings/.test(said), `and the page says so: "${said}"`);
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
