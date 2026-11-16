// The world-generation worker: everything between the density field and the buffers the renderer uploads.
// Two of them run side by side. One takes the density field: specks, collision, terrain, then the scattering of
// plants, rocks, sponges, corals, animals and particles with the skylight volume. The other builds the meshes and
// the ground map, which need nothing from the first. Nothing here touches the GPU or the page.
import { clearancePoints } from '../camera/path';
import type { Level } from '../config/quality';
import { Random } from '../math/random';
import { buildCollisionField } from './collision';
import type { CellInstances } from './data';
import { buildGroundMap } from './groundMap';
import { VIEWPOINTS } from './layout';
import { buildMeshes } from './meshes';
import { checksum, STAGES, type FromWorker, type Grown, type Stage, type ToWorker } from './protocol';
import { scatter } from './scatter';
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

/** Every buffer behind the typed arrays of a value, for handing the whole thing over without copying. */
function buffersOf(value: unknown, found = new Set<ArrayBuffer>()): ArrayBuffer[] {
  if (ArrayBuffer.isView(value)) found.add(value.buffer as ArrayBuffer);
  else if (value && typeof value === 'object') for (const part of Object.values(value)) buffersOf(part, found);
  return [...found];
}

/** Reports what was made under the name the reference rig uses for the same data, if checksums were asked for. */
function reporter(scope: WorkerScope, checksums: boolean) {
  return async (name: string, data: Bytes) => {
    if (checksums) scope.postMessage({ type: 'checksum', name, length: data.length, sha256: await sha256(data) }, []);
  };
}

/**
 * The meshes and the ground map. Neither needs the density field, and every mesh builder starts its own random
 * stream, so this runs in a worker of its own while the other one is busy with the terrain.
 */
async function buildSetPieces(scope: WorkerScope, level: Level, checksums: boolean): Promise<void> {
  const made = reporter(scope, checksums);
  const meshes = buildMeshes(new Random(), level);
  await made('meshVertices', meshes.vertices);
  await made('meshIndices', meshes.indices);
  const groundMap = buildGroundMap();
  await made('groundMap', groundMap);
  scope.postMessage({ type: 'setPieces', meshes, groundMap }, buffersOf([meshes, groundMap]));
  scope.postMessage({ type: 'done' }, []);
}

async function generate(
  scope: WorkerScope,
  densityBuffer: ArrayBuffer,
  level: Level,
  checksums: boolean,
): Promise<void> {
  const made = reporter(scope, checksums);
  const madeCells = async (name: string, set: CellInstances<Uint8Array | Float32Array>) => {
    await made(name, set.instances);
    await made(name + 'Start', set.cells.start);
    await made(name + 'Lo', set.cells.lo);
    await made(name + 'Hi', set.cells.hi);
  };
  let done = 0;
  const begin = (stage: Stage) => {
    scope.postMessage({ type: 'progress', stage, fraction: done }, []);
    done += STAGES[stage];
  };
  const random = new Random();
  const density = new Float32Array(densityBuffer);

  begin('terrain');
  removeSpecks(density);
  await made('density', density);
  const terrain = buildTerrain(density);
  await made('terrainVertices', new Uint8Array(terrain.vertices));
  await made('terrainIndices', terrain.indices);
  await made('terrainStart', terrain.cells.start);
  await made('terrainLo', terrain.cells.lo);
  await made('terrainHi', terrain.cells.hi);
  const flyPoints = clearancePoints(VIEWPOINTS);
  await made('flyPoints', flyPoints);

  begin('plants');
  const scattered = scatter(random, level, density, terrain, flyPoints, VIEWPOINTS, () => begin('rocks'));
  await madeCells('leavesBig', scattered.leaves.big);
  await madeCells('leavesBigF', scattered.leaves.bigFar);
  await madeCells('leavesSmall', scattered.leaves.small);
  for (const [i, chunk] of scattered.chunks.entries()) await madeCells('chunks' + i, chunk);
  for (const [i, prop] of scattered.props.entries()) await madeCells('props' + i, prop);
  await made('solids', scattered.solids.instances);
  for (const name of ['glints', 'bubbles', 'fish', 'mantas', 'snow', 'volume'] as const)
    await made(name, scattered[name]);

  // the viewpoints are authored as a height above the seabed: now there is a seabed to stand them on
  const viewpoints = VIEWPOINTS.map((v) => [
    v[0]!,
    v[1]! + scattered.floorAt(v[0]!, v[2]!),
    v[2]!,
    v[3]!,
    v[4]!,
    v[5]!,
  ]);
  const world: Grown = {
    terrain: { vertices: new Uint8Array(terrain.vertices), indices: terrain.indices, cells: terrain.cells },
    solids: scattered.solids,
    chunks: scattered.chunks,
    props: scattered.props,
    leaves: scattered.leaves,
    glints: scattered.glints,
    bubbles: scattered.bubbles,
    fish: scattered.fish,
    mantas: scattered.mantas,
    snow: scattered.snow,
    volume: scattered.volume,
    viewpoints,
  };
  scope.postMessage({ type: 'world', world }, buffersOf(world));

  // last, because nothing on screen waits for it: the page can show the world while this is worked out
  const collision = buildCollisionField(density);
  await made('collisionIndex', collision.index);
  await made('collisionBricks', collision.bricks);
  scope.postMessage({ type: 'collision', collision }, buffersOf(collision));
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
        case 'setPieces':
          buildSetPieces(scope, data.level, data.checksums).catch(failed);
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
