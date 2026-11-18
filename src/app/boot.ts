// Main-thread start-up, and the frame loop.
//
// In order: the settings, the device, the renderer and its pipelines, the page's controls, then the world from
// the generator worker while the loading bar reports on it, a first frame, and the menu. From then on the loop
// runs: dynamic resolution, the swimmer, a frame, the stats line.
import { createSoundscape } from '../audio/soundscape';
import { lookAt, updateBasis } from '../camera/camera';
import { FLY_SECONDS, flyPoint } from '../camera/path';
import { createIntent, createSwimmer, stepSwimmer, type Drive } from '../camera/controls';
import { loadSettings, markLoading, saveSettings, forgetSettings } from '../config/settings';
import { quality, type Level } from '../config/quality';
import { createGpu, StartupError } from '../gpu/context';
import { addFrame, addGpuTime, createDynRes, MAX_PIXELS, settle, SHARP, SMOOTH, OUT_OF_REACH } from '../render/dynres';
import { createRenderer } from '../render/renderer';
import { generateWorld, type Generated } from '../world/client';
import { CAMERA_RADIUS, rockDistance, type CollisionField } from '../world/collision';
import { checksum, type FromWorker, type ToWorker } from '../world/protocol';
import { createHud } from '../ui/hud';
import { bindInput } from '../ui/input';
import { createMenu } from '../ui/menu';
import { createHarness, type Harness } from './harness';
import { createBodyState, poseBody, stepBody, strokePull } from '../body/rig';
import { createNote } from '../ui/note';
import { FAITHFUL, TUNED } from '../config/tuning';
import { placeJellies } from '../world/jellies';
import { placeTurtles } from '../life/turtle';
import { viewFromHash, viewToHash } from '../camera/share';
import { moodNamed } from '../config/mood';
import { setShaderMood } from '../gpu/shader';
import { aimLamp } from '../render/lamp';
import { createBreath, stepBreath, stepWash } from '../body/breath';
import { TAN_HALF_FOV } from '../render/frame';
import { breathe } from '../gpu/turns';

export interface BootReport {
  adapter: string;
  level: Level;
  size: [width: number, height: number];
  /** milliseconds from the start of navigation until the menu is up */
  loadMs?: number;
  /** harness builds only: a 16 MB buffer sent to the worker and back by transfer */
  worker?: { megabytes: number; roundTripMs: number; detached: boolean; intact: boolean };
}

declare global {
  interface Window {
    /** A handle for tests and harnesses; `ready` is set once start-up has finished or failed. */
    __hollowtide?: {
      ready?: boolean;
      error?: string;
      report?: BootReport;
      harness?: Harness;
      /** frames drawn by the loop so far */
      frames?: number;
      /** set by a test to stop the loop drawing, so that only the frames it asks for exist */
      paused?: boolean;
      /** harness builds: how many of the swimmer's own bubbles are in the water */
      ownBubbles?: () => number;
    };
  }
}

const TRANSFER_BYTES = 16 << 20;
/** What the loading bar says while each stage of world generation runs. */
/**
 * Settled for thirty frames a second: above this much GPU time (ms) a frame cannot keep up with a sixty-hertz
 * screen and every second one is drawn; it has to fall below the second number before every one is drawn again.
 */
const EVEN_ABOVE = 14.5;
const EVEN_BELOW = 11.5;
/** Where the swimmer's place is kept while the page starts over (for this tab only, and read once). */
const RESUME = 'hollowtide-resume';
// (it names the setting it has changed, so that it can be found and changed back)
const THIRTY = 'Thirty frames a second is what this machine holds here: Picture is now Sharp, in the panel';
const LINK_COPIED = 'A link to this view is copied';
const LINK_IN_BAR = 'A link to this view is in the address bar';
const PHOTO_KEYS = 'Photo: the moment stands still. Enter saves it, P returns';
const coarse = () => matchMedia('(pointer: coarse)').matches;
/** What photo mode says of itself: the keys, or for fingers (which have the two buttons) only what it is. */
const photoHint = () => (coarse() ? 'Photo: the moment stands still' : PHOTO_KEYS);
/** What the tour says as it begins: how to take over, with keys or with a finger. */
const tourHint = () =>
  'A tour of the hollow. ' + (coarse() ? 'Hold a finger on the picture to take over' : 'Any swimming key takes over');
