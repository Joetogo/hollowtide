// What the page says for itself, and how its panel is worked: the lines a first dive is told, Esc into the panel
// and out of it, the line that comes up over a button, the gamepad in the panel, names for the viewpoints, a
// link that carries its light, and what a change of light leaves behind. Needs only the harness build.
import path from 'node:path';
import { check, finish, launch, need, root, serve } from './lib.mjs';

const page = path.join(root, 'dist/index.harness.html');
need(page, 'run `npm run build:harness`');

const host = await serve(page);
const chrome = await launch();
const camera = () => chrome.page.evaluate(() => window.__hollowtide.harness.camera());
const state = () => chrome.page.evaluate(() => document.body.className);
/** the line at the bottom of the picture, if one is up */
const note = () =>
  chrome.page.evaluate(() => {
    const line = document.getElementById('note');
    return line.className === 'on' ? line.textContent : '';
  });
const noteLike = (pattern, timeout) =>
  chrome.page
    .waitForFunction(
      (source) => {
        const line = document.getElementById('note');
        return line.className === 'on' && new RegExp(source).test(line.textContent);
      },
      pattern.source,
      { timeout },
    )
    .then(
      () => true,
      () => false,
    );
const stored = () => chrome.page.evaluate(() => JSON.parse(localStorage.getItem('hollowtide') ?? '{}'));
const inState = (name, timeout = 15_000) =>
  chrome.page.waitForFunction((name) => document.body.className.startsWith(name), name, { timeout });
const wait = (ms) => chrome.page.waitForTimeout(ms);
/** a gamepad as the browser would report one: these buttons down for a moment, then none */
const pad = async (...pressed) => {
  const set = (pressed) =>
    chrome.page.evaluate((pressed) => {
      const buttons = Array.from({ length: 17 }, (_, i) => ({
        pressed: pressed.includes(i),
        value: +pressed.includes(i),
      }));
      navigator.getGamepads = () => [{ connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons }];
    }, pressed);
  await set(pressed);
  await wait(170);
  await set([]);
  await wait(170);
};
const [A, B, START, UP, DOWN, RIGHT] = [0, 1, 9, 12, 13, 15];

