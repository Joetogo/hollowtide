// The main thread's side of world generation: the density field on the GPU, then everything else in the worker.
import type { Level } from '../config/quality';
import type { CollisionField } from './collision';
import type { WorldData } from './data';
import { computeDensity } from './density';
import { STAGES, type FromWorker, type Stage, type ToWorker } from './protocol';

export interface Generated {
  world: WorldData;
  collision: CollisionField;
}

/** The share of the whole job that is done before the worker starts (the density field). */
const DENSITY_SHARE = 0.08;

export interface GenerateOptions {
  /** Called as each stage starts, with how far along the whole job is (0..1). */
  onProgress?: (stage: Stage | 'density', fraction: number) => void;
  /** If given, filled with the SHA-256 of everything the generator makes (for comparing against the original). */
  checksums?: Record<string, { length: number; sha256: string }>;
}

export async function generateWorld(
  device: GPUDevice,
  createWorker: () => Worker,
  level: Level,
  { onProgress, checksums }: GenerateOptions = {},
): Promise<Generated> {
  onProgress?.('density', 0);
  const density = await computeDensity(device);
  if (checksums) {
    const digest = await crypto.subtle.digest('SHA-256', density);
    const sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    checksums.densityRaw = { length: density.length, sha256 };
  }
  const worker = createWorker();
  try {
    return await new Promise<Generated>((resolve, reject) => {
      let result: Generated | null = null;
      worker.onerror = (event) => reject(new Error(`the world generator failed: ${event.message}`));
      worker.onmessage = ({ data }: MessageEvent<FromWorker>) => {
        switch (data.type) {
          case 'ready': {
            const message: ToWorker = { type: 'generate', density: density.buffer, level, checksums: !!checksums };
            worker.postMessage(message, [density.buffer]);
            break;
          }
          case 'progress':
            onProgress?.(data.stage, DENSITY_SHARE + (1 - DENSITY_SHARE) * data.fraction);
            break;
          case 'checksum':
            if (checksums) checksums[data.name] = { length: data.length, sha256: data.sha256 };
            break;
          case 'world':
            result = { world: data.world, collision: data.collision };
            break;
          case 'done':
            if (result) resolve(result);
            else reject(new Error('the world generator finished without a world'));
            break;
          case 'error':
            reject(new Error(`the world generator failed in ${data.stage}: ${data.message}`));
            break;
        }
      };
    });
  } finally {
    worker.terminate();
  }
}

export { STAGES };
