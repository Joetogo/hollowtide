// Main-thread start-up, and the frame loop.
//
// In order: the settings, the device, the renderer and its pipelines, the page's controls, then the world from
// the generator worker while the loading bar reports on it, a first frame, and the menu. From then on the loop
// runs: dynamic resolution, the swimmer, a frame, the stats line.
import { createSoundscape } from '../audio/soundscape';
import { lookAt, updateBasis } from '../camera/camera';
import { flyPoint } from '../camera/path';
import { createIntent, createSwimmer, stepSwimmer, type Drive } from '../camera/controls';
import { loadSettings, markLoading, saveSettings } from '../config/settings';
import { quality, type Level } from '../config/quality';
import { createGpu, StartupError } from '../gpu/context';
import { addFrame, addGpuTime, createDynRes, MAX_PIXELS, settle } from '../render/dynres';
import { createRenderer } from '../render/renderer';
import { generateWorld, type Generated } from '../world/client';
import type { CollisionField } from '../world/collision';
import { checksum, type FromWorker, type ToWorker } from '../world/protocol';
import { createHud } from '../ui/hud';
import { bindInput } from '../ui/input';
import { createMenu } from '../ui/menu';
import { createHarness, type Harness } from './harness';
import { createBodyState, poseBody, stepBody } from '../body/rig';

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
    };
  }
}

