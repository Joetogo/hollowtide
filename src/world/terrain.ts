// From the density field to the terrain: floating specks removed, then a mesh of the rock surface, sorted for
// culling.
import { sampler, surfaceNets } from '../math/field';
import { clamp } from '../math/scalar';
import type { CellTable } from './data';
import { CELLS, CELL_SIZE, NX, NY, NZ, ORIGIN_X, ORIGIN_Y, ORIGIN_Z, VOXEL } from './grid';
import { hypot3 } from '../math/hypot';

/**
 * Turns rock that is not connected to the seabed into water, in place.
 *
 * Rock is rooted if its column is unbroken rock up from the bottom of the grid, or if it touches rooted rock
 * (overhangs, arches). What never connects is a speck of noise adrift in the water, which the mesher would turn
 * into a small floating box.
 */
export function removeSpecks(density: Float32Array): void {
  const slab = NX * NY;
  const ROOTED = 1;
  const PENDING = 2;
  const state = new Uint8Array(density.length);
  const pending: number[] = [];
  const unbroken = new Uint8Array(NX); // per x: is the column still unbroken rock up to this y?
  for (let i = 0, z = 0; z < NZ; z++) {
    unbroken.fill(1);
    for (let y = 0; y < NY; y++) {
      for (let x = 0; x < NX; x++, i++) {
        if (density[i] <= 0) unbroken[x] = 0;
        else if (unbroken[x]) state[i] = ROOTED;
        else {
          state[i] = PENDING;
          pending.push(i);
        }
      }
    }
  }
  // flood outwards from the rooted rock through the six neighbours. (The grid's sides and top are always water,
  // so an index that steps over the end of a row lands in water and nothing leaks across.)
  const neighbours = [1, -1, NX, -NX, slab, -slab];
  const queue: number[] = [];
  const root = (i: number) => {
    state[i] = ROOTED;
    queue.push(i);
  };
  for (const i of pending) if (neighbours.some((o) => state[i + o] === ROOTED)) root(i);
  while (queue.length) {
    const i = queue.pop()!;
    for (const o of neighbours) if (state[i + o] === PENDING) root(i + o);
  }
  for (const i of pending) if (state[i] === PENDING) density[i] = -density[i];
}

export interface Terrain {
  /** 16 bytes per vertex: world position, normal */
  vertices: ArrayBuffer;
  /** quads (six indices each), sorted by culling cell */
  indices: Uint32Array;
  vertexCount: number;
  /** quads per cell */
  cells: CellTable;
  /** world position and unit normal of every vertex, for the scattering that follows */
  positions: Float32Array;
  normals: Float32Array;
  /** the density at fractional grid coordinates */
  sample: (x: number, y: number, z: number) => number;
}

export function buildTerrain(density: Float32Array): Terrain {
  const net = surfaceNets(density, NX, NY, NZ);
  const vertexCount = net.vertexCount;
  const grid = net.positions;
  const sample = sampler(density, NX, NY, NZ);
  const vertices = new ArrayBuffer(vertexCount * 16);
  const floats = new Float32Array(vertices);
  const bytes = new Int8Array(vertices);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  for (let k = 0; k < vertexCount; k++) {
    const x = grid[k * 3],
      y = grid[k * 3 + 1],
      z = grid[k * 3 + 2];
    // the normal points down the density gradient, out of the rock
    const e = 0.8;
    let nx = sample(x - e, y, z) - sample(x + e, y, z);
    let ny = sample(x, y - e, z) - sample(x, y + e, z);
    let nz = sample(x, y, z - e) - sample(x, y, z + e);
    const length = hypot3(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    positions[k * 3] = floats[k * 4] = ORIGIN_X + x * VOXEL;
    positions[k * 3 + 1] = floats[k * 4 + 1] = ORIGIN_Y + y * VOXEL;
    positions[k * 3 + 2] = floats[k * 4 + 2] = ORIGIN_Z + z * VOXEL;
    normals[k * 3] = nx;
    normals[k * 3 + 1] = ny;
    normals[k * 3 + 2] = nz;
    bytes[k * 16 + 12] = Math.round(nx * 127);
    bytes[k * 16 + 13] = Math.round(ny * 127);
    bytes[k * 16 + 14] = Math.round(nz * 127);
    bytes[k * 16 + 15] = 127;
  }

  // sort the quads into the culling grid, by the cell of their first vertex
  const quads = net.indexCount / 6;
  const cellOf = new Uint8Array(quads);
  const start = new Uint32Array(CELLS * CELLS + 1);
  const lo = new Float32Array(CELLS * CELLS).fill(1e9);
  const hi = new Float32Array(CELLS * CELLS).fill(-1e9);
  for (let q = 0; q < quads; q++) {
    const a = net.indices[q * 6] * 3;
    const cell =
      clamp(Math.floor((positions[a] - ORIGIN_X) / CELL_SIZE), 0, CELLS - 1) +
      CELLS * clamp(Math.floor((positions[a + 2] - ORIGIN_Z) / CELL_SIZE), 0, CELLS - 1);
    cellOf[q] = cell;
    start[cell + 1]++;
    for (let j = 0; j < 6; j++) {
      const y = positions[net.indices[q * 6 + j] * 3 + 1];
      if (y < lo[cell]) lo[cell] = y;
      if (y > hi[cell]) hi[cell] = y;
    }
  }
  for (let c = 0; c < CELLS * CELLS; c++) start[c + 1] += start[c];
  const indices = new Uint32Array(net.indexCount);
  const fill = start.slice();
  for (let q = 0; q < quads; q++) {
    const o = fill[cellOf[q]]++ * 6;
    for (let j = 0; j < 6; j++) indices[o + j] = net.indices[q * 6 + j];
  }
  return { vertices, indices, vertexCount, cells: { start, lo, hi }, positions, normals, sample };
}
