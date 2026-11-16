// Drives the shipped page like a person: waits for the menu, dives, swims, opens the stats, jumps to a viewpoint,
// returns to the menu. Saves screenshots to test-results/shell/ and checks that the camera answered.
import { mkdirSync } from 'node:fs';
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
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        window.__longTasks.push([Math.round(entry.startTime), Math.round(entry.duration)]);
    }).observe({ type: 'longtask', buffered: true });
  });
  const started = Date.now();
  const { error, report } = await chrome.open(host.origin + '/');
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
  check(await chrome.page.evaluate(() => document.body.className === 'menu'), 'the menu is showing');
  await chrome.page.waitForTimeout(2500); // the canvas fades in behind the menu
  await shot(chrome, '1-menu');

  const before = await camera(chrome);
  await chrome.page.click('#dive');
  await chrome.page.waitForTimeout(300);
  check(await chrome.page.evaluate(() => document.body.className.startsWith('playing')), 'Dive in closes the menu');
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

  await chrome.page.keyboard.press('Escape');
  await chrome.page.waitForTimeout(300);
  check(await chrome.page.evaluate(() => document.body.className === 'menu'), 'Esc opens the menu again');
  check(
    await chrome.page.evaluate(() => document.getElementById('dive').textContent === 'Resume'),
    'the button now says Resume',
  );

  const gpuErrors = await chrome.page.evaluate(() => window.__hollowtide.harness.gpuErrors());
  check(gpuErrors.length === 0, `no shader or validation errors${gpuErrors.length ? ': ' + gpuErrors.join('; ') : ''}`);
  check(chrome.errors.length === 0, `no console errors${chrome.errors.length ? ': ' + chrome.errors.join('; ') : ''}`);
} finally {
  await chrome.close();
  host.close();
}
finish();