const TRANSFER_BYTES = 16 << 20;
/** What the loading bar says while each stage of world generation runs. */
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
  const settings = loadSettings();
  // dev and harness builds can force the detail level with ?level=0|1|2
  const forced = __DEV__ || __HARNESS__ ? params.get('level') : null;
  if (forced === '0' || forced === '1' || forced === '2') settings.level = Number(forced) as Level;
  const level = settings.level;

  // the page's controls exist before anything can go wrong, so a failure has somewhere to be shown
  const intent = createIntent();
  const menu = createMenu(level, canvas, {
    onWake: () => wake?.(),
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
      if (open) input?.release();
    },
    onLevel(next) {
      // another level is another world: remember it and start over (what the screen settled on no longer applies)
      saveSettings({ ...settings, level: next, pixels: Infinity, detail: 1 }, 0);
      location.reload();
    },
  });
  let sound: ReturnType<typeof createSoundscape> | null = null;
  /** Puts the swimmer where they wake (set once there is a world to wake in). */
  let wake: (() => void) | null = null;
  let input: ReturnType<typeof bindInput> | null = null;

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
      making = generateWorld(gpu.device, createWorker, level, {
        onProgress: (stage, fraction) => menu.progress(LOADING[stage], 0.08 + 0.86 * fraction),
      });
      making.catch(() => 0); // a failure is reported where the world is awaited, not as an unhandled rejection
    } else menu.progress('Compiling shaders…', 0.05);
    const dynres = createDynRes(settings.pixels, settings.detail, settings.mobile);
    let gpuMs = 0;
    const renderer = await createRenderer(gpu, quality(level), (ms) => {
      gpuMs = ms;
      addGpuTime(dynres, ms);
    });
    performance.mark('hollowtide:renderer');
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
      await renderer.setWorld(made.world);
      performance.mark('hollowtide:uploaded');
      // what the swimmer collides with follows a moment later: nothing on screen waits for it
      // and so do the swimmer's arms, which are not seen before the dive
      collisionReady = Promise.all([made.collision, made.body]).then(([field, body]) => {
        collision = field;
        if (harness) harness.collision = field;
        renderer.setBody(body);
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
    const drive: Drive = { gain: 1, jet: false };
    // the home view drifts along the scripted flight, slowly, there and back
    const flight = new Float64Array(6);
    let homeClock = 0;
    wake = () => {
      // still, at the first viewpoint, arms down
      goTo(0);
      Object.assign(swimmer, createSwimmer());
      body = createBodyState();
    };
    const hud = createHud(document.getElementById('stats')!);
    sound = createSoundscape(camera, settings.muted);
    input = bindInput(canvas, intent, {
      onGesture: () => sound!.wake(),
      menuOpen: () => menu.open,
      onKey(code) {
        if (code === 'KeyH') hud.toggle();
        else if (code === 'KeyM') {
          settings.muted = !settings.muted;
          sound!.setMuted(settings.muted);
          saveSettings(settings, fullPixels());
        } else if (code === 'KeyC') {
          // the original's steady glide with no body in view, or strokes and the scooter
          settings.classic = !settings.classic;
          saveSettings(settings, fullPixels());
        } else if (code === 'Escape') menu.show(true);
        else if (code >= 'Digit1' && code <= 'Digit6') goTo(code.charCodeAt(5) - 49);
      },
    });
    const deviceWidth = () => Math.max(2, Math.round(canvas.clientWidth * devicePixelRatio));
    const fullPixels = () =>
      Math.min(MAX_PIXELS, deviceWidth() * Math.max(2, Math.round(canvas.clientHeight * devicePixelRatio)));

    // ---- the first frame, finished on the GPU before the reveal (pipelines are compiled on first use)
    menu.progress('Letting the light in…', 1);
    renderer.render(0);
    await gpu.queue.onSubmittedWorkDone();
    performance.mark('hollowtide:first frame');

    // ---- the loop
    let last = 0;
    let time = 0;
    const frame = (now: number) => {
      requestAnimationFrame(frame);
      const frameMs = now - last;
      last = now;
      if (hook.paused) return;
      const dt = Math.min(frameMs / 1000, 0.1);
      // dynamic resolution: when a measuring period ends it may change the pixel budget or the draw distance
      if (addFrame(dynres, frameMs, menu.open, fullPixels())) {
        settings.pixels = dynres.pixels;
        settings.detail = dynres.detail;
        saveSettings(settings, fullPixels());
      }
      renderer.pixelBudget = dynres.pixels;
      renderer.detail = dynres.detail;
      if (renderer.resize()) settle(dynres);
      time += dt;
      // the swimmer's body: in view while in the water, unless the classic glide is chosen
      const [yawBefore, pitchBefore] = [camera.yaw, camera.pitch];
      if (menu.home) {
        homeClock += dt * HOME_SPEED;
        const there = homeClock % (HOME_SPAN * 2);
        flyPoint(HOME_FROM + (there < HOME_SPAN ? there : HOME_SPAN * 2 - there), flight);
        lookAt(camera, flight[0]!, flight[1]!, flight[2]!, flight[3]!, flight[4]!, flight[5]!);
      } else stepSwimmer(camera, swimmer, intent, collision, dt, settings.classic ? undefined : drive);
      const turned = dt > 0 ? 1 / dt : 0;
      stepBody(
        body,
        intent,
        !menu.open && !settings.classic,
        dt,
        drive,
        (camera.yaw - yawBefore) * turned,
        (camera.pitch - pitchBefore) * turned,
      );
      poseBody(body, renderer.body, dt);
      sound!.scooter(body.throttle);
      // the stroke moves the head a little: for the picture only, the swimmer's place and heading stay as they are
      const [y, pitch] = [camera.y, camera.pitch];
      camera.y += body.heave;
      camera.pitch += body.nod;
      camera.wide = 1 + WIDE_AT_SPEED * body.rush; // and the scooter's pull widens the view
      updateBasis(camera);
      renderer.render(time);
      camera.y = y;
      camera.pitch = pitch;
      camera.wide = 1;
      updateBasis(camera);
      hud.frame(frameMs, gpuMs, renderer.targets.width, renderer.targets.height, deviceWidth());
      hook.frames = (hook.frames ?? 0) + 1;
    };
    requestAnimationFrame((now) => {
      last = now;
      requestAnimationFrame(frame);
    });
    menu.ready();
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
