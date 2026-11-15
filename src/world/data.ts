// What the world generator hands to the renderer: plain typed arrays, ready to upload.
// The generator worker produces this; until it exists, the harness fills it from a dump of the original.
import { CELLS } from './grid';

/**
 * Items sorted by culling cell. Cell c (x + CELLS * z) owns items start[c] up to start[c + 1], and lo[c]..hi[c]
 * is the height range they span, for culling.
 */
export interface CellTable {
  start: Uint32Array; // CELLS * CELLS + 1 entries
  lo: Float32Array;
  hi: Float32Array;
}

export const CELL_COUNT = CELLS * CELLS;

/** Instances sorted by cell. `stride` bytes each. */
export interface CellInstances<T extends Uint8Array | Float32Array> {
  instances: T;
  cells: CellTable;
}

/** Where one mesh sits in the shared vertex and index buffers. */
export interface MeshRange {
  firstVertex: number;
  firstIndex: number;
  vertexCount: number;
  indexCount: number;
}

/** Positions in `WorldData.meshes.ranges`. */
export const MESH = {
  boulder: 0, // 0-3
  sponge: 4, // 4-6: three lathe-turned shapes
  coral: 7, // 7-8: branching and fan
  tubeSponge: 9,
  fluke: 10, // the stone whale tail
  ship: 11,
  manta: 12,
  fish: 13,
  chunk: 14, // 14-16 small rock chunks, 17-19 large, 20 pebbles
  coralFar: 21, // 21-22: coarser corals for the distance
  chunkFar: 23, // 23-25: coarser large chunks for the distance
} as const;

/** Bytes per vertex of every mesh and of the terrain: float32 x3 position, snorm8 x4 normal + extra. */
export const VERTEX_BYTES = 16;
/** Bytes per solid instance: position + scale, quaternion, material + seed + fade distance + bob (12 floats). */
export const SOLID_BYTES = 48;
/** Bytes per leaf instance: 8 floats (root + length, yaw, tilt, width, root height) and 4 bytes (type, seeds, bend). */
export const LEAF_BYTES = 36;

export interface WorldData {
  /** The seabed and rock walls: one indexed mesh, its quads (6 indices each) sorted by cell. */
  terrain: { vertices: Uint8Array; indices: Uint32Array; cells: CellTable };
  /** Every other mesh, in shared buffers. */
  meshes: { vertices: Uint8Array; indices: Uint32Array; ranges: MeshRange[] };
  /** Instances of meshes 0-11 that are not cell-sorted (boulders, the whale tail, the ship): [first, count] per mesh. */
  solids: { instances: Float32Array; ranges: [first: number, count: number][] };
  /** Seven rock chunk kinds (three small, three large, pebbles), each sorted by cell; mesh MESH.chunk + i. */
  chunks: CellInstances<Float32Array>[];
  /** Six sponge and coral kinds, each sorted by cell; mesh MESH.sponge + i. */
  props: CellInstances<Float32Array>[];
  leaves: {
    /** kelp and tall plants */
    big: CellInstances<Uint8Array>;
    /** every second one of `big`, half again as wide: drawn in their place far away */
    bigFar: CellInstances<Uint8Array>;
    /** ground cover and tufts */
    small: CellInstances<Uint8Array>;
  };
  glints: Float32Array; // 8 floats each
  bubbles: Float32Array; // 8 floats each
  fish: Float32Array; // 8 floats each
  mantas: Float32Array; // 8 floats each
  snow: Float32Array; // 4 floats each
  /** 256 x 40 x 256, two bytes per voxel: openness and skylight. */
  volume: Uint8Array;
  /** 512 x 512 RGBA over the whole ground plane: r magenta growth, b grotto zone, a sand. */
  groundMap: Uint8Array;
  /** The six viewpoints on the finished seabed: eye xyz, target xyz. */
  viewpoints: number[][];
}
