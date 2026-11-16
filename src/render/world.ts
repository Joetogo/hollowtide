// The world on the GPU: vertex, index and instance buffers made from the generator's typed arrays.
import type { Gpu } from '../gpu/context';
import { breathe } from '../gpu/turns';
import type { CellInstances, CellTable, MeshRange, WorldData } from '../world/data';
import { CELL_COUNT, LEAF_BYTES, SOLID_BYTES, VERTEX_BYTES } from '../world/data';
import { CELLS, CELL_SIZE, NX, NY, NZ, ORIGIN_X, ORIGIN_Z } from '../world/grid';
import { GROUND_MAP_SIZE, type Scene } from './scene';
import { createSolidCull, type SolidCull } from './solids';

/** Mesh and terrain vertices: position, then normal xyz with one extra value (ambient occlusion and the like). */
export const MESH_VERTEX_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: VERTEX_BYTES,
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'snorm8x4' },
  ],
};
export const SOLID_INSTANCE_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: SOLID_BYTES,
  stepMode: 'instance',
  attributes: [
    { shaderLocation: 2, offset: 0, format: 'float32x4' },
    { shaderLocation: 3, offset: 16, format: 'float32x4' },
    { shaderLocation: 4, offset: 32, format: 'float32x4' },
  ],
};
export const LEAF_INSTANCE_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: LEAF_BYTES,
  stepMode: 'instance',
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x4' },
    { shaderLocation: 1, offset: 16, format: 'float32x4' },
    { shaderLocation: 2, offset: 32, format: 'unorm8x4' },
  ],
};

/** Fish and mantas: path centre + radius, then four motion values. */
export const CREATURE_INSTANCE_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: 32,
  stepMode: 'instance',
  attributes: [
    { shaderLocation: 2, offset: 0, format: 'float32x4' },
    { shaderLocation: 3, offset: 16, format: 'float32x4' },
  ],
};
/** Bubbles and glints: eight floats, with no mesh in front of them. */
export const SPRITE_INSTANCE_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: 32,
  stepMode: 'instance',
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x4' },
    { shaderLocation: 1, offset: 16, format: 'float32x4' },
  ],
};
export const SNOW_INSTANCE_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: 16,
  stepMode: 'instance',
  attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }],
};

/** An instance buffer drawn whole, or, if it comes with a cell table, sorted by culling cell. */
export interface InstanceBuffer {
  buffer: GPUBuffer;
  count: number;
  cells?: CellTable;
}

/** An instance buffer sorted by culling cell. */
export interface CellBuffer {
  buffer: GPUBuffer;
  count: number;
  cells: CellTable;
}

export interface WorldBuffers {
  terrainVertices: GPUBuffer;
  terrainIndices: GPUBuffer;
  terrainIndexCount: number;
  terrainCells: CellTable;
  meshVertices: GPUBuffer;
  meshIndices: GPUBuffer;
  meshes: MeshRange[];
  /**
   * Every solid (boulders, the ship, the whale tail), followed by one identity instance. The shadow bake draws
   * them all from here, and the terrain is drawn as the identity instance.
   */
  solids: GPUBuffer;
  /** The solids that may be in view this frame: what the scene pass draws. */
  solidCull: SolidCull;
  solidRanges: [first: number, count: number][];
  identityInstance: number;
  chunks: CellBuffer[];
  props: CellBuffer[];
  leavesBig: CellBuffer;
  leavesBigFar: CellBuffer;
  leavesSmall: CellBuffer;
  fish: InstanceBuffer;
  mantas: InstanceBuffer;
  bubbles: InstanceBuffer;
  glints: InstanceBuffer;
  snow: InstanceBuffer;
  destroy(): void;
}

// position 0, scale 1; no rotation; material 0 (terrain), seed 0, no fade, no bob
const IDENTITY_INSTANCE = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0];

/** After uploading this much, the page gets a turn: copying is slow enough to notice on a throttled laptop. */
const YIELD_BYTES = 2 << 20;

/**
 * Uploads a world. This copies about 200 MB to the GPU process, so it is done in turns: no single task holds the
 * main thread for long.
 */
/**
 * Sorts eight-float sprites (glints, bubbles) into the culling cells by where they are, keeping their order
 * within a cell. `reach` gives how far above its position a sprite can get. Done in turns: there are 600,000.
 */
export async function sortSprites(
  sprites: Float32Array,
  reach: (sprites: Float32Array, at: number) => number,
): Promise<CellInstances<Float32Array>> {
  const count = sprites.length / 8;
  const cellOf = (at: number) => {
    const x = Math.min(CELLS - 1, Math.max(0, Math.floor((sprites[at]! - ORIGIN_X) / CELL_SIZE)));
    const z = Math.min(CELLS - 1, Math.max(0, Math.floor((sprites[at + 2]! - ORIGIN_Z) / CELL_SIZE)));
    return x + CELLS * z;
  };
  const start = new Uint32Array(CELL_COUNT + 1);
  const lo = new Float32Array(CELL_COUNT).fill(Infinity);
  const hi = new Float32Array(CELL_COUNT).fill(-Infinity);
  const cell = new Uint16Array(count);
  const TURN = 30_000; // few enough that a turn is short even before this loop has been compiled
  for (let i = 0; i < count; i++) {
    const c = (cell[i] = cellOf(i * 8));
    start[c + 1]!++;
    const y = sprites[i * 8 + 1]!;
    if (y < lo[c]!) lo[c] = y;
    const top = y + reach(sprites, i * 8);
    if (top > hi[c]!) hi[c] = top;
    if (i % TURN === TURN - 1) await breathe();
  }
  for (let c = 0; c < CELL_COUNT; c++) start[c + 1]! += start[c]!;
  const next = start.slice(0, CELL_COUNT);
  const sorted = new Float32Array(sprites.length);
  for (let i = 0; i < count; i++) {
    const to = next[cell[i]!]!++ * 8;
    for (let f = 0; f < 8; f++) sorted[to + f] = sprites[i * 8 + f]!;
    if (i % TURN === TURN - 1) await breathe();
  }
  return { instances: sorted, cells: { start, lo, hi } };
}

