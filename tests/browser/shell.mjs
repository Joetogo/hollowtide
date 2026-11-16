// Drives the shipped page like a person: watches the descent while it loads, waits for the home view, dives with
// a key, has the eyes open, swims, opens the stats, jumps to a viewpoint, pauses. Saves screenshots to
// test-results/shell/ and checks that the page and the camera answered.
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { check, finish, launch, need, root, serve } from './lib.mjs';

const page = path.join(root, 'dist/index.harness.html');
need(page, 'run `npm run build:harness`');
const out = path.join(root, 'test-results/shell');
mkdirSync(out, { recursive: true });
const shot = (chrome, name) => chrome.page.screenshot({ path: path.join(out, name + '.png') });
const camera = (chrome) => chrome.page.evaluate(() => window.__hollowtide.harness.camera());

const host = await serve(page);
const chrome = await launch();
try {
  // every main-thread task over 50 ms while the page loads
  await chrome.page.addInitScript(() => {
    window.__longTasks = [];
    // the depth the descent shows, every time it changes, and each state the page goes through
    window.__depths = [];
    window.__states = [];
    addEventListener('DOMContentLoaded', () => {
      const depth = document.getElementById('depth');
      new MutationObserver(() => window.__depths.push(parseFloat(depth.textContent))).observe(depth, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      window.__states.push(document.body.className);
      new MutationObserver(() => window.__states.push(document.body.className)).observe(document.body, {
        attributes: true,
        attributeFilter: ['class'],
      });
    });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        window.__longTasks.push([Math.round(entry.startTime), Math.round(entry.duration)]);
    }).observe({ type: 'longtask', buffered: true });
  });
  const started = Date.now();
  const { error, report } = await chrome.open(host.origin + '/', { tuning: 'tuned' });
  const longTasks = await chrome.page.evaluate(() => window.__longTasks);
  const blocked = longTasks.reduce((sum, [, ms]) => sum + ms, 0);
  const longest = Math.max(0, ...longTasks.map(([, ms]) => ms));
  // (the observer is checked against a deliberate 120 ms of busy work, so that "none" means none)
  await chrome.page.evaluate(
    () =>
      new Promise((done) =>
        setTimeout(() => {
          const until = performance.now() + 120;
          while (performance.now() < until);
          done();
        }),
      ),
  );
  await chrome.page.waitForTimeout(200);
  const afterBusyWork = (await chrome.page.evaluate(() => window.__longTasks)).length;
  check(afterBusyWork === longTasks.length + 1, 'the long-task observer sees a deliberate 120 ms task');
  check(
    longest <= 50,
    `no main-thread task over 50 ms while loading (blocked ${blocked} ms in ${longTasks.length} long tasks, longest ${longest} ms)`,
  );
  check(
    !error,
    `starts and builds its world${error ? ': ' + error : ''} (${((Date.now() - started) / 1000).toFixed(1)} s, level ${report?.level})`,
  );
  // ---- the opening: the descent follows the loading down to where the swimmer wakes, then the home view
  await chrome.page.waitForFunction(() => document.body.className === 'home', null, { timeout: 15_000 });
  const depths = await chrome.page.evaluate(() => window.__depths);
  const sinking = depths.every((d, i) => i === 0 || d >= depths[i - 1]);
  check(
    depths.length > 10 && sinking && depths.at(-1) === 41.4,
    `while it loads, a diver sinks: the depth shown only ever grows, in ${depths.length} steps to ${depths.at(-1)} m`,
  );
  check(
    (await chrome.page.evaluate(() => window.__states.join(' > '))) === 'loading > home',
    'the home view comes up once the diver is out of sight',
  );
  await chrome.page.waitForTimeout(2200); // the black lifts
  await shot(chrome, '1-home');
  const drifting = await camera(chrome);
  await chrome.page.waitForTimeout(600);
  const drifted = await camera(chrome);
  check(
    Math.hypot(drifted.x - drifting.x, drifted.y - drifting.y, drifted.z - drifting.z) > 0.05,
    'the home view drifts through the world',
  );

  // ---- any of W A S D dives: the swimmer is put at the first viewpoint and their eyes open
  await chrome.page.keyboard.press('KeyD');
  check(await chrome.page.evaluate(() => document.body.className === 'waking'), 'D on the home view begins the dive');
  await chrome.page.waitForTimeout(900);
  await shot(chrome, '1-eyes-opening');
  await chrome.page.waitForFunction(() => document.body.className.startsWith('playing'), null, { timeout: 8000 });
  check(true, 'the eyes open and the swimmer is in the water');
  const before = await camera(chrome);
  const start = await chrome.page.evaluate(() => window.__hollowtide.harness.viewpoints()[0]);
  check(
    Math.hypot(before.x - start[0], before.y - start[1], before.z - start[2]) < 0.5,
    'they wake at the first viewpoint',
  );
  await chrome.page.keyboard.down('KeyW');
  await chrome.page.waitForTimeout(1500);
  await chrome.page.keyboard.up('KeyW');
  const swum = await camera(chrome);
  const moved = Math.hypot(swum.x - before.x, swum.y - before.y, swum.z - before.z);
  check(moved > 3 && moved < 12, `W swims forward: ${moved.toFixed(1)} m in 1.5 s`);
  await chrome.page.keyboard.press('KeyH');
  await chrome.page.waitForTimeout(1200);
  const stats = await chrome.page.evaluate(() => document.getElementById('stats').textContent);
  check(/fps/.test(stats), `H shows the stats line: ${stats}`);
  await shot(chrome, '2-swimming');

  // swim hard into the rock wall ahead: the camera must stay out of it
  await chrome.page.keyboard.down('ShiftLeft');
  await chrome.page.keyboard.down('KeyW');
  await chrome.page.waitForTimeout(3000);
  await chrome.page.keyboard.up('KeyW');
  await chrome.page.keyboard.up('ShiftLeft');
  const stopped = await camera(chrome);
  check(
    stopped.rockDistance <= -0.45,
    `sprinting at the rock, the camera stays outside it (${(-stopped.rockDistance).toFixed(2)} m clear)`,
  );
  await shot(chrome, '3-at-the-rock');

  // (a jump keeps the swimmer's speed, as in the original, so let it coast to a stop first)
  await chrome.page.waitForTimeout(2500);
  await chrome.page.keyboard.press('Digit2');
  await chrome.page.waitForTimeout(300);
  const jumped = await camera(chrome);
  check(
    Math.abs(jumped.x - 50) < 1 && Math.abs(jumped.z - 34) < 1,
    `key 2 jumps to the second viewpoint (now at ${jumped.x.toFixed(1)}, ${jumped.y.toFixed(1)}, ${jumped.z.toFixed(1)})`,
  );
  await shot(chrome, '4-viewpoint-2');

  // ---- the tour: the camera flies by itself until a swimming key takes over
  await chrome.page.keyboard.press('KeyT');
  await chrome.page.waitForTimeout(700);
  const touring = await camera(chrome);
  await chrome.page.waitForTimeout(700);
  const toured = await camera(chrome);
  const flown = Math.hypot(toured.x - touring.x, toured.y - touring.y, toured.z - touring.z);
  check(flown > 0.5, `T starts a tour: the camera flies by itself (${flown.toFixed(1)} m in 0.7 s)`);
  await chrome.page.keyboard.down('KeyS');
  await chrome.page.waitForTimeout(200);
  await chrome.page.keyboard.up('KeyS');
  await chrome.page.waitForTimeout(2500); // coasting to a stop
  const taken = await camera(chrome);
  await chrome.page.waitForTimeout(500);
  const still = await camera(chrome);
  check(
    Math.hypot(still.x - taken.x, still.y - taken.y, still.z - taken.z) < 0.05,
    'a swimming key ends the tour where it has got to',
  );

  // ---- photo mode: the moment stands still, and Enter saves a picture larger than the screen
  await chrome.page.keyboard.press('KeyP');
  await chrome.page.waitForTimeout(300);
  check(
    await chrome.page.evaluate(
      () =>
        document.body.classList.contains('photo') && /Enter saves/.test(document.getElementById('note').textContent),
    ),
    'P is photo mode, and says how to save',
  );
  const [download] = await Promise.all([
    chrome.page.waitForEvent('download', { timeout: 15_000 }),
    chrome.page.keyboard.press('Enter'),
  ]);
  const file = await download.path();
  const header = readFileSync(file);
  const [width, height] = [header.readUInt32BE(16), header.readUInt32BE(20)];
  check(
    /^hollowtide-.*\.png$/.test(download.suggestedFilename()) &&
      header.subarray(1, 4).toString() === 'PNG' &&
      width >= 2560 &&
      width * height <= 3840 * 2160,
    `Enter saves a picture: ${download.suggestedFilename()}, ${width} x ${height}`,
  );
  await chrome.page.waitForTimeout(400);
  const size = await chrome.page.evaluate(
    () =>
      window.__hollowtide.report && [document.getElementById('scene').width, document.getElementById('scene').height],
  );
  check(
    size[0] <= 1280 && size[1] <= 720,
    `and the screen is back at its own size afterwards (${size[0]} x ${size[1]})`,
  );
  await chrome.page.keyboard.press('KeyP');
  await chrome.page.waitForTimeout(200);
  check(await chrome.page.evaluate(() => !document.body.classList.contains('photo')), 'P again leaves photo mode');

  // ---- the swimmer breathes: within six seconds of any moment there has been a breath out
  await chrome.page.waitForFunction(() => window.__hollowtide.ownBubbles() > 10, null, { timeout: 7000 });
  check(
    true,
    `the swimmer breathes out: ${await chrome.page.evaluate(() => window.__hollowtide.ownBubbles())} of their own bubbles are rising`,
  );

  // ---- other ways to look and swim: the arrow keys, a held drag, a gamepad
  const turned = async (act) => {
    const before = await camera(chrome);
    await act();
    await chrome.page.waitForTimeout(350); // the view follows through two stages of smoothing
    const after = await camera(chrome);
    return [after.yaw - before.yaw, after.pitch - before.pitch];
  };
  const [arrowYaw] = await turned(async () => {
    await chrome.page.keyboard.down('ArrowRight');
    await chrome.page.waitForTimeout(400);
    await chrome.page.keyboard.up('ArrowRight');
  });
  check(arrowYaw > 0.2 && arrowYaw < 1.2, `the right arrow turns the view right (${arrowYaw.toFixed(2)} rad in 0.4 s)`);
  const [, arrowPitch] = await turned(async () => {
    await chrome.page.keyboard.down('ArrowUp');
    await chrome.page.waitForTimeout(300);
    await chrome.page.keyboard.up('ArrowUp');
  });
  check(arrowPitch > 0.1, `the up arrow looks up (${arrowPitch.toFixed(2)} rad)`);
  // (made by hand rather than with the mouse: a real click on the picture would capture the mouse)
  const [dragYaw] = await turned(() =>
    chrome.page.evaluate(() => {
      document.getElementById('scene').dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
      for (let i = 0; i < 10; i++) window.dispatchEvent(new MouseEvent('mousemove', { movementX: -20, buttons: 1 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      // and with the button up, moving the mouse does nothing
      for (let i = 0; i < 10; i++) window.dispatchEvent(new MouseEvent('mousemove', { movementX: 500, buttons: 0 }));
    }),
  );
  check(
    dragYaw < -0.3 && dragYaw > -0.6,
    `dragging on the picture looks around (${dragYaw.toFixed(2)} rad for 200 px)`,
  );

  // a gamepad, as the browser would report one: left stick forward, then the Start button
  const pad = (axes, pressed = []) =>
    chrome.page.evaluate(
      ([axes, pressed]) => {
        const buttons = Array.from({ length: 17 }, (_, i) => ({
          pressed: pressed.includes(i),
          value: +pressed.includes(i),
        }));
        navigator.getGamepads = () => (axes ? [{ connected: true, mapping: 'standard', axes, buttons }] : []);
      },
      [axes, pressed],
    );
  const padFrom = await camera(chrome);
  await pad([0, -1, 0, 0]);
  await chrome.page.waitForTimeout(1000);
  const padTo = await camera(chrome);
  const padSwum = Math.hypot(padTo.x - padFrom.x, padTo.y - padFrom.y, padTo.z - padFrom.z);
  check(padSwum > 1.5, `a gamepad's left stick swims (${padSwum.toFixed(1)} m in a second)`);
  await pad([0, 0, 0, 0], [9]);
  await chrome.page.waitForTimeout(300);
  check(await chrome.page.evaluate(() => document.body.className === 'menu'), 'its Start button pauses');
  await pad([0, 0, 0, 0]);
  await chrome.page.waitForTimeout(150);
  await pad([0, 0, 0, 0], [0]);
  await chrome.page.waitForTimeout(400);
  check(await chrome.page.evaluate(() => document.body.className.startsWith('playing')), 'and its A button resumes');
  await pad(null);
  await chrome.page.waitForTimeout(150);

  // ---- the sound button, for where there is no M key
  await chrome.page.click('#mute');
  const muted = await chrome.page.evaluate(() => [
    document.getElementById('mute').getAttribute('aria-pressed'),
    JSON.parse(localStorage.getItem('hollowtide')).muted,
  ]);
  check(muted[0] === 'true' && muted[1] === true, 'the sound button mutes, shows that it has, and it is remembered');
  await chrome.page.keyboard.press('KeyM');
  check(
    await chrome.page.evaluate(() => document.getElementById('mute').getAttribute('aria-pressed') === 'false'),
    'and the M key and the button stay in step',
  );

  // ---- the lamp
  await chrome.page.keyboard.press('KeyF');
  await chrome.page.waitForTimeout(200);
  check(
    await chrome.page.evaluate(() => document.getElementById('note').textContent === 'Lamp on'),
    'F switches the lamp on, and says so',
  );
  await chrome.page.keyboard.press('KeyF');
  await chrome.page.waitForTimeout(200);
  check(await chrome.page.evaluate(() => document.getElementById('note').textContent === 'Lamp off'), 'and off again');

  // ---- a link to this view
  await chrome.page.keyboard.press('KeyL');
  await chrome.page.waitForTimeout(300);
  const linked = await chrome.page.evaluate(() => [location.hash, document.getElementById('note').textContent]);
  const here = await camera(chrome);
  check(
    /^#at=[-\d.]+(,[-\d.]+){4}$/.test(linked[0]) && /link to this view/.test(linked[1]),
    `L puts a link to the view in the address: ${linked[0]}`,
  );
  const [lx, ly, lz] = linked[0].slice(4).split(',').map(Number);
  check(Math.hypot(lx - here.x, ly - here.y, lz - here.z) < 1.5, 'and it is where the swimmer is');

  await chrome.page.keyboard.press('Escape');
  await chrome.page.waitForTimeout(300);
  check(await chrome.page.evaluate(() => document.body.className === 'menu'), 'Esc pauses');
  // ---- settings in the pause panel take effect and are remembered
  await chrome.page.click('#picture button:nth-of-type(2)');
  await chrome.page.click('#swim button:nth-of-type(2)');
  await chrome.page.fill('#fov', '1.15');
  await chrome.page.dispatchEvent('#fov', 'input');
  const kept = await chrome.page.evaluate(() => JSON.parse(localStorage.getItem('hollowtide')));
  check(
    kept.sharp === true && kept.classic === true && kept.fov === 1.15,
    "the pause panel's settings are remembered (picture, swimming, field of view)",
  );
  await chrome.page.click('#swim button:nth-of-type(1)');
  check(
    await chrome.page.evaluate(() => document.getElementById('dive').textContent === 'Resume'),
    'the button now says Resume',
  );
  await chrome.page.click('#dive');
  await chrome.page.waitForTimeout(300);
  check(
    await chrome.page.evaluate(() => document.body.className.startsWith('playing')),
    'and resumes, with no second awakening',
  );

  const gpuErrors = await chrome.page.evaluate(() => window.__hollowtide.harness.gpuErrors());
  check(gpuErrors.length === 0, `no shader or validation errors${gpuErrors.length ? ': ' + gpuErrors.join('; ') : ''}`);
  check(chrome.errors.length === 0, `no console errors${chrome.errors.length ? ': ' + chrome.errors.join('; ') : ''}`);

  // ---- opened by a link to a view, the swimmer wakes there instead of at the first viewpoint
  const second = await chrome.page.evaluate(() => window.__hollowtide.harness.viewpoints()[1]);
  const at = `#at=${second[0].toFixed(1)},${second[1].toFixed(1)},${second[2].toFixed(1)},90,-10`;
  await chrome.open(host.origin + '/' + at, { tuning: 'tuned' });
  await chrome.page.waitForFunction(() => document.body.className === 'home', null, { timeout: 30_000 });
  await chrome.page.waitForFunction(() => window.__hollowtide.harness.collision, null, { timeout: 30_000 });
  await chrome.page.waitForTimeout(1500);
  await chrome.page.keyboard.press('Enter');
  await chrome.page.waitForFunction(() => document.body.className.startsWith('playing'), null, { timeout: 10_000 });
  const woke = await camera(chrome);
  check(
    Math.hypot(woke.x - second[0], woke.y - second[1], woke.z - second[2]) < 0.8 &&
      Math.abs(woke.yaw - Math.PI / 2) < 0.1,
    `a link to a view wakes the swimmer there (${at})`,
  );
  // and a link to a place inside the rock is not followed
  const first = await chrome.page.evaluate(() => window.__hollowtide.harness.viewpoints()[0]);
  const rock = await chrome.page.evaluate(() => {
    const h = window.__hollowtide.harness;
    for (let y = -50; y <= -20; y += 5)
      for (let x = -100; x <= 100; x += 10)
        for (let z = -100; z <= 100; z += 10) if (h.rockAt(x, y, z) > 0.9) return [x, y, z];
    return null;
  });
  check(!!rock, `(a place inside the rock: ${rock})`);
  await chrome.open(`${host.origin}/#at=${rock.join(',')},0,0`, { tuning: 'tuned' });
  await chrome.page.waitForFunction(() => document.body.className === 'home', null, { timeout: 30_000 });
  await chrome.page.waitForFunction(() => window.__hollowtide.harness.collision, null, { timeout: 30_000 });
  await chrome.page.waitForTimeout(1500);
  await chrome.page.keyboard.press('Enter');
  await chrome.page.waitForFunction(() => document.body.className.startsWith('playing'), null, { timeout: 10_000 });
  const stayed = await camera(chrome);
  check(
    Math.hypot(stayed.x - first[0], stayed.y - first[1], stayed.z - first[2]) < 0.8,
    'a link to a place inside the rock is not followed: the swimmer wakes at the first viewpoint',
  );
} finally {
  await chrome.close();
  host.close();
}
finish();
