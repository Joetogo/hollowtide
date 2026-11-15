// The world-generation worker: everything between the density field and the buffers the renderer uploads.
// So far the first half: specks, collision, terrain, the ground map and the meshes. Scattering (kelp, plants,
// rocks, sponges, corals, animals, particles) and the skylight volume follow.
import { clearancePoints } from '../camera/path';
import type { Level } from '../config/quality';
import { Random } from '../math/random';
import { buildCollisionField } from './collision';
import { buildGroundMap } from './groundMap';
import { VIEWPOINTS } from './layout';
import { buildMeshes } from './meshes';
import { checksum, type FromWorker, type ToWorker } from './protocol';
import { buildTerrain, removeSpecks } from './terrain';

/** The part of a dedicated worker's global scope this module uses. */
export interface WorkerScope {
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker, transfer: Transferable[]): void;
}

type Bytes = Uint8Array | Int8Array | Uint16Array | Uint32Array | Float32Array | Float64Array;

async function sha256(data: Bytes): Promise<string> {
  const bytes = new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function generate(
  scope: WorkerScope,
  densityBuffer: ArrayBuffer,
  level: Level,
  checksums: boolean,
): Promise<void> {
  /** Reports what was made under the name the reference rig uses for the same data. */
  const made = async (name: string, data: Bytes) => {
    if (checksums) scope.postMessage({ type: 'checksum', name, length: data.length, sha256: await sha256(data) }, []);
  };
  const random = new Random();
  const density = new Float32Array(densityBuffer);

  removeSpecks(density);
  await made('density', density);

  const collision = buildCollisionField(density);
  await made('collisionIndex', collision.index);
  await made('collisionBricks', collision.bricks);

  const terrain = buildTerrain(density);
  await made('terrainVertices', new Uint8Array(terrain.vertices));
  await made('terrainIndices', terrain.indices);
  await made('terrainStart', terrain.cells.start);
  await made('terrainLo', terrain.cells.lo);
  await made('terrainHi', terrain.cells.hi);

  await made('flyPoints', clearancePoints(VIEWPOINTS));
  await made('groundMap', buildGroundMap());

  const meshes = buildMeshes(random, level);
  await made('meshVertices', meshes.vertices);
  await made('meshIndices', meshes.indices);

  scope.postMessage({ type: 'done' }, []);
}

export function bootWorker(scope: WorkerScope): void {
  scope.onmessage = ({ data }) => {
    const failed = (error: unknown) =>
      scope.postMessage({ type: 'error', stage: data.type, message: String(error) }, []);
    try {
      switch (data.type) {
        case 'echo':
          scope.postMessage({ type: 'echo', buffer: data.buffer, checksum: checksum(data.buffer) }, [data.buffer]);
          break;
        case 'generate':
          generate(scope, data.density, data.level, data.checksums).catch(failed);
          break;
      }
    } catch (error) {
      failed(error);
    }
  };
  scope.postMessage({ type: 'ready' }, []);
}