/** @param cullSprites sort the glints and the bubbles into cells, so that only those in view need be drawn */
export async function uploadWorld(gpu: Gpu, scene: Scene, data: WorldData, cullSprites = false): Promise<WorldBuffers> {
  const { device, queue } = gpu;
  const buffers: GPUBuffer[] = [];
  let sinceYield = 0;
  const upload = async (label: string, bytes: Uint8Array | Uint32Array | Float32Array, usage: number) => {
    const buffer = device.createBuffer({
      label,
      size: (bytes.byteLength + 3) & ~3,
      usage: usage | GPUBufferUsage.COPY_DST,
    });
    // large buffers go over in slices, with a turn for the page in between
    for (let offset = 0; offset < bytes.byteLength || offset === 0; offset += YIELD_BYTES) {
      const size = Math.min(YIELD_BYTES, bytes.byteLength - offset);
      if (size > 0) queue.writeBuffer(buffer, offset, bytes.buffer, bytes.byteOffset + offset, size);
      sinceYield += size;
      if (sinceYield >= YIELD_BYTES) {
        sinceYield = 0;
        await breathe();
      }
      if (size <= 0) break;
    }
    buffers.push(buffer);
    return buffer;
  };
  const VERTEX = GPUBufferUsage.VERTEX;
  const cellBuffer = async (
    label: string,
    set: CellInstances<Uint8Array | Float32Array>,
    stride: number,
  ): Promise<CellBuffer> => ({
    buffer: await upload(label, set.instances, VERTEX),
    count: set.instances.byteLength / stride,
    cells: set.cells,
  });
  const instances = async (label: string, floats: Float32Array, perInstance: number): Promise<InstanceBuffer> => ({
    buffer: await upload(label, floats, VERTEX),
    count: floats.length / perInstance,
  });

  const sprites = async (
    label: string,
    floats: Float32Array,
    reach: (sprites: Float32Array, at: number) => number,
  ): Promise<InstanceBuffer> => {
    if (!cullSprites) return instances(label, floats, 8);
    const sorted = await sortSprites(floats, reach);
    return { buffer: await upload(label, sorted.instances, VERTEX), count: floats.length / 8, cells: sorted.cells };
  };

  const solidCull = createSolidCull(gpu, data);
  const solidCount = data.solids.instances.length / 12;
  const solids = new Float32Array((solidCount + 1) * 12);
  solids.set(data.solids.instances);
  solids.set(IDENTITY_INSTANCE, solidCount * 12);

  queue.writeTexture({ texture: scene.volume }, data.volume, { bytesPerRow: NX, rowsPerImage: NY / 2 }, [
    NX / 2,
    NY / 2,
    NZ / 2,
  ]);
  queue.writeTexture({ texture: scene.groundMap }, data.groundMap, { bytesPerRow: GROUND_MAP_SIZE * 4 }, [
    GROUND_MAP_SIZE,
    GROUND_MAP_SIZE,
  ]);

  const chunks: CellBuffer[] = [];
  for (const [i, c] of data.chunks.entries()) chunks.push(await cellBuffer(`chunks ${i}`, c, SOLID_BYTES));
  const props: CellBuffer[] = [];
  for (const [i, c] of data.props.entries()) props.push(await cellBuffer(`props ${i}`, c, SOLID_BYTES));
  return {
    terrainVertices: await upload('terrain vertices', data.terrain.vertices, VERTEX),
    terrainIndices: await upload('terrain indices', data.terrain.indices, GPUBufferUsage.INDEX),
    terrainIndexCount: data.terrain.indices.length,
    terrainCells: data.terrain.cells,
    meshVertices: await upload('mesh vertices', data.meshes.vertices, VERTEX),
    meshIndices: await upload('mesh indices', data.meshes.indices, GPUBufferUsage.INDEX),
    meshes: data.meshes.ranges,
    solids: await upload('solids', solids, VERTEX),
    solidCull,
    solidRanges: data.solids.ranges,
    identityInstance: solidCount,
    chunks,
    props,
    leavesBig: await cellBuffer('leaves', data.leaves.big, LEAF_BYTES),
    leavesBigFar: await cellBuffer('far leaves', data.leaves.bigFar, LEAF_BYTES),
    leavesSmall: await cellBuffer('small leaves', data.leaves.small, LEAF_BYTES),
    fish: await instances('fish', data.fish, 8),
    mantas: await instances('mantas', data.mantas, 8),
    // (a bubble rises the height of its column, which is its sixth float; a glint stays within a few centimetres)
    bubbles: await sprites('bubbles', data.bubbles, (b, at) => b[at + 6]!),
    glints: await sprites('glints', data.glints, () => 0.2),
    snow: await instances('snow', data.snow, 4),
    destroy() {
      buffers.forEach((b) => b.destroy());
      solidCull.destroy();
    },
  };
}
