// Main-thread start-up: device, renderer, frame loop, then the world from the generator.
// The menu, controls and sound are added by a later milestone; for now the camera sits at the first viewpoint.
import { lookAt } from '../camera/camera';
import { quality, type Level } from '../config/quality';
import { createGpu, StartupError } from '../gpu/context';
import { createRenderer } from '../render/renderer';
import { generateWorld } from '../world/client';
import { checksum, type FromWorker, type ToWorker } from '../world/protocol';
import { createHarness, type Harness } from './harness';

export interface BootReport {
  adapter: string;
  size: [width: number, height: number];
  /** harness builds only: a 16 MB buffer sent to the worker and back by transfer */
  worker?: { megabytes: number; roundTripMs: number; detached: boolean; intact: boolean };
}

declare global {
  interface Window {
    /** A handle for tests and harnesses; `ready` is set once start-up has finished or failed. */
    __abyssal?: {
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
/** What the page says while each stage of world generation runs. */
const LOADING = {
  density: 'Sculpting the seabed…',
  terrain: 'Carving canyons…',
  meshes: 'Building set pieces…',
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
  const status = document.getElementById('s')!;
  const hook: NonNullable<Window['__abyssal']> = (window.__abyssal = { frames: 0 });
  try {
    const gpu = await createGpu(document.getElementById('c') as HTMLCanvasElement);
    // dev and harness builds take the detail level from ?level=0|1|2; the menu that sets it comes later
    const params = new URLSearchParams(location.search);
    const asked = __DEV__ || __HARNESS__ ? Number(params.get('level')) : 0;
    const level: Level = asked === 1 || asked === 2 ? asked : 0;
    const renderer = await createRenderer(gpu, quality(level));

    const info = gpu.adapter.info;
    hook.report = {
      adapter: [info.vendor, info.architecture, info.description].filter(Boolean).join(' '),
      size: [renderer.targets.width, renderer.targets.height],
    };
    if (__DEV__ || __HARNESS__) hook.harness = createHarness(renderer, createWorker);
    if (__HARNESS__) hook.report.worker = await workerRoundTrip(createWorker);

    // the page draws from the start (an empty sea until the world arrives), so it never freezes while loading
    let first = 0;
    const frame = (now: number) => {
      requestAnimationFrame(frame);
      first ||= now;
      if (hook.paused) return;
      renderer.resize();
      renderer.render((now - first) / 1000);
      hook.frames = (hook.frames ?? 0) + 1;
    };
    requestAnimationFrame(frame);

    // Dev and harness builds can be told where the world comes from: ?world=reference draws a dump of the
    // original's world (npm run ref:dump), ?world=none starts without one (tests bring their own).
    const source = __DEV__ || __HARNESS__ ? params.get('world') : null;
    let viewpoints: number[][] | null = null;
    if (source === 'reference') {
      status.textContent = 'Loading the reference world…';
      viewpoints = await hook.harness!.loadReferenceWorld('/fixtures/');
    } else if (source !== 'none') {
      const { world } = await generateWorld(gpu.device, createWorker, level, {
        onProgress: (stage) => (status.textContent = LOADING[stage]),
      });
      renderer.setWorld(world);
      viewpoints = world.viewpoints;
    }
    if (viewpoints) {
      const [x, y, z, tx, ty, tz] = viewpoints[0] as [number, number, number, number, number, number];
      lookAt(renderer.camera, x, y, z, tx, ty, tz);
    }
    status.textContent = renderer.world
      ? 'Rebuild in progress: the scene is complete; controls, menu and sound come next.'
      : '';
  } catch (error) {
    hook.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
    // a StartupError is written for the reader; anything else is unexpected and says so
    status.textContent =
      error instanceof StartupError
        ? error.message
        : 'Failed to start: ' + (error instanceof Error ? error.message : String(error));
    console.error(error);
  }
  hook.ready = true;
  tell('result', { error: hook.error, report: hook.report, userAgent: navigator.userAgent });
}