const TOUR_OVER = 'The tour is over: swim on from here';
/** Said when a gamepad is first heard from. */
const PAD_KEYS = 'Gamepad: sticks swim and look · RT scooter · LB and RB down and up · Y lamp · A or Start the panel';
/** And when a gamepad opens the panel: how it is worked from there. */
const PAD_PANEL = 'Gamepad: the d-pad or the left stick moves · A presses · B closes';
/** What the six viewpoints look at (keys 1 to 6), said when a key goes to one. */
const PLACES = ["The whale's tail", 'The wreck', 'The kelp forest', 'The sponge garden', 'The canopy', 'The meadow'];
/** Said while the pointer or the focus is on a detail level or a light that is not the current one. */
const REMAKES = 'Changing this makes the world again: a few seconds';
/** What a first dive is told once the eyes are open, a line at a time: for hands on keys, and for fingers. */
const firstDive = (classic: boolean) =>
  coarse()
    ? [
        'Hold a finger down to swim · slide it to look around',
        `A second finger ${classic ? 'goes faster' : 'brings up a scooter'}`,
        '≡ opens the panel: settings, a tour, photo mode',
      ]
    : [
        'W A S D swim · the mouse or the arrow keys look around',
        `Shift ${classic ? 'goes faster' : 'brings up a scooter'} · Q and E go down and up`,
        'Esc opens the panel: settings, a tour, photo mode, all the keys',
      ];
/** Seconds after the dive at which the first of those lines comes up, and from one line to the next. */
const HINT_AT = 3;
const HINT_EVERY = 5.5;
/** The most pixels a saved picture has: a 4K frame. */
const PHOTO_PIXELS = 3840 * 2160;
const CLASSIC_ON = 'Classic glide: no arms, steady speed. C brings the arms back';
const CLASSIC_OFF = 'Swimming with arms. C switches to the classic glide';
/** The home view: which stretch of the scripted flight it drifts along (seconds of it), and how fast. */
const HOME_FROM = 8.5; // the wreck in its shafts of light...
const HOME_SPAN = 27; // ...on through the kelp forest, and back
const HOME_SPEED = 0.3;
/** How much wider the view gets on the scooter at full pull (as a share of the field of view's tangent). */
const WIDE_AT_SPEED = 0.16;

const LOADING = {
  density: 'Sculpting the seabed…',
  terrain: 'Carving canyons…',
  plants: 'Growing kelp…',
  rocks: 'Scattering rocks and corals…',
} as const;

/**
 * Harness builds only: tells a listener on 127.0.0.1 how start-up went. Safari cannot be driven without a
 * setting the user has to switch on, so the page reports for itself. Loopback only, and only on request.
 */
function tell(key: string, value: unknown): void {
  if (!__HARNESS__) return;
  const to = new URLSearchParams(location.search).get('report');
  if (to && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(to)) {
    new Image().src = `${to}?${key}=${encodeURIComponent(JSON.stringify(value))}`;
  }
}

/** The next message of one type from the worker; rejects if the worker reports or throws an error first. */
function reply<T extends FromWorker['type']>(
  worker: Worker,
  type: T,
  timeoutMs = 15_000,
): Promise<Extract<FromWorker, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new Error(`the worker did not answer "${type}" within ${timeoutMs / 1000} s`));
    }, timeoutMs);
    const stop = () => {
      clearTimeout(timer);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };
    const onMessage = ({ data }: MessageEvent<FromWorker>) => {
      if (data.type === 'error') {
        stop();
        reject(new Error(`worker failed in ${data.stage}: ${data.message}`));
      } else if (data.type === type) {
        stop();
        resolve(data as Extract<FromWorker, { type: T }>);
      }
    };
    const onError = (event: ErrorEvent) => {
      stop();
      reject(new Error(`worker error: ${event.message}`));
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
  });
}

/** Starts the worker from the page's own script and sends a buffer there and back. */
async function workerRoundTrip(createWorker: () => Worker): Promise<NonNullable<BootReport['worker']>> {
  const worker = createWorker();
  await reply(worker, 'ready');
  const buffer = new ArrayBuffer(TRANSFER_BYTES);
  const words = new Uint32Array(buffer);
  for (let i = 0; i < words.length; i++) words[i] = Math.imul(i, 2654435761);
  const expected = checksum(buffer);
  const start = performance.now();
  worker.postMessage({ type: 'echo', buffer } satisfies ToWorker, [buffer]);
  const detached = buffer.byteLength === 0; // a transferred buffer is empty on the sending side
  const echo = await reply(worker, 'echo');
  const roundTripMs = performance.now() - start;
  worker.terminate();
  const intact =
    echo.buffer.byteLength === TRANSFER_BYTES && echo.checksum === expected && checksum(echo.buffer) === expected;
  return { megabytes: TRANSFER_BYTES >> 20, roundTripMs, detached, intact };
}