try {
  // ---- a first dive is told the few things worth knowing, a line at a time, and only once
  await chrome.open(host.origin + '/?hints', { tuning: 'tuned' });
  await inState('home', 30_000);
  await chrome.page.keyboard.press('KeyW');
  await inState('playing');
  const told = [];
  for (const line of [/W A S D swim/, /Shift brings up a scooter/, /Esc opens the panel/]) {
    told.push(await noteLike(line, 16_000));
  }
  check(told.every(Boolean), `a first dive is told how to swim, of the scooter, and of the panel (${told.join(', ')})`);
  check((await stored()).hinted === true, 'and that it has been told is remembered');
  await chrome.open(host.origin + '/?hints', { tuning: 'tuned' });
  await inState('home', 30_000);
  await chrome.page.keyboard.press('KeyW');
  await inState('playing');
  await wait(2500); // (the first line came up three seconds after the dive)
  check(!/swim/.test(await note()), 'a later dive is not told again');

  // ---- keys that used to change something without a word
  await chrome.page.keyboard.press('Digit2');
  await wait(200);
  check((await note()) === '2 · The wreck', `a viewpoint key says where it has gone: "${await note()}"`);
  await chrome.page.keyboard.press('KeyM');
  await wait(200);
  const off = await note();
  await chrome.page.keyboard.press('KeyM');
  await wait(200);
  check(off === 'Sound off' && (await note()) === 'Sound on', 'M says that the sound is off, and on again');
  const low = await camera();
  await chrome.page.keyboard.down('Space');
  await wait(1000);
  await chrome.page.keyboard.up('Space');
  const high = await camera();
  check(high.y - low.y > 0.5, `Space goes up, like E (${(high.y - low.y).toFixed(1)} m in a second)`);

  // ---- Esc opens the panel, and closes it again
  await chrome.page.keyboard.press('KeyH');
  await wait(1300);
  const lateTotal = async () =>
    +/total (\d+)/.exec(await chrome.page.evaluate(() => document.getElementById('stats').textContent))[1];
  const lateBefore = await lateTotal();
  await chrome.page.keyboard.press('Escape');
  await chrome.page.keyboard.press('Escape'); // the same instant: this one is not a wish to go back
  await wait(250);
  check((await state()) === 'menu', 'Esc opens the panel (and a second one in the same instant leaves it open)');
  check((await note()) === '', 'the line that was up goes when the panel opens');
  await wait(2200);
  const lateInPanel = (await lateTotal()) - lateBefore;
  check(
    lateInPanel <= 2,
    `the stats line does not count the panel's halved pace as late frames (${lateInPanel} in two seconds)`,
  );
  await chrome.page.keyboard.press('KeyH');
  await chrome.page.keyboard.press('Escape');
  await wait(250);
  check((await state()).startsWith('playing'), 'Esc closes it again');
  await chrome.page.keyboard.press('Escape');
  await inState('menu');

  // ---- the panel: three sliders that are there, and every choice said as well as lit
  const sliders = await chrome.page.evaluate(() =>
    ['look', 'fov', 'volume'].map((id) => {
      const input = document.getElementById(id);
      return input.tagName === 'INPUT' && input.getBoundingClientRect().width > 100;
    }),
  );
  check(
    sliders.every(Boolean),
    `look speed, field of view and volume each have a slider on screen (${sliders.join(', ')})`,
  );
  await chrome.page.fill('#look', '1.5');
  await chrome.page.dispatchEvent('#look', 'input');
  check((await stored()).sensitivity === 1.5, 'the look-speed slider sets the look speed, and it is remembered');
  const said = await chrome.page.evaluate(() => ({
    rows: ['detail', 'light', 'invert', 'picture', 'swim'].map((id) => {
      const buttons = [...document.querySelectorAll(`#${id} button`)];
      return (
        buttons.filter((button) => button.getAttribute('aria-pressed') === 'true').length === 1 &&
        buttons.every((button) => (button.className === 'on') === (button.getAttribute('aria-pressed') === 'true'))
      );
    }),
    picture: document.getElementById('scene').getAttribute('aria-label'),
  }));
  check(
    said.rows.every(Boolean),
    'each row of choices says which one is chosen (aria-pressed), not only by its colour',
  );
  check(/underwater/.test(said.picture ?? ''), `the picture has a name: "${said.picture}"`);

  // ---- a line over a button says what it would do
  await chrome.page.hover('#light button:not(.on)');
  await wait(200);
  const remakes = await note();
  await chrome.page.hover('#picture button:not(.on)');
  await wait(200);
  const picture = await note();
  await chrome.page.hover('#dive');
  await wait(200);
  check(/makes the world again/.test(remakes), `another light says that it makes the world again: "${remakes}"`);
  check(/frames a second/.test(picture), `smooth and sharp say what they trade: "${picture}"`);
  check((await note()) === '', 'and the line goes when the pointer does');

  // ---- a gamepad in the panel: the d-pad goes from control to control and moves a slider, A presses, B leaves
  await chrome.page.mouse.move(640, 700);
  let steps = 0;
  const focused = () => chrome.page.evaluate(() => document.activeElement?.id || document.activeElement?.textContent);
  while ((await focused()) !== 'look' && steps++ < 14) await pad(DOWN);
  check((await focused()) === 'look', `the d-pad reaches the look-speed slider (${steps} steps down)`);
  await pad(RIGHT);
  check((await stored()).sensitivity === 1.6, 'right on the d-pad moves the slider');
  await pad(UP);
  check((await focused()) !== 'look', 'up goes back to the control before it');
  steps = 0;
  while ((await focused()) !== 'Inverted' && steps++ < 14) await pad(DOWN);
  await pad(A);
  check((await stored()).invertY === true, 'A presses the button the pad has gone to (up and down: inverted)');
  await chrome.page.click('#invert button:nth-of-type(1)');
  await pad(B);
  check((await state()).startsWith('playing'), 'B closes the panel');
  await pad(START);
  check((await state()) === 'menu', 'and Start opens it');
  check(/A presses/.test(await note()), `and a line says how a gamepad works the panel: "${await note()}"`);
  await pad(START);
  check((await state()).startsWith('playing'), 'and closes it');
  const order = await chrome.page.evaluate(() =>
    ['lamp', 'mute', 'open-menu'].map((id) => document.getElementById(id).getBoundingClientRect().left),
  );
  const inDocument = await chrome.page.evaluate(() =>
    [...document.querySelectorAll('#lamp, #mute, #open-menu')].map((button) => button.id).join(' '),
  );
  check(
    order[0] < order[1] && order[1] < order[2] && inDocument === 'lamp mute open-menu',
    'the three buttons in the corner are in the document in the order they stand in',
  );

  // ---- Esc during the tour is the panel like any other Esc, and the tour is over
  await chrome.page.keyboard.press('KeyT');
  await wait(900);
  await chrome.page.keyboard.press('Escape');
  await wait(250);
  check((await state()) === 'menu', 'Esc during the tour opens the panel');
  await wait(400);
  await chrome.page.keyboard.press('Escape');
  await wait(600);
  const stopped = await camera();
  await wait(500);
  const still = await camera();
  check(
    Math.hypot(still.x - stopped.x, still.y - stopped.y, still.z - stopped.z) < 0.05,
    'and back in the water the tour has ended: the camera stays where it is',
  );

  // ---- a picture saved and photo mode left at once: the line says it was saved, and then goes
  await chrome.page.keyboard.press('KeyP');
  await wait(300);
  const [download] = await Promise.all([
    chrome.page.waitForEvent('download', { timeout: 20_000 }),
    chrome.page.keyboard.press('Enter').then(() => chrome.page.keyboard.press('KeyP')),
  ]);
  await download.path();
  await wait(300);
  const savedLine = await note();
  await wait(5200);
  check(
    /^Saved, \d+ × \d+, the world alone$/.test(savedLine) && (await note()) === '',
    `a picture saved as photo mode is left is said to be saved ("${savedLine}"), and the line does not stay`,
  );

  // ---- a link to a view carries the light it was taken in, and the lamp
  await chrome.page.keyboard.press('KeyF');
  await chrome.page.keyboard.press('KeyL');
  await wait(300);
  const noonLink = await chrome.page.evaluate(() => location.hash);
  check(/^#at=[-\d.]+(,[-\d.]+){4},lamp$/.test(noonLink), `at noon with the lamp on, a link says so: ${noonLink}`);
  const second = await chrome.page.evaluate(() => window.__hollowtide.harness.viewpoints()[1]);
  const at = `#at=${second[0].toFixed(1)},${second[1].toFixed(1)},${second[2].toFixed(1)},90,-10,moon,lamp`;
  await chrome.open(host.origin + '/' + at, { tuning: 'tuned' });
  await inState('home', 30_000);
  await chrome.page.waitForFunction(() => window.__hollowtide.harness.collision, null, { timeout: 30_000 });
  const lit = () => chrome.page.evaluate(() => document.querySelector('#light [aria-pressed=true]').textContent);
  check(
    (await lit()) === 'Moonlit' && (await stored()).mood !== 'moon',
    'a link taken by moonlight is followed by moonlight, for this visit: what is remembered is left alone',
  );
  await wait(1500);
  await chrome.page.keyboard.press('Enter');
  await inState('playing');
  const woke = await camera();
  const lamp = await chrome.page.evaluate(() => document.getElementById('lamp').getAttribute('aria-pressed'));
  check(
    Math.hypot(woke.x - second[0], woke.y - second[1], woke.z - second[2]) < 0.8 && lamp === 'true',
    'the swimmer wakes at its place, with the lamp on as the link says',
  );
  await chrome.page.keyboard.press('KeyL');
  await wait(300);
  const moonLink = await chrome.page.evaluate(() => location.hash);
  check(/,moon,lamp$/.test(moonLink), `and a link made there says moonlight and the lamp: ${moonLink}`);

  // ---- another light, picked in the panel: the page starts over, and the panel is up again where one was
  await chrome.page.keyboard.press('KeyH');
  await chrome.page.keyboard.press('Digit3');
  await wait(400);
  const place = await camera();
  await chrome.page.keyboard.press('Escape');
  await inState('menu');
  await Promise.all([
    chrome.page.waitForNavigation({ timeout: 30_000 }),
    chrome.page.click('#light button:nth-of-type(1)'),
  ]);
  await chrome.page.waitForFunction(() => window.__hollowtide?.ready, null, { timeout: 60_000 });
  await inState('menu', 20_000);
  await wait(1200);
  const back = await chrome.page.evaluate(() => ({
    camera: window.__hollowtide.harness.camera(),
    hash: location.hash,
    stats: document.getElementById('stats').textContent,
    focus: document.activeElement?.id,
  }));
  check(
    (await lit()) === 'Noon' && back.hash === '',
    'picking noon after following a moonlit link: it is noon, and the link no longer says otherwise',
  );
  check(
    Math.hypot(back.camera.x - place.x, back.camera.y - place.y, back.camera.z - place.z) < 0.3 &&
      back.focus === 'dive',
    'the panel is up again, at the place the swimmer was, with Resume in focus',
  );
  check(/fps/.test(back.stats), `and the stats line is still on: ${back.stats.trim().slice(0, 40)}`);
  await chrome.page.keyboard.press('Enter');
  await wait(400);
  check((await state()).startsWith('playing'), 'Resume goes back into the water');

  const gpuErrors = await chrome.page.evaluate(() => window.__hollowtide.harness.gpuErrors());
  check(gpuErrors.length === 0, `no shader or validation errors${gpuErrors.length ? ': ' + gpuErrors.join('; ') : ''}`);
  check(chrome.errors.length === 0, `no console errors${chrome.errors.length ? ': ' + chrome.errors.join('; ') : ''}`);
} finally {
  await chrome.close();
  host.close();
}
finish();
