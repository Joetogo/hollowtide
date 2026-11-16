// The main thread's side of world generation: the density field on the GPU, then everything else in two workers.
import type { BodyMeshes } from '../body/meshes';
import type { TurtleMesh } from '../life/turtle';
import type { Level } from '../config/quality';
import type { CollisionField } from './collision';
import type { WorldData } from './data';
import { computeDensity } from './density';
import { STAGES, type FromWorker, type Grown, type SetPieces, type Stage, type ToWorker } from './protocol';

export interface Generated {
  world: WorldData;
  /**
   * The swimmer's arms and gear: not part of the world, and not in the first frame, so they are sculpted after
   * the world's own meshes and arrive when they are done.
   */
  body: Promise<BodyMeshes>;
  /** the turtle's mesh, which comes with the body */
  turtle: Promise<TurtleMesh>;
  /**
   * What the camera collides with. Nothing draws it, so the generator works it out after it has handed the
   * world over, and it arrives a moment later (about a tenth of a second).
   */
  collision: Promise<CollisionField>;
}

/** The share of the whole job that is done before the terrain worker starts (the density field). */
const DENSITY_SHARE = 0.08;

export interface GenerateOptions {
  /** Called as each stage starts, with how far along the whole job is (0..1). */
  onProgress?: (stage: Stage | 'density', fraction: number) => void;
  /** If given, filled with the SHA-256 of everything the generator makes (for comparing against the original). */
  checksums?: Record<string, { length: number; sha256: string }>;
  /** 0 or absent: the world as authored. Another whole number: other plants and rocks on the same seabed. */
  seed?: number;
}

type Results = Extract<FromWorker, { type: 'setPieces' | 'body' | 'world' | 'collision' }>;

/**
 * Runs one job in a worker of its own. `start` is called when the worker is up and sends it its job; each
 * result it posts goes to `onResult`. Resolves when the worker says it is done.
 */
function run(
  worker: Worker,
  start: (post: (message: ToWorker, transfer: Transferable[]) => void) => void | Promise<void>,
  onResult: (result: Results) => void,
  { onProgress, checksums }: GenerateOptions,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    worker.onerror = (event) => reject(new Error(`the world generator failed: ${event.message}`));
    worker.onmessage = ({ data }: MessageEvent<FromWorker>) => {
      switch (data.type) {
        case 'ready':
          Promise.resolve(start((message, transfer) => worker.postMessage(message, transfer))).catch(reject);
          break;
        case 'progress':
          onProgress?.(data.stage, DENSITY_SHARE + (1 - DENSITY_SHARE) * data.fraction);
          break;
        case 'checksum':
          if (checksums) checksums[data.name] = { length: data.length, sha256: data.sha256 };
          break;
        case 'setPieces':
        case 'body':
        case 'world':
        case 'collision':
          // the marks named hollowtide:… are how the benchmark sees where loading time goes
          performance.mark('hollowtide:' + data.type);
          onResult(data);
          break;
        case 'done':
          resolve();
          break;
        case 'error':
          reject(new Error(`the world generator failed in ${data.stage}: ${data.message}`));
          break;
      }
    };
  });
}

/** A promise with its resolve and reject on the outside. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  promise.catch(() => 0); // whoever awaits it still sees the failure; this keeps it from being "unhandled"
  return { promise, resolve, reject };
}

/** Resolves when the world can be drawn. Its collision field follows (see Generated). */
export async function generateWorld(
  device: GPUDevice,
  createWorker: () => Worker,
  level: Level,
  options: GenerateOptions = {},
): Promise<Generated> {
  const { onProgress, checksums } = options;
  onProgress?.('density', 0);
  const pieces = deferred<SetPieces>();
  const grown = deferred<Grown>();
  const collision = deferred<CollisionField>();
  const body = deferred<BodyMeshes>();
  const turtle = deferred<TurtleMesh>();

  // both workers start at once: one builds the meshes straight away, the other waits for the density field
  const workers = [createWorker(), createWorker()] as const;
  const density = computeDensity(device).then(async (field) => {
    performance.mark('hollowtide:density');
    if (checksums) {
      const digest = await crypto.subtle.digest('SHA-256', field);
      const sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
      checksums.densityRaw = { length: field.length, sha256 };
    }
    return field;
  });
  const onResult = (result: Results) => {
    if (result.type === 'setPieces') pieces.resolve(result);
    else if (result.type === 'body') {
      body.resolve(result.body);
      turtle.resolve(result.turtle);
    } else if (result.type === 'world') grown.resolve(result.world);
    else collision.resolve(result.collision);
  };
  Promise.all([
    run(workers[0], (post) => post({ type: 'setPieces', level, checksums: !!checksums }, []), onResult, options),
    run(
      workers[1],
      async (post) => {
        const field = await density;
        post({ type: 'generate', density: field.buffer, level, checksums: !!checksums, seed: options.seed ?? 0 }, [
          field.buffer,
        ]);
      },
      onResult,
      options,
    ),
  ])
    // a worker that finished without posting its results has failed as surely as one that said so
    .then(() => new Error('the world generator finished without a result'))
    .catch((error: unknown) => error)
    .then((error) => {
      for (const result of [pieces, grown, collision, body]) result.reject(error); // no effect on those already settled
      for (const worker of workers) worker.terminate();
    });

  const [{ meshes, groundMap }, rest] = await Promise.all([pieces.promise, grown.promise]);
  return {
    world: { ...rest, meshes, groundMap },
    body: body.promise,
    turtle: turtle.promise,
    collision: collision.promise,
  };
}

export { STAGES };