export async function bootMain(createWorker: () => Worker): Promise<void> {
  const hook: NonNullable<Window['__hollowtide']> = (window.__hollowtide = { frames: 0 });
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const params = new URLSearchParams(location.search);
  // harness builds can be told to forget what was remembered: for a browser that keeps it from run to run
  if (__HARNESS__ && params.has('forget')) forgetSettings();
  const settings = loadSettings();
  // dev and harness builds can force the detail level with ?level=0|1|2
  const forced = __DEV__ || __HARNESS__ ? params.get('level') : null;
  if (forced === '0' || forced === '1' || forced === '2') settings.level = Number(forced) as Level;
  const level = settings.level;
  // dev and harness builds can force the light with ?mood=dusk
  // (beside the settings, not in them: what a test asks for is not to be remembered)
  // ...and a link to a view is followed in the light it was taken in (noon, if it names none), for this visit
  const linked = viewFromHash(location.hash);
  const moodName = ((__DEV__ || __HARNESS__) && params.get('mood')) || linked?.[5] || settings.mood;

  // the page's controls exist before anything can go wrong, so a failure has somewhere to be shown
  const intent = createIntent();
  const menu = createMenu(level, moodNamed(moodName).name, canvas, settings, {
    onWake: () => wake?.(),
    onSettings: () => applySettings(),
    onDive() {
      sound?.wake();
      // phones: go fullscreen and ask for landscape; where that is refused the page's CSS rotation still applies
      if (settings.mobile) {
        const landscape = () =>
          (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
        void document.documentElement
          .requestFullscreen?.()
          ?.then(landscape)
          .catch(() => 0);
      } else input?.capture();
    },
    onToggle(open) {
      if (open) pausedAt = performance.now();
      if (open) hush();
      if (open) input?.release();
    },
    onLevel(next) {
      // another level is another world: remember it and start over (what the screen settled on no longer applies)
      saveSettings({ ...settings, level: next, pixels: Infinity, detail: 1 }, 0);
      keepPlace();
      location.reload();
    },
    onMood(name) {
      // the light is built into the shaders: remember it and start over
      saveSettings({ ...settings, mood: name }, Infinity);
      keepPlace();
      // (a link this page was opened by names a light of its own: it has been followed, and now gives way)
      history.replaceState(null, '', location.href.replace(/#.*$/, ''));
      location.reload();
    },
  });
  let sound: ReturnType<typeof createSoundscape> | null = null;
  /** Puts the swimmer where they wake (set once there is a world to wake in). */
  let wake: (() => void) | null = null;
  /** Puts the settings into effect and remembers them (set once there is something to apply them to). */
  let applySettings: () => void = () => undefined;
  /**
   * Before the page starts over for another light or another level of detail: notes where the swimmer is, so
   * that they come back there and not to the home view (set once there is a swimmer to place).
   */
  let keepPlace: () => void = () => undefined;
  let input: ReturnType<typeof bindInput> | null = null;
  /** when the panel last opened (performance.now()) */
  let pausedAt = 0;
  /** takes down the line at the bottom of the picture, once there is one */
  let hush: () => void = () => undefined;

  try {
    menu.progress('Diving…', 0.02);
    const gpu = await createGpu(canvas);
    // out of memory, or the driver gave up: start again a level lower, or on Low say what happened
    void gpu.device.lost.then((info) => {
      if (info.reason === 'destroyed') return; // the page is closing
      if (level < 2) {
        saveSettings({ ...settings, level: (level + 1) as Level, pixels: Infinity, detail: 1 }, 0);
        location.reload();
      } else menu.fail('The graphics device was lost. Reload the page to try again.');
    });

    // ---- the world. Dev and harness builds can be told where it comes from: ?world=reference draws a dump of
    // the original's world (npm run ref:dump), ?world=none starts without one (tests bring their own).
    const source = __DEV__ || __HARNESS__ ? params.get('world') : null;
    let making: Promise<Generated> | null = null;
    if (source !== 'reference' && source !== 'none') {
      // a load that takes the tab down leaves this mark, and the next visit starts a level lower
      markLoading(true);
      addEventListener('pagehide', () => markLoading(false));
      // it starts being made at once, alongside the shader compilation below: neither waits for the other
      // ?seed=7 (any whole number) grows other plants and rocks on the same seabed
      const seed = /^\d{1,9}$/.test(params.get('seed') ?? '') ? +params.get('seed')! : 0;
      making = generateWorld(gpu.device, createWorker, level, {
        onProgress: (stage, fraction) => menu.progress(LOADING[stage], 0.08 + 0.86 * fraction),
        seed,
      });
      making.catch(() => 0); // a failure is reported where the world is awaited, not as an unhandled rejection
    } else menu.progress('Compiling shaders…', 0.05);
    const dynres = createDynRes(settings.pixels, settings.detail, settings.mobile, settings.sharp ? SHARP : SMOOTH);
    let gpuMs = 0;
    // dev and harness builds can draw with the original's own distances: ?tuning=faithful
    let tuning = (__DEV__ || __HARNESS__) && params.get('tuning') === 'faithful' ? FAITHFUL : TUNED;
    // (for measuring: ?coarseShafts=0 marches the shafts at half size whatever the size of the picture)
    if (__HARNESS__ && params.get('coarseShafts') === '0') tuning = { ...tuning, coarseShafts: false };
    // the light the shaders are built for: what was chosen in the menu
    const mood = moodNamed(moodName);
    setShaderMood(mood);
    const renderer = await createRenderer(gpu, quality(level), tuning, (ms) => {
      gpuMs = ms;
      addGpuTime(dynres, ms);
    });
    renderer.exposure = mood.exposure;
    performance.mark('hollowtide:renderer');
    tell('stage', 'renderer');
    renderer.pixelBudget = dynres.pixels;
    renderer.detail = dynres.detail;
    renderer.resize();

    const info = gpu.adapter.info;
    hook.report = {
      adapter: [info.vendor, info.architecture, info.description].filter(Boolean).join(' '),
      level,
      size: [renderer.targets.width, renderer.targets.height],
    };
    const harness = __DEV__ || __HARNESS__ ? createHarness(renderer, createWorker) : null;
    if (harness) hook.harness = harness;
    // ?selftest: a 16 MB round trip through the worker, as a check of transfers on this browser
    if (__HARNESS__ && params.has('selftest')) hook.report.worker = await workerRoundTrip(createWorker);

    let collision: CollisionField | null = null;
    let collisionReady: Promise<void> | null = null;
    let viewpoints: number[][] = [];
    if (source === 'reference') {
      menu.progress('Loading the reference world…', 0.5);
      viewpoints = await harness!.loadReferenceWorld('/fixtures/');
    } else if (making) {
      const made = await making;
      const kelp = made.world.kelp; // (kept: it is not sent to the GPU)
      if (harness) harness.fishSample = made.world.fish.slice(0, 8 * 400);
      await renderer.setWorld(made.world);
      performance.mark('hollowtide:uploaded');
      tell('stage', 'uploaded');
      // what the swimmer collides with follows a moment later: nothing on screen waits for it
      // and so do the swimmer's arms, which are not seen before the dive
      collisionReady = Promise.all([made.collision, made.body, made.turtle]).then(async ([field, body, turtle]) => {
        collision = field;
        renderer.setBody(body);
        // jellyfish and turtles go where there is open water, which the collision field knows. (Each of these
        // steps in a turn of its own: together they were one task of 90 ms on a warm machine.)
        await breathe();
        if (tuning.jellies) renderer.setJellies(placeJellies(made.world.viewpoints, field));
        await breathe();
        const turtles = tuning.turtles ? placeTurtles(made.world.viewpoints, field, kelp) : null;
        await breathe();
        if (turtles) renderer.setTurtles(turtle, turtles);
        // (told last: tests take this as the sign that everything that lives here has been placed)
        if (harness) harness.collision = field;
      });
      if (harness) harness.generatedViewpoints = made.world.viewpoints;
      viewpoints = made.world.viewpoints;
      setTimeout(markLoading, 15_000, false); // the load counts as survived after 15 s of frames
    }
    const goTo = (index: number) => {
      const view = viewpoints[index] as [number, number, number, number, number, number] | undefined;
      if (view) lookAt(renderer.camera, ...view);
    };
    goTo(0);

    // ---- controls and sound
    const camera = renderer.camera;
    const swimmer = createSwimmer();
    let body = createBodyState();
    let breath = createBreath();
    const drive: Drive = { gain: 1, jet: false };
    if (__HARNESS__) {
      hook.ownBubbles = () => {
        let n = 0;
        for (let i = 3; i < breath.data.length; i += 8) if (breath.data[i]! > 0) n++;
        return n;
      };
    }
    // the home view drifts along the scripted flight, slowly, there and back
    const flight = new Float64Array(6);
    let homeClock = 0;
    // ---- a swimmer who was in the water when the page started over comes back where they were
    let dived = false;
    let kept: ReturnType<typeof viewFromHash> = null;
    let keptLamp: boolean | null = null;
    let keptStats = false;
    try {
      type Kept = { at?: string; lamp?: boolean; stats?: boolean };
      const record = JSON.parse(sessionStorage.getItem(RESUME) ?? 'null') as Kept | null;
      keptStats = !!record?.stats;
      sessionStorage.removeItem(RESUME); // once: a reload by hand goes to the home view as ever
      kept = record ? viewFromHash(record.at ?? '') : null;
      keptLamp = kept ? !!record!.lamp : null;
    } catch {
      // storage can be blocked: then the page simply starts at the home view
    }
    const resuming = kept !== null;
    // (harness builds give the first dive's hints only when asked with ?hints: a test waits for lines of its own)
    const hinting = !__HARNESS__ || params.has('hints');
    keepPlace = () => {
      try {
        // (the stats line is kept as well, and that also for someone who has not dived yet)
        const record = { at: dived ? viewToHash(camera) : '', lamp: lampOn, stats: hud.on };
        sessionStorage.setItem(RESUME, JSON.stringify(record));
      } catch {
        // as above
      }
    };
    wake = () => {
      dived = true;
      // still, at the first viewpoint, arms down; or where a link to a view says, if this page was opened by
      // one; or where the swimmer was (a place they had swum to: it is not asked whether it is in the rock)
      goTo(0);
      const view = linked;
      if (kept) [camera.x, camera.y, camera.z, camera.yaw, camera.pitch] = kept;
      else if (view && collision && rockDistance(collision, view[0], view[1], view[2]) < -CAMERA_RADIUS) {
        [camera.x, camera.y, camera.z, camera.yaw, camera.pitch] = view;
      }
      kept = null;
      Object.assign(swimmer, createSwimmer());
      body = createBodyState();
      breath = createBreath();
      breath.dirty = true;
      // Once the eyes are open: a reminder for whoever chose the glide on an earlier visit, and on the first dive
      // in this browser the few things worth knowing, a line at a time. They stop for the panel or a mode, and
      // are not said again once the last has been.
      const first = hinting && !settings.hinted && !resuming;
      const lines = [...(settings.classic ? [CLASSIC_ON] : []), ...(first ? firstDive(settings.classic) : [])];
      const say = (i: number) => {
        if (i >= lines.length || menu.open || photo || tour >= 0) return;
        // (a line that is up is left its time: the one about thirty frames a second may be)
        if (note.showing()) return void setTimeout(say, 1000, i);
        note(lines[i]!);
        if (first && i === lines.length - 1) {
          settings.hinted = true;
          saveSettings(settings, fullPixels());
        }
        setTimeout(say, HINT_EVERY * 1000, i + 1);
      };
      setTimeout(say, HINT_AT * 1000, 0);
    };
    const hud = createHud(document.getElementById('stats')!);
    if (keptStats) hud.toggle();
    const note = createNote(document.getElementById('note')!);
    hush = note.clear;
    sound = createSoundscape(camera, settings.muted);
    input = bindInput(canvas, intent, {
      onGesture: () => sound!.wake(),
      menuOpen: () => menu.open,
      lookSpeed: () => [settings.sensitivity, settings.invertY ? -settings.sensitivity : settings.sensitivity],
      onPadButton() {
        menu.press();
        if (menu.paused) note(PAD_PANEL);
      },
      onPadBack: () => menu.paused && menu.press(),
      onKey(code) {
        if (code === 'KeyH') hud.toggle();
        else if (code === 'Pad') note(PAD_KEYS);
        else if (code === 'KeyM') toggleMute();
        else if (code === 'KeyL') shareView();
        else if (code === 'KeyF') toggleLamp();
        else if (code === 'KeyC') {
          // the original's steady glide with no body in view, or strokes and the scooter. It is remembered, so
          // it is said: arms that are simply gone on the next visit would look like a fault
          settings.classic = !settings.classic;
          saveSettings(settings, fullPixels());
          menu.sync();
          note(settings.classic ? CLASSIC_ON : CLASSIC_OFF);
        } else if (code === 'KeyP') setPhoto(!photo);
        else if (code === 'Enter' && photo) takePicture();
        else if (code === 'KeyT') setTour(tour < 0);
        else if (code === 'Escape') {
          // The panel (which ends photo mode and the tour), and out of it again. Not within a fifth of a second
          // of its opening: the Esc that gives the mouse back opens it, and the same press may still arrive here.
          // (No longer than that: a second press half a second after the first is meant, and was being lost.)
          if (!menu.paused) menu.show(true);
          else if (performance.now() - pausedAt > 200) menu.press();
        } else if (code >= 'Digit1' && code <= 'Digit6') {
          const index = code.charCodeAt(5) - 49;
          goTo(index);
          note(`${index + 1} · ${PLACES[index]!}`);
        }
      },
    });
    // ---- the lamp: F switches it, and so does a button. By moonlight it starts switched on
    let lampOn = keptLamp ?? (linked ? linked[6] : mood.name === 'moon');
    let lampLevel = 0;
    const lampButton = document.getElementById('lamp')!;
    const toggleLamp = () => {
      lampOn = !lampOn;
      lampButton.setAttribute('aria-pressed', String(lampOn));
      note(lampOn ? 'Lamp on' : 'Lamp off');
    };
    lampButton.setAttribute('aria-pressed', String(lampOn));
    lampButton.onclick = toggleLamp;

    // ---- sound on and off: the M key, and a button for where there are no keys
    const muteButton = document.getElementById('mute')!;
    const showMuted = () => muteButton.setAttribute('aria-pressed', String(settings.muted));
    const toggleMute = () => {
      settings.muted = !settings.muted;
      sound!.setMuted(settings.muted);
      saveSettings(settings, fullPixels());
      showMuted();
      note(settings.muted ? 'Sound off' : 'Sound on');
    };
    muteButton.onclick = () => {
      sound!.wake();
      toggleMute();
    };
    showMuted();

    // ---- a link to this view: where the swimmer is and which way they look, in the address after the #
    const shareView = () => {
      const link = location.href.replace(/#.*$/, '') + viewToHash(camera, mood.name, lampOn);
      history.replaceState(null, '', link);
      const copied = navigator.clipboard?.writeText(link);
      if (copied)
        copied.then(
          () => note(LINK_COPIED),
          () => note(LINK_IN_BAR),
        );
      else note(LINK_IN_BAR);
    };

    const deviceWidth = () => Math.max(2, Math.round(canvas.clientWidth * devicePixelRatio));
    const fullPixels = () =>
      Math.min(MAX_PIXELS, deviceWidth() * Math.max(2, Math.round(canvas.clientHeight * devicePixelRatio)));

    // ---- photo mode: the moment stands still, nothing but the world is on screen, and Enter saves a picture
    let photo = false;
    let shoot = false;
    const setPhoto = (on: boolean) => {
      photo = on;
      document.body.classList.toggle('photo', on);
      if (on) {
        setTour(false);
        body.shown = 0; // arms out of the picture at once
        note.hold(photoHint());
      } else note.clear();
    };
    /** Asks for the picture, and says so at once: writing a large one out takes a moment. */
    const takePicture = () => {
      shoot = true;
      note.hold('Saving the picture…');
    };
    /** Draws the frozen moment again at a larger size, saves it as a PNG, and puts the size back. */
    const savePicture = () => {
      const [budget, detail] = [renderer.pixelBudget, renderer.detail];
      // twice the screen each way, but no more than a 4K frame: the targets for it have to fit in memory
      renderer.supersample = 2;
      renderer.pixelBudget = Math.min(PHOTO_PIXELS, fullPixels() * 4);
      renderer.detail = 1;
      renderer.resize();
      renderer.render(time);
      const [width, height] = [renderer.targets.width, renderer.targets.height];
      canvas.toBlob((blob) => {
        if (!blob) return note('The picture could not be saved');
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `hollowtide-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.png`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
        // (what is saved is the world alone: the line and the buttons are the page's, not the picture's. And if
        // photo mode has been left while the picture was being written out, the line does not stay)
        const saved = `Saved, ${width} × ${height}, the world alone`;
        if (photo) note.hold(`${saved}. ${photoHint()}`);
        else note(saved);
      }, 'image/png');
      renderer.supersample = 1;
      renderer.pixelBudget = budget;
      renderer.detail = detail;
      renderer.resize();
      settle(dynres);
    };

    // ---- the tour: the camera flies the scripted flight; any swimming key takes over where it has got to
    let tour = -1; // seconds into it, or -1
    const setTour = (on: boolean) => {
      if (on === tour >= 0) return;
      tour = on ? 0 : -1;
      if (on) {
        setPhoto(false);
        Object.assign(swimmer, createSwimmer());
        menu.fade();
        note(tourHint());
      }
    };
    // The detail level and the light are built into the world: picking another starts the page over, which is
    // said while the pointer or the focus is on one. Other buttons have a line of their own to say (data-tip).
    // Not for fingers: there is no pointing without pressing, and on a phone the line would lie over the panel.
    const tipped = '#detail button:not(.on), #light button:not(.on), [data-tip]';
    for (const button of coarse() ? [] : document.querySelectorAll<HTMLElement>(tipped)) {
      const tip = button.dataset.tip ?? REMAKES;
      button.onpointerenter = button.onfocus = () => note.hold(tip);
      button.onpointerleave = button.onblur = () => note.clear();
    }

    /** the picture has been set to sharp in this visit because sixty frames a second was out of reach */
    let settledForThirty = false;
    let wasPaused = false;
    // the tour and photo mode from the pause panel, and photo mode's own two buttons: for where there are no keys
    document.getElementById('tour')!.onclick = () => {
      menu.show(false);
      setTour(true);
    };
    document.getElementById('photo')!.onclick = () => {
      menu.show(false);
      setPhoto(true);
    };
    document.getElementById('save')!.onclick = takePicture;
    document.getElementById('leave')!.onclick = () => setPhoto(false);

    sound.setVolume(settings.volume);
    applySettings = () => {
      sound!.setVolume(settings.volume);
      // set to sharp for this machine, and now back to smooth by hand: that is the swimmer's to decide
      if (settledForThirty && !settings.sharp) settings.keepSmooth = true;
      dynres.target = settings.sharp ? SHARP : SMOOTH;
      saveSettings(settings, fullPixels());
    };

    // ---- the first frame, finished on the GPU before the reveal (pipelines are compiled on first use)
    menu.progress('Letting the light in…', 1);
    renderer.render(0);
    await gpu.queue.onSubmittedWorkDone();
    performance.mark('hollowtide:first frame');
    tell('stage', 'first frame');

    // ---- the loop
    let last = 0;
    let time = 0;
    let skip = false;
    /** the GPU time of a frame, smoothed; and whether frames are being paced at half the screen's rate */
    let gpuUsual = 0;
    let evenly = false;
    const frame = (now: number) => {
      requestAnimationFrame(frame);
      // behind the pause panel the world is a blur: every second frame is enough, and a laptop runs cooler for it.
      // And a machine that has settled for thirty frames a second because it cannot draw sixty draws every
      // second frame too: thirty that come evenly look better than forty that do not.
      gpuUsual += (gpuMs - gpuUsual) * 0.05;
      if (dynres.target === SHARP ? gpuUsual > (evenly ? EVEN_BELOW : EVEN_ABOVE) : false) evenly = true;
      else evenly = false;
      if ((menu.paused || (evenly && !menu.open)) && (skip = !skip)) return;
      const frameMs = now - last;
      last = now;
      if (hook.paused) return;
      const dt = Math.min(frameMs / 1000, 0.1);
      input!.poll();
      if (menu.open && (photo || tour >= 0)) {
        // paused, or back at the start: modes do not outlast that
        setPhoto(false);
        setTour(false);
      }
      // dynamic resolution: when a measuring period ends it may change the pixel budget or the draw distance
      // (not while paused, when frames are skipped on purpose)
      if (!menu.paused && addFrame(dynres, frameMs, menu.open, fullPixels())) {
        settings.pixels = dynres.pixels;
        settings.detail = dynres.detail;
        saveSettings(settings, fullPixels());
      }
      // Nothing left to give up and still far from sixty frames a second: this machine does not have them here.
      // Thirty it may: aim for that instead, and what was given up for nothing comes back.
      if (dynres.stuck >= OUT_OF_REACH && dynres.target === SMOOTH && !settings.keepSmooth && !menu.open) {
        settings.sharp = settledForThirty = true;
        dynres.target = SHARP;
        dynres.stuck = 0;
        saveSettings(settings, fullPixels());
        menu.sync();
        // (over whatever line is up, but not over photo mode's, which stays while the mode does)
        if (!photo) note(THIRTY);
      }
      renderer.pixelBudget = dynres.pixels;
      renderer.detail = dynres.detail;
      if (renderer.resize()) settle(dynres);
      if (!photo) time += dt; // a photograph is of one moment
      // the swimmer's body: in view while in the water, unless the classic glide is chosen
      const [yawBefore, pitchBefore] = [camera.yaw, camera.pitch];
      if (tour >= 0) {
        tour += dt;
        flyPoint(tour, flight);
        lookAt(camera, flight[0]!, flight[1]!, flight[2]!, flight[3]!, flight[4]!, flight[5]!);
        if (tour >= FLY_SECONDS) {
          setTour(false);
          note(TOUR_OVER);
        } else if (intent.forward || intent.right || intent.up || intent.fast) setTour(false);
      } else if (menu.home) {
        homeClock += dt * HOME_SPEED;
        const there = homeClock % (HOME_SPAN * 2);
        flyPoint(HOME_FROM + (there < HOME_SPAN ? there : HOME_SPAN * 2 - there), flight);
        lookAt(camera, flight[0]!, flight[1]!, flight[2]!, flight[3]!, flight[4]!, flight[5]!);
      } else stepSwimmer(camera, swimmer, intent, collision, dt, settings.classic || photo ? undefined : drive);
      const turned = dt > 0 ? 1 / dt : 0;
      stepBody(
        body,
        intent,
        !menu.open && !settings.classic && !photo && tour < 0,
        photo ? 0 : dt,
        drive,
        (camera.yaw - yawBefore) * turned,
        (camera.pitch - pitchBefore) * turned,
      );
      body.pitch = camera.pitch;
      poseBody(body, renderer.body, dt);
      sound!.scooter(body.throttle);
      // the stroke moves the head a little: for the picture only, the swimmer's place and heading stay as they are
      const [y, pitch] = [camera.y, camera.pitch];
      camera.y += body.heave;
      camera.pitch += body.nod;
      camera.wide = settings.fov * (1 + WIDE_AT_SPEED * body.rush); // and the scooter's pull widens the view
      updateBasis(camera);
      // the lamp comes on and goes off over a moment, and follows the view
      const lampGoal = lampOn && !menu.home ? 1 : 0;
      lampLevel += Math.max(-dt * 4, Math.min(dt * 4, lampGoal - lampLevel));
      aimLamp(renderer.scene.lampData, camera, lampLevel * lampLevel, settings.classic ? 0 : body.equip);
      // the swimmer breathes: bubbles past the mask, faster when working
      const breathing = !menu.open && !settings.classic && !photo && tour < 0;
      stepBreath(breath, camera, time, photo ? 0 : dt, body.swim * (1 - body.equip), breathing, Math.random);
      if (breathing) {
        // and the hands churn the water on each pull
        const free = 1 - body.equip;
        stepWash(
          breath,
          camera,
          time,
          photo ? 0 : dt,
          body.hands,
          body.swim * strokePull(body.phase) * free,
          body.scull * (1 - body.swim) * free,
          TAN_HALF_FOV * camera.wide,
          Math.random,
        );
      }
      if (breath.dirty) {
        renderer.setOwnBubbles(breath.data);
        breath.dirty = false;
      }
      if (breath.began) {
        breath.began = false;
        sound!.exhale();
      }
      if (shoot) {
        shoot = false;
        savePicture();
      }
      renderer.render(time);
      camera.y = y;
      camera.pitch = pitch;
      camera.wide = 1;
      updateBasis(camera);
      // (the panel halves the pace on purpose: those frames are not late)
      if (menu.paused !== wasPaused) hud.rest();
      wasPaused = menu.paused;
      hud.frame(frameMs, gpuMs, renderer.targets.width, renderer.targets.height, deviceWidth());
      hook.frames = (hook.frames ?? 0) + 1;
    };
    // The loop starts when the descent has gone black. Until then there is nothing of the scene to see, and the
    // descent is still being drawn: the loop's first frames, which are its slowest, would land in the same
    // task as that drawing (61 ms, once in five loads on a warm machine).
    menu.ready(resuming, () =>
      requestAnimationFrame((now) => {
        last = now;
        requestAnimationFrame(frame);
      }),
    );
    hook.report.loadMs = Math.round(performance.now());
    await collisionReady; // the menu is up; a failure here is still a failure to start
  } catch (error) {
    hook.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
    // a StartupError is written for the reader; anything else is unexpected and says so
    menu.fail(
      error instanceof StartupError
        ? error.message
        : 'Failed to start: ' + (error instanceof Error ? error.message : String(error)),
    );
    console.error(error);
  }
  hook.ready = true;
  if (__HARNESS__) {
    // for browsers that cannot be driven: how start-up went, any GPU errors, and whether a frame has a picture in it
    const harness = hook.harness;
    const frame = harness && !hook.error && params.has('report') ? harness.frameStats(2) : null;
    tell('result', {
      error: hook.error,
      report: hook.report,
      userAgent: navigator.userAgent,
      gpuErrors: harness?.gpuErrors(),
      frame,
    });
  }
}
