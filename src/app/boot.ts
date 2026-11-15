// Main-thread start-up: device, renderer, frame loop.
// World generation, the menu, controls and sound are added by later milestones; for now the camera sits at the
// first viewpoint and the scene pass is empty, so the page shows only what the composite pass makes of nothing.
import { lookAt } from '../camera/camera';
import { quality } from '../config/quality';
import { createGpu, StartupError } from '../gpu/context';
import { createRenderer } from '../render/renderer';
import { VIEWPOINTS } from '../world/layout';
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
/** Until the generator exists there is no seabed to stand on; the original's is about here under viewpoint 1. */
const PROVISIONAL_SEABED = -43;

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
    const renderer = await createRenderer(gpu, quality(0));
    const view = VIEWPOINTS[0] as [number, number, number, number, number, number];
    lookAt(renderer.camera, view[0], PROVISIONAL_SEABED + view[1], view[2], view[3], view[4], view[5]);

    const info = gpu.adapter.info;
    hook.report = {
      adapter: [info.vendor, info.architecture, info.description].filter(Boolean).join(' '),
      size: [renderer.targets.width, renderer.targets.height],
    };
    if (__DEV__ || __HARNESS__) {
      hook.harness = createHarness(renderer);
      // ?world=reference: until the generator exists, the scene can be drawn from a dump of the original's world
      if (new URLSearchParams(location.search).get('world') === 'reference') {
        status.textContent = 'Loading the reference world…';
        const [eye] = await hook.harness.loadReferenceWorld('/fixtures/');
        lookAt(renderer.camera, eye![0]!, eye![1]!, eye![2]!, eye![3]!, eye![4]!, eye![5]!);
      }
    }
    if (__HARNESS__) hook.report.worker = await workerRoundTrip(createWorker);

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
    status.textContent = renderer.world
      ? 'Rebuild in progress: rock, seabed and set pieces, drawn from a dump of the original world.'
      : 'Rebuild in progress: the world generator is not built yet, so there is nothing to see here.';
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
