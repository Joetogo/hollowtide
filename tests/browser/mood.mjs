// Moods: the same world in another light. That picking one in the menu is remembered and takes effect in place
// (the page does not start over, and the swimmer stays where they are), that dusk and moonlight look as they are
// meant to against noon, that a light changed to gives the very picture a page started in it does, and that the
// shaders compile in each.
import path from 'node:path';
import { check, finish, launch, need, root, serve } from './lib.mjs';

const page = path.join(root, 'dist/index.harness.html');
need(page, 'run `npm run build:harness`');

/** Mean colour of the first viewpoint at one moment, 0..255 a channel. */
const look = (chrome) =>
  chrome.page.evaluate(async () => {
    const h = window.__hollowtide.harness;
    const bitmap = await createImageBitmap(await (await fetch(h.capture(h.viewpoints()[0], 2).png)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const sum = [0, 0, 0];
    for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += data[i + c];
    return { mean: sum.map((v) => v / (data.length / 4)), errors: h.gpuErrors() };
  });
/** The picture itself at that viewpoint and moment, to compare one with another to the last bit. */
const picture = (chrome) =>
  chrome.page.evaluate(() => {
    const h = window.__hollowtide.harness;
    return h.capture(h.viewpoints()[0], 2).png;
  });
/** Picks a light (1 noon, 2 dusk, 3 moonlit) and waits until the world is drawn in it; says how long that took. */
const pick = async (chrome, button, name) => {
  const from = Date.now();
  await chrome.page.click(`#light button:nth-of-type(${button})`);
  await chrome.page.waitForFunction((name) => window.__hollowtide.light === name, name, { timeout: 30_000 });
  return Date.now() - from;
};
const say = (mean) => mean.map((v) => v.toFixed(0)).join(', ');

const host = await serve(page);
const chrome = await launch();
try {
  const { error } = await chrome.open(host.origin + '/', { tuning: 'tuned' });
  check(!error, `starts${error ? ': ' + error : ''}`);
  await chrome.page.waitForFunction(() => document.body.className === 'home', null, { timeout: 30_000 });
  check(
    await chrome.page.evaluate(() => document.querySelector('#light .on')?.textContent === 'Noon'),
    'the light is noon unless another was chosen',
  );
  const noon = await look(chrome);
  const noonPicture = await picture(chrome);

  const seen = {};
  for (const [button, name, label] of [
    [2, 'dusk', 'Dusk'],
    [3, 'moon', 'Moonlit'],
  ]) {
    // picking a light changes it in place: the page does not start over (a mark left on it is still there)
    await chrome.page.evaluate(() => (window.__mark = true));
    const took = await pick(chrome, button, name);
    const state = await chrome.page.evaluate(() => ({
      error: window.__hollowtide.error,
      stored: JSON.parse(localStorage.getItem('hollowtide')).mood,
      lit: document.querySelector('#light .on')?.textContent,
      same: window.__mark === true,
    }));
    check(state.same, `${label}: the light changes in place, without starting the page over (${took} ms)`);
    check(!state.error, `${label}: no failure${state.error ? ': ' + state.error : ''}`);
    check(state.stored === name && state.lit === label, `${label}: picked in the menu, remembered, and lit there`);
    seen[name] = await look(chrome);
    check(
      seen[name].errors.length === 0,
      `${label}: no shader or validation errors${seen[name].errors[0] ? ': ' + seen[name].errors[0] : ''}`,
    );
  }
  // ---- the lamp, by moonlight: a pool of light on the seabed three metres below, and nothing changed when off
  const lamp = await chrome.page.evaluate(async () => {
    const h = window.__hollowtide.harness;
    const [x, y, z] = h.viewpoints()[0];
    const pose = [x, y, z, x + 0.4, y - 3, z + 0.2];
    const decode = async (url) => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height);
    };
    const off = h.capture(pose, 3).png;
    h.lamp(1);
    const on = await decode(h.capture(pose, 3).png);
    h.lamp(0);
    const offAgain = h.capture(pose, 3).png;
    const dark = await decode(off);
    // mean brightness of a patch a tenth of the picture across, at a place given as fractions of it
    const patch = (image, fx, fy) => {
      const { width, height, data } = image;
      const half = Math.floor(width / 20);
      let sum = 0;
      let n = 0;
      for (let py = Math.floor(fy * height) - half; py < fy * height + half; py++)
        for (let px = Math.floor(fx * width) - half; px < fx * width + half; px++) {
          if (px < 0 || py < 0 || px >= width || py >= height) continue;
          const i = (py * width + px) * 4;
          sum += data[i] + data[i + 1] + data[i + 2];
          n++;
        }
      return sum / n / 3;
    };
    return {
      same: off === offAgain,
      middle: [patch(dark, 0.5, 0.5), patch(on, 0.5, 0.5)],
      corner: [patch(dark, 0.04, 0.06), patch(on, 0.04, 0.06)],
      errors: h.gpuErrors(),
    };
  });
  check(
    lamp.middle[1] > lamp.middle[0] + 60,
    `the lamp lights the seabed in front of it: the middle of the picture goes from ${lamp.middle[0].toFixed(0)} to ${lamp.middle[1].toFixed(0)}`,
  );
  check(
    lamp.corner[1] < lamp.corner[0] + 12,
    `and not what is outside its cone: a corner goes from ${lamp.corner[0].toFixed(0)} to ${lamp.corner[1].toFixed(0)}`,
  );
  check(lamp.same, 'switched off again, the picture is what it was to the last bit');
  check(
    lamp.errors.length === 0,
    `no shader or validation errors with the lamp${lamp.errors[0] ? ': ' + lamp.errors[0] : ''}`,
  );

  const [r0, g0, b0] = noon.mean;
  const [r1, g1, b1] = seen.dusk.mean;
  const [r2, g2, b2] = seen.moon.mean;
  check(
    r1 / g1 > (r0 / g0) * 1.5 && b1 > g1,
    `dusk is violet where noon is blue-green: mean colour ${say(seen.dusk.mean)} against noon's ${say(noon.mean)}`,
  );
  check(
    r2 + g2 + b2 < (r0 + g0 + b0) * 0.62 && b2 > g2 * 1.25,
    `moonlight is dark and blue: mean colour ${say(seen.moon.mean)}`,
  );

  // and back
  await pick(chrome, 1, 'noon');
  const again = await look(chrome);
  check(
    again.mean.every((v, i) => Math.abs(v - noon.mean[i]) < 0.5) &&
      (await chrome.page.evaluate(() => JSON.parse(localStorage.getItem('hollowtide')).mood === undefined)),
    `back at noon the picture is noon's again (${say(again.mean)})`,
  );
  check(
    (await picture(chrome)) === noonPicture,
    'to the last bit: the shaders made again for noon are the ones it started with',
  );

  // ---- a light changed to is the light a page started in it has: the same picture, to the last bit
  await pick(chrome, 2, 'dusk');
  const changedTo = await picture(chrome);
  await chrome.page.reload();
  await chrome.page.waitForFunction(() => window.__hollowtide?.ready, null, { timeout: 60_000 });
  await chrome.page.waitForFunction(() => document.body.className === 'home', null, { timeout: 30_000 });
  const startedIn = await chrome.page.evaluate(() => ({
    light: window.__hollowtide.light,
    lit: document.querySelector('#light .on')?.textContent,
  }));
  check(
    startedIn.light === 'dusk' && startedIn.lit === 'Dusk',
    'the light picked is the light the page starts in next time',
  );
  check(
    (await picture(chrome)) === changedTo,
    'and dusk changed to in place is the same picture as dusk started in, to the last bit',
  );
  // two picked one straight after the other: the one picked last is the one that stays
  await chrome.page.click('#light button:nth-of-type(3)');
  await chrome.page.click('#light button:nth-of-type(1)');
  await chrome.page.waitForFunction(() => window.__hollowtide.light === 'noon', null, { timeout: 30_000 });
  await chrome.page.waitForTimeout(1500);
  check(
    (await chrome.page.evaluate(
      () => window.__hollowtide.light === 'noon' && document.querySelector('#light .on').textContent === 'Noon',
    )) && (await picture(chrome)) === noonPicture,
    'two lights picked one straight after the other end at the one picked last',
  );

  // ---- changing the light while in the water: the panel stays up, the swimmer stays where they are
  await chrome.page.waitForTimeout(1500);
  await chrome.page.keyboard.press('KeyW');
  await chrome.page.waitForFunction(() => document.body.className.startsWith('playing'), null, { timeout: 10_000 });
  await chrome.page.keyboard.press('Digit4');
  await chrome.page.keyboard.press('KeyF'); // the lamp on, to see that it is still on afterwards
  await chrome.page.waitForTimeout(400);
  const place = await chrome.page.evaluate(() => window.__hollowtide.harness.camera());
  await chrome.page.keyboard.press('Escape');
  await chrome.page.waitForFunction(() => document.body.className === 'menu', null, { timeout: 5000 });
  await chrome.page.evaluate(() => (window.__mark = true));
  const took = await pick(chrome, 2, 'dusk');
  const back = await chrome.page.evaluate(() => ({
    camera: window.__hollowtide.harness.camera(),
    mood: JSON.parse(localStorage.getItem('hollowtide')).mood,
    lamp: document.getElementById('lamp').getAttribute('aria-pressed'),
    state: document.body.className,
    same: window.__mark === true,
    lit: document.querySelector('#light .on')?.textContent,
  }));
  const moved = Math.hypot(back.camera.x - place.x, back.camera.y - place.y, back.camera.z - place.z);
  check(
    back.mood === 'dusk' && back.lit === 'Dusk' && back.same && back.state === 'menu',
    `picking dusk in the panel while in the water: it is dusk ${took} ms later, the panel still up, the page not started over`,
  );
  check(
    moved < 0.01 && back.lamp === 'true',
    `the swimmer is where they were (${moved.toFixed(3)} m from the place), the lamp as it was`,
  );
  await chrome.page.click('#dive');
  await chrome.page.waitForTimeout(400);
  check(
    await chrome.page.evaluate(() => document.body.className.startsWith('playing')),
    'and Resume goes back into the water',
  );
  const errors = await chrome.page.evaluate(() => window.__hollowtide.harness.gpuErrors());
  check(
    errors.length === 0,
    `no shader or validation errors after the changes of light${errors[0] ? ': ' + errors[0] : ''}`,
  );

  check(chrome.errors.length === 0, `no console errors${chrome.errors.length ? ': ' + chrome.errors.join('; ') : ''}`);
} finally {
  await chrome.close();
  host.close();
}
finish();
