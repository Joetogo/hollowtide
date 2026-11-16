// The page on a phone: a touchscreen the size of one, lying on its side and held upright. That a tap dives, a
// held finger swims and a sliding one steers, that everything a key does that matters has a button, and that
// the pause panel fits on the screen.
import path from 'node:path';
import { check, finish, launch, need, root, serve } from './lib.mjs';

const page = path.join(root, 'dist/index.harness.html');
need(page, 'run `npm run build:harness`');
const camera = (chrome) => chrome.page.evaluate(() => window.__hollowtide.harness.camera());
const state = (chrome) => chrome.page.evaluate(() => document.body.className);

const host = await serve(page);
for (const [name, viewport] of [
  ['lying', { width: 844, height: 390 }],
  ['upright', { width: 390, height: 844 }],
]) {
  const chrome = await launch({ viewport, touch: true });
  try {
    const { error } = await chrome.open(host.origin + '/', { tuning: 'tuned' });
    check(!error, `${name}: starts${error ? ': ' + error : ''}`);
    const fingers = await chrome.page.context().newCDPSession(chrome.page);
    const touch = (type, points) => fingers.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    await chrome.page.waitForFunction(() => document.body.className === 'home', null, { timeout: 30_000 });
    await chrome.page.waitForTimeout(1800);
    const home = await chrome.page.evaluate(() => ({
      tap: getComputedStyle(document.getElementById('tap')).display !== 'none',
      keys: getComputedStyle(document.getElementById('press')).display !== 'none',
    }));
    check(home.tap && !home.keys, `${name}: the home view says "tap to dive", not which keys`);

    // ---- a tap dives
    await chrome.page.touchscreen.tap(viewport.width * 0.5, viewport.height * 0.3);
    await chrome.page.waitForFunction(() => document.body.className.startsWith('playing'), null, { timeout: 10_000 });
    check(true, `${name}: a tap dives`);
    await chrome.page.waitForTimeout(600);

    // ---- a held finger swims forward; sliding it steers (the screen's long side is always left to right)
    const [cx, cy] = [viewport.width / 2, viewport.height / 2];
    const before = await camera(chrome);
    await touch('touchStart', [{ x: cx, y: cy, id: 1 }]);
    await chrome.page.waitForTimeout(1200);
    const held = await camera(chrome);
    const swum = Math.hypot(held.x - before.x, held.y - before.y, held.z - before.z);
    check(swum > 1.5, `${name}: a held finger swims forward (${swum.toFixed(1)} m in 1.2 s)`);
    // along the screen's long side: to the right as the swimmer sees it
    const along = name === 'lying' ? [70, 0] : [0, 70];
    for (let i = 1; i <= 7; i++) {
      await touch('touchMove', [{ x: cx + (along[0] * i) / 7, y: cy + (along[1] * i) / 7, id: 1 }]);
      await chrome.page.waitForTimeout(40);
    }
    await chrome.page.waitForTimeout(500);
    const slid = await camera(chrome);
    check(
      slid.yaw - held.yaw > 0.15,
      `${name}: sliding the finger to the right turns right (${(slid.yaw - held.yaw).toFixed(2)} rad)`,
    );
    await touch('touchEnd', []);
    await chrome.page.waitForTimeout(2600);
    const [stopped, later] = [await camera(chrome), await chrome.page.waitForTimeout(400).then(() => camera(chrome))];
    check(
      Math.hypot(later.x - stopped.x, later.y - stopped.y, later.z - stopped.z) < 0.05 &&
        Math.abs(later.yaw - stopped.yaw) < 0.01,
      `${name}: lifting it stops the swimming and the turning`,
    );

    // ---- what a key does that matters has a button: sound, the lamp, the menu
    const corner = await chrome.page.evaluate(() =>
      ['mute', 'lamp', 'open-menu'].map((id) => {
        const r = document.getElementById(id).getBoundingClientRect();
        return (
          r.width > 20 && r.height > 20 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
        );
      }),
    );
    check(
      corner.every(Boolean),
      `${name}: sound, lamp and menu buttons are on the screen, each big enough for a finger`,
    );
    const tap = async (selector) => {
      const box = await chrome.page.evaluate((selector) => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return [r.left + r.width / 2, r.top + r.height / 2];
      }, selector);
      await chrome.page.touchscreen.tap(box[0], box[1]);
      await chrome.page.waitForTimeout(350);
    };
    await tap('#lamp');
    check(
      await chrome.page.evaluate(
        () =>
          document.getElementById('lamp').getAttribute('aria-pressed') === 'true' &&
          document.getElementById('note').textContent === 'Lamp on',
      ),
      `${name}: the lamp button switches the lamp on`,
    );
    await tap('#lamp');
    await tap('#mute');
    check(
      await chrome.page.evaluate(() => document.getElementById('mute').getAttribute('aria-pressed') === 'true'),
      `${name}: the sound button mutes`,
    );
    await tap('#mute');

    // ---- the pause panel fits, whichever way up the phone is
    await tap('#open-menu');
    check((await state(chrome)) === 'menu', `${name}: the menu button pauses`);
    await chrome.page.waitForTimeout(700);
    const panel = await chrome.page.evaluate(() => {
      const outside = [];
      for (const id of ['dive', 'detail', 'light', 'extras', 'settings', 'touch-hint']) {
        const r = document.getElementById(id).getBoundingClientRect();
        if (r.width < 10 || r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1)
          outside.push(id);
      }
      return { outside, keys: getComputedStyle(document.getElementById('keys')).display };
    });
    check(
      panel.outside.length === 0,
      `${name}: the whole pause panel is on the screen${panel.outside.length ? ' (not: ' + panel.outside.join(', ') + ')' : ''}`,
    );
    check(panel.keys === 'none', `${name}: and has a hint for fingers in place of the list of keys`);

    // ---- a tour and a photo, from the panel
    await tap('#tour');
    check((await state(chrome)).startsWith('playing'), `${name}: "a tour" closes the panel`);
    const [t0, t1] = [await camera(chrome), await chrome.page.waitForTimeout(700).then(() => camera(chrome))];
    check(Math.hypot(t1.x - t0.x, t1.y - t0.y, t1.z - t0.z) > 0.5, `${name}: and the tour flies`);
    await chrome.page.touchscreen.tap(cx, cy); // any touch takes over
    await chrome.page.waitForTimeout(400);
    await tap('#open-menu');
    await chrome.page.waitForTimeout(500);
    await tap('#photo');
    check(
      await chrome.page.evaluate(
        () =>
          document.body.classList.contains('photo') &&
          getComputedStyle(document.getElementById('photo-bar')).display === 'flex',
      ),
      `${name}: "a photo" is photo mode, with buttons to save and to go back`,
    );
    const [download] = await Promise.all([chrome.page.waitForEvent('download', { timeout: 20_000 }), tap('#save')]);
    check(
      /^hollowtide-.*\.png$/.test(download.suggestedFilename()),
      `${name}: its save button saves a picture (${download.suggestedFilename()})`,
    );
    await tap('#leave');
    check(
      await chrome.page.evaluate(() => !document.body.classList.contains('photo')),
      `${name}: and its back button leaves`,
    );

    const gpuErrors = await chrome.page.evaluate(() => window.__hollowtide.harness.gpuErrors());
    check(
      gpuErrors.length === 0,
      `${name}: no shader or validation errors${gpuErrors.length ? ': ' + gpuErrors[0] : ''}`,
    );
    check(
      chrome.errors.length === 0,
      `${name}: no console errors${chrome.errors.length ? ': ' + chrome.errors.join('; ') : ''}`,
    );
  } finally {
    await chrome.close();
  }
}
host.close();
finish();
