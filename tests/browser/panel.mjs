// What the page says for itself, and how its panel is worked: the lines a first dive is told, Esc into the panel
// and out of it, the line that comes up over a button, the gamepad in the panel, names for the viewpoints, a
// link that carries its light, what a change of light leaves behind, the frame rate and the resolution fixed, what
// a photograph can be given, and keys chosen. Needs only the harness build.
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
  // (and a press a third of a second after the one that opened it is a press of its own)
  await chrome.page.keyboard.press('Escape');
  await wait(330);
  await chrome.page.keyboard.press('Escape');
  await wait(250);
  check((await state()).startsWith('playing'), 'a second Esc a third of a second after the first closes it too');
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
  await chrome.page.hover('#detail button:not(.on)');
  await wait(200);
  const remakes = await note();
  await chrome.page.hover('#light button:not(.on)');
  await wait(200);
  const light = await note();
  await chrome.page.hover('#picture button:not(.on)');
  await wait(200);
  const picture = await note();
  await chrome.page.hover('#dive');
  await wait(200);
  check(/makes the world again/.test(remakes), `another detail level says that it makes the world again: "${remakes}"`);
  check(light === '', 'another light says nothing: it no longer does');
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

  // ---- in photo mode the moment stands still, and can be run back and on to choose it
  const moment = () => chrome.page.evaluate(() => window.__hollowtide.moment);
  const held = async (key, ms) => {
    await chrome.page.keyboard.down(key);
    await wait(ms);
    await chrome.page.keyboard.up(key);
    await wait(120);
  };
  await chrome.page.keyboard.press('KeyP');
  await wait(300);
  const m0 = await moment();
  await wait(500);
  const m1 = await moment();
  await held('KeyX', 700);
  const m2 = await moment();
  await wait(400);
  const m3 = await moment();
  await held('KeyZ', 700);
  const m4 = await moment();
  check(m1 === m0, 'in photo mode the moment stands still');
  check(
    m2 - m1 > 0.25 && m2 - m1 < 0.65 && m3 === m2,
    `X runs it on while held (${(m2 - m1).toFixed(2)} s of the world in 0.7 s), and let go it stands again`,
  );
  check(m2 - m4 > 0.25, `Z runs it back (${(m2 - m4).toFixed(2)} s)`);
  const later = await chrome.page.locator('#later').boundingBox();
  await chrome.page.mouse.move(later.x + later.width / 2, later.y + later.height / 2);
  await chrome.page.mouse.down();
  await wait(600);
  await chrome.page.mouse.up();
  await wait(120);
  const m5 = await moment();
  check(m5 - m4 > 0.2, `and so does its button, while it is pressed (${(m5 - m4).toFixed(2)} s)`);
  await chrome.page.keyboard.press('KeyP');
  await wait(200);
  check(
    /Its moment: back/.test(await chrome.page.evaluate(() => document.getElementById('keys').textContent)),
    'the list of keys has them',
  );

  // ---- asked for less motion, the tour flies the same way at half its pace, and says that the view moves
  const stretch = async (from, to) => {
    await chrome.page.keyboard.press('KeyT');
    const line = await chrome.page.evaluate(() => document.getElementById('note').textContent);
    await wait(from);
    const a = await camera();
    await wait(to - from);
    const b = await camera();
    await chrome.page.keyboard.press('Escape');
    await wait(450);
    await chrome.page.keyboard.press('Escape');
    await wait(450);
    return [Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), line];
  };
  const [usual, usualLine] = await stretch(1500, 3000);
  await chrome.page.emulateMedia({ reducedMotion: 'reduce' });
  const [slow, slowLine] = await stretch(3000, 6000);
  await chrome.page.emulateMedia({ reducedMotion: null });
  check(
    Math.abs(slow / usual - 1) < 0.2,
    `with less motion asked for, the tour covers the same stretch in twice the time (${usual.toFixed(1)} m in 1.5 s, ${slow.toFixed(1)} m in 3 s)`,
  );
  check(
    /slow tour.*moves by itself/.test(slowLine) && !/slow/.test(usualLine),
    `and says so beforehand: "${slowLine}"`,
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

  // ---- another light, picked in the panel after following a link that names one: it takes over from the link
  await chrome.page.keyboard.press('Escape');
  await inState('menu');
  await chrome.page.evaluate(() => (window.__mark = true));
  await chrome.page.click('#light button:nth-of-type(1)');
  await chrome.page.waitForFunction(() => window.__hollowtide.light === 'noon', null, { timeout: 30_000 });
  check(
    (await lit()) === 'Noon' &&
      (await chrome.page.evaluate(
        () => location.hash === '' && window.__mark === true && document.body.className === 'menu',
      )),
    'picking noon after following a moonlit link: it is noon, in place, and the link no longer says otherwise',
  );
  await wait(300); // (the light changes in less time than an Esc straight after the one that opened the panel is ignored for)
  await chrome.page.keyboard.press('Escape');
  await inState('playing');

  // ---- another detail level is another world: the page starts over, and the panel is up again where one was
  await chrome.page.keyboard.press('KeyH');
  await chrome.page.keyboard.press('Digit3');
  await wait(400);
  const place = await camera();
  await chrome.page.keyboard.press('Escape');
  await inState('menu');
  await Promise.all([chrome.page.waitForNavigation({ timeout: 30_000 }), chrome.page.click('#detail button:not(.on)')]);
  await chrome.page.waitForFunction(() => window.__hollowtide?.ready, null, { timeout: 60_000 });
  await inState('menu', 20_000);
  await wait(1200);
  const back = await chrome.page.evaluate(() => ({
    camera: window.__hollowtide.harness.camera(),
    stats: document.getElementById('stats').textContent,
    focus: document.activeElement?.id,
  }));
  check(
    Math.hypot(back.camera.x - place.x, back.camera.y - place.y, back.camera.z - place.z) < 0.3 &&
      back.focus === 'dive',
    'after another detail level the panel is up again, at the place the swimmer was, with Resume in focus',
  );
  check(/fps/.test(back.stats), `and the stats line is still on: ${back.stats.trim().slice(0, 40)}`);
  await chrome.page.keyboard.press('Enter');
  await wait(400);
  check((await state()).startsWith('playing'), 'Resume goes back into the water');

  // ---- how many frames a second are drawn, and how many pixels, can be fixed in the panel
  const frames = () => chrome.page.evaluate(() => window.__hollowtide.frames);
  const pace = async (ms) => {
    const [from, start] = [await frames(), Date.now()];
    await wait(ms);
    return (((await frames()) - from) * 1000) / (Date.now() - start);
  };
  /** opens the panel, presses the nth button of a row, closes it; says whether smooth or sharp could be pressed */
  const choose = async (row, nth) => {
    await chrome.page.keyboard.press('Escape');
    await inState('menu');
    await chrome.page.click(`#${row} button:nth-of-type(${nth})`);
    await wait(300);
    const open = await chrome.page.evaluate(() =>
      [...document.querySelectorAll('#picture button')].every((button) => !button.disabled),
    );
    await chrome.page.keyboard.press('Escape');
    await inState('playing');
    await wait(500);
    return open;
  };
  const free = await pace(1500);
  const openAtThirty = await choose('rate', 3);
  const thirty = await pace(2500);
  check(
    thirty < 31.5 && thirty > Math.min(24, free * 0.7),
    `asked for thirty frames a second, thirty are drawn (${thirty.toFixed(1)}; ${free.toFixed(0)} before)`,
  );
  check(
    !openAtThirty && (await stored()).fps === 30,
    'smooth or sharp is no question then (that row cannot be pressed), and the thirty are remembered',
  );
  const openAtSixty = await choose('rate', 2);
  const sixty = await pace(2000);
  check(sixty < 62.5 && openAtSixty, `asked for sixty, no more than sixty (${sixty.toFixed(1)})`);
  await choose('rate', 1);
  check((await stored()).fps === undefined, "and the screen's own pace again is nothing to remember");
  const size = async () => {
    await wait(1400); // (the stats line is written twice a second)
    return chrome.page.evaluate(() =>
      /(\d+)x(\d+) \((\d+)%\)/.exec(document.getElementById('stats').textContent)?.slice(1).map(Number),
    );
  };
  if (!(await size())) await chrome.page.keyboard.press('KeyH');
  await choose('pixels', 2);
  const half = await size();
  check(
    half?.[2] > 66 && half?.[2] < 78 && (await stored()).resolution === 0.5,
    `half the pixels asked for: the picture is drawn at ${half?.[0]}x${half?.[1]}, whatever there is time for`,
  );
  await choose('pixels', 3);
  const full = await size();
  check(
    full?.[2] === 100 && (await stored()).resolution === 1,
    `all of them asked for: ${full?.[0]}x${full?.[1]} (${full?.[2]} %)`,
  );
  await choose('pixels', 1);
  check((await stored()).resolution === undefined, 'and left to the page again, nothing is remembered for it');

  // ---- a photograph can be given a depth of field, made lighter or darker, and set out by a grid
  await chrome.page.keyboard.press('Digit4');
  await wait(500);
  await chrome.page.keyboard.press('KeyP');
  await wait(500);
  const fourth = await chrome.page.evaluate(() => window.__hollowtide.harness.viewpoints()[3]);
  const frozen = await moment();
  const shot = () =>
    chrome.page.evaluate(([view, time]) => window.__hollowtide.harness.capture(view, time).png, [fourth, frozen]);
  /** how many edges a part of a picture has (the mean step in brightness from a pixel to the next), and how light it is */
  const look = (png) =>
    chrome.page.evaluate(async (png) => {
      const bitmap = await createImageBitmap(await (await fetch(png)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      const { data, width, height } = context.getImageData(0, 0, bitmap.width, bitmap.height);
      const luma = (i) => data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      const part = (x0, y0, x1, y1) => {
        let [edges, light, n] = [0, 0, 0];
        for (let y = Math.floor(y0 * height); y < Math.floor(y1 * height) - 1; y++)
          for (let x = Math.floor(x0 * width); x < Math.floor(x1 * width) - 1; x++) {
            const i = (y * width + x) * 4;
            edges += Math.abs(luma(i) - luma(i + 4)) + Math.abs(luma(i) - luma(i + width * 4));
            light += luma(i);
            n++;
          }
        return { edges: edges / n, light: light / n };
      };
      return { middle: part(0.42, 0.4, 0.58, 0.6), near: part(0.55, 0.72, 1, 0.98), all: part(0, 0, 1, 1) };
    }, png);
  const plain = await shot();
  const sharp = await look(plain);
  await chrome.page.keyboard.press('KeyO');
  await wait(500);
  const focusLine = await note();
  const soft = await look(await shot());
  check(/^Focus held on the middle of the picture.*O lets go$/.test(focusLine), `O holds the focus: "${focusLine}"`);
  check(
    soft.near.edges < sharp.near.edges * 0.8 && soft.middle.edges > sharp.middle.edges * 0.9,
    `what is far in the middle of the picture stays sharp (edges ${sharp.middle.edges.toFixed(2)} → ${soft.middle.edges.toFixed(2)}) ` +
      `and the seabed close by goes soft (${sharp.near.edges.toFixed(2)} → ${soft.near.edges.toFixed(2)})`,
  );
  const [kept] = await Promise.all([
    chrome.page.waitForEvent('download', { timeout: 40_000 }),
    chrome.page.keyboard.press('Enter'),
  ]);
  await kept.path();
  await wait(300);
  check(/^Saved, \d+ × \d+, the world alone$/.test(await note()), `and a picture is saved so: "${await note()}"`);
  await chrome.page.keyboard.press('KeyO');
  await wait(400);
  const letGo = await note();
  check((await shot()) === plain && /let go/.test(letGo), 'let go again, the picture is what it was to the last pixel');
  await chrome.page.keyboard.press('KeyB');
  await chrome.page.keyboard.press('KeyB');
  await wait(300);
  const brighterLine = await note();
  const brighter = await look(await shot());
  for (let i = 0; i < 3; i++) await chrome.page.keyboard.press('KeyV');
  await wait(300);
  const darkerLine = await note();
  const darker = await look(await shot());
  check(
    brighterLine === 'Exposure +1 stop' && darkerLine === 'Exposure −0.5 stops',
    `B and V move the exposure by half a stop, and say where it is: "${brighterLine}", "${darkerLine}"`,
  );
  check(
    brighter.all.light > sharp.all.light * 1.15 && darker.all.light < sharp.all.light * 0.95,
    `and the picture is lighter, then darker (${sharp.all.light.toFixed(0)}: ${brighter.all.light.toFixed(0)}, ${darker.all.light.toFixed(0)})`,
  );
  const thirds = () =>
    chrome.page.evaluate(
      () =>
        document.body.classList.contains('thirds') &&
        getComputedStyle(document.body, '::after').backgroundImage.includes('gradient'),
    );
  await chrome.page.keyboard.press('KeyG');
  await wait(200);
  const gridLine = await note();
  const gridOn = await thirds();
  await chrome.page.keyboard.press('KeyP');
  await wait(300);
  const gridOutside = await thirds();
  await chrome.page.keyboard.press('KeyP');
  await wait(400);
  const gridAgain = await thirds();
  const again = await look(await shot());
  check(
    gridOn && !gridOutside && gridAgain && /^Grid on/.test(gridLine),
    'G lays a grid of thirds over the picture; it goes with photo mode and is there again in the next photograph',
  );
  check(
    Math.abs(again.all.light / sharp.all.light - 1) < 0.02 && Math.abs(again.near.edges / sharp.near.edges - 1) < 0.1,
    'the exposure and the focus are for one photograph: the next begins as the eye has it, all sharp',
  );
  await chrome.page.keyboard.press('KeyG');
  await chrome.page.keyboard.press('KeyP');
  await wait(300);

  // ---- keys can be chosen: a cap in the panel's list is pressed, and then the key that is to do its job
  const cap = (action) =>
    chrome.page.evaluate((action) => document.querySelector(`#keys [data-k=${action}]`).textContent, action);
  const far = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  await chrome.page.keyboard.press('Escape');
  await inState('menu');
  await chrome.page.click('#keys [data-k=KeyW]');
  await wait(150);
  const asked = await note();
  await chrome.page.keyboard.press('Escape');
  await wait(300);
  check(
    /^Press the key for swimming forward/.test(asked) && (await state()) === 'menu' && (await cap('KeyW')) === 'W',
    `a key cap pressed asks for a key ("${asked}"); Esc leaves the key as it was, and the panel open`,
  );
  await chrome.page.click('#keys [data-k=KeyW]');
  await chrome.page.keyboard.press('Enter');
  await wait(150);
  const refused = await note();
  await chrome.page.click('#keys [data-k=KeyW]');
  await chrome.page.keyboard.press('KeyI');
  await wait(150);
  const given = await note();
  check(/^Enter is not a key/.test(refused), `a key the panel needs is not to be had: "${refused}"`);
  check(
    given === 'I is now the key for swimming forward' &&
      (await cap('KeyW')) === 'I' &&
      (await stored()).keys?.KeyW === 'KeyI',
    `another key is: "${given}", on the cap, and remembered`,
  );
  await chrome.page.click('#keys [data-k=KeyM]');
  await chrome.page.keyboard.press('KeyH');
  await wait(150);
  const swapped = await note();
  check(
    swapped === 'H is now the key for the sound · and M for the stats line' &&
      (await cap('KeyM')) === 'H' &&
      (await cap('KeyH')) === 'M',
    `a key that had a job swaps with it: "${swapped}"`,
  );
  await chrome.page.click('#keys [data-k=KeyC]');
  await chrome.page.keyboard.press('KeyK');
  // (and with the keyboard alone: the cap in focus, Space to press it, and then Space as the key)
  await chrome.page.focus('#keys [data-k=KeyF]');
  await chrome.page.keyboard.press('Space');
  await wait(150);
  const askedByKey = await note();
  await chrome.page.keyboard.press('Space');
  await wait(400);
  const space = await note();
  check(
    /^Press the key for the lamp/.test(askedByKey) && space === 'Space is now the key for the lamp',
    `a cap can be pressed with the keyboard, and Space chosen with it: "${space}"`,
  );
  // the gamepad goes through the panel's settings and not through the twenty key caps
  const visited = [];
  for (let i = 0; i < 16; i++) {
    await pad(DOWN);
    visited.push(await chrome.page.evaluate(() => document.activeElement?.dataset.k ?? document.activeElement?.id));
  }
  check(
    !visited.some((id) => /^(Key|Shift)|usual/.test(id ?? '')) && visited.includes('look'),
    'the gamepad still goes from setting to setting: the key caps are not in its way',
  );
  await chrome.page.keyboard.press('Escape');
  await inState('playing');
  await wait(1500);
  const rest = await camera();
  await held('KeyW', 800);
  await wait(300);
  const stillThere = await camera();
  await held('KeyI', 800);
  const swum = await camera();
  check(
    far(rest, stillThere) < 0.05 && far(stillThere, swum) > 0.3,
    `in the water I swims forward (${far(stillThere, swum).toFixed(1)} m) and W no longer does (${far(rest, stillThere).toFixed(2)} m)`,
  );
  await chrome.page.keyboard.press('KeyH');
  await wait(200);
  const soundOff = await note();
  await chrome.page.keyboard.press('KeyH');
  await chrome.page.keyboard.press('KeyK');
  await wait(200);
  const glide = await note();
  await chrome.page.keyboard.press('KeyK');
  await chrome.page.keyboard.press('Space');
  await wait(200);
  const lampLine = await note();
  await chrome.page.keyboard.press('Space');
  check(
    soundOff === 'Sound off' && /K brings the arms back$/.test(glide) && /^Lamp o/.test(lampLine),
    `H is the sound, Space the lamp, and what the page says names the keys as they are: "${glide}"`,
  );
  // on the next visit they are as they were left, on the home view too
  await chrome.open(host.origin + '/', { tuning: 'tuned' });
  await inState('home', 30_000);
  const home = await chrome.page.evaluate(() => [
    document.querySelector('#dive i').textContent,
    document.getElementById('scene').getAttribute('aria-label'),
  ]);
  await wait(1200);
  await chrome.page.keyboard.press('KeyW');
  await wait(700);
  const stayed = await state();
  await chrome.page.keyboard.press('KeyI');
  await inState('playing');
  check(
    home[0] === 'IASD' && /I A S D swim/.test(home[1]) && stayed === 'home',
    `the next visit has them: the home view says ${home[0].split('').join(' ')} to dive, and I dives where W does not`,
  );
  await chrome.page.keyboard.press('Escape');
  await inState('menu');
  const offered = await chrome.page.evaluate(() => !document.getElementById('usual').hidden);
  await chrome.page.click('#usual');
  await wait(150);
  check(
    offered &&
      (await note()) === 'The usual keys are back' &&
      (await cap('KeyW')) === 'W' &&
      (await cap('KeyF')) === 'F' &&
      (await stored()).keys === undefined &&
      (await chrome.page.evaluate(() => document.getElementById('usual').hidden)),
    'and one button puts the usual keys back, and is gone when they are',
  );

  const gpuErrors = await chrome.page.evaluate(() => window.__hollowtide.harness.gpuErrors());
  check(gpuErrors.length === 0, `no shader or validation errors${gpuErrors.length ? ': ' + gpuErrors.join('; ') : ''}`);
  check(chrome.errors.length === 0, `no console errors${chrome.errors.length ? ': ' + chrome.errors.join('; ') : ''}`);
} finally {
  await chrome.close();
  host.close();
}
finish();
