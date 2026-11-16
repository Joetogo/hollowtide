// Dressing the terrain: kelp, plants, rocks, sponges, corals, the set pieces, bubbles, animals and particles,
// and the skylight volume that the kelp shades.
//
// This is where the world gets its exact look, and it is defined by the order of the random draws. The code
// below therefore follows the original draw for draw: each system restarts the generator on its own stream and
// then consumes it in a fixed order. Changing the order of two draws, or making one conditional, moves every
// plant and rock that follows in that system. tests/browser/generator.mjs holds it to the original's checksums.
import type { Level } from '../config/quality';
import { fbm } from '../math/noise';
import { quatAxis, quatFromY, quatMul, quatRandom, type Quat } from '../math/quat';
import type { Random } from '../math/random';
import { clamp, mix, smoothRamp, TAU } from '../math/scalar';
import { CELL_COUNT, LEAF_BYTES, type CellInstances, type CellTable } from './data';
import { CELLS, CELL_SIZE, NX, NY, NZ, ORIGIN_X, ORIGIN_Y, ORIGIN_Z, VOXEL } from './grid';
import { grottoAt, magentaAt } from './groundMap';
import { MAGENTA_PATCHES } from './layout';
import type { Terrain } from './terrain';

const { abs, atan2, cos, floor, max, min, PI, pow, round, sin, sqrt } = Math;
const hypot = Math.hypot;
const fract = (x: number) => x - floor(x);

/** Leaf types, as the leaf shader numbers them. */
const LEAF = { kelp: 0, stem: 1, seagrass: 2, purple: 3, amber: 4, magenta: 5, frond: 6, tuft: 7 } as const;

export interface Scattered {
  leaves: { big: CellInstances<Uint8Array>; bigFar: CellInstances<Uint8Array>; small: CellInstances<Uint8Array> };
  /** instances of meshes 0-11 that are not sorted by cell, and where each mesh's run is */
  solids: { instances: Float32Array; ranges: [first: number, count: number][] };
  chunks: CellInstances<Float32Array>[];
  props: CellInstances<Float32Array>[];
  glints: Float32Array;
  bubbles: Float32Array;
  fish: Float32Array;
  mantas: Float32Array;
  snow: Float32Array;
  /** 256 x 40 x 256, two bytes per voxel: openness and skylight */
  volume: Uint8Array;
  /** y of the lowest floor at a point of the ground plane (-45 where there is none) */
  floorAt: (x: number, z: number) => number;
}

/** Leaves as they are emitted: kept in emission order with their cell, sorted by cell at the end. */
class LeafList {
  private bytes = new Uint8Array(LEAF_BYTES << 16);
  private floats = new Float32Array(this.bytes.buffer);
  private cell = new Uint8Array(1 << 16);
  count = 0;
  private readonly perCell = new Uint32Array(CELL_COUNT);
  readonly lo = new Float32Array(CELL_COUNT).fill(1e9);
  readonly hi = new Float32Array(CELL_COUNT).fill(-1e9);
  // the far set: every second leaf of each cell
  private readonly farLo = new Float32Array(CELL_COUNT).fill(1e9);
  private readonly farHi = new Float32Array(CELL_COUNT).fill(-1e9);

  add(
    cell: number,
    x: number,
    y: number,
    z: number,
    length: number,
    yaw: number,
    tilt: number,
    width: number,
    rootHeight: number,
    type: number,
    s1: number,
    s2: number,
    bend: number,
  ): void {
    if (this.count === this.cell.length) {
      const bytes = new Uint8Array(this.bytes.length * 2);
      bytes.set(this.bytes);
      this.bytes = bytes;
      this.floats = new Float32Array(bytes.buffer);
      const cells = new Uint8Array(this.cell.length * 2);
      cells.set(this.cell);
      this.cell = cells;
    }
    const k = this.count++;
    const f = this.floats;
    f[k * 9] = x;
    f[k * 9 + 1] = y;
    f[k * 9 + 2] = z;
    f[k * 9 + 3] = length;
    f[k * 9 + 4] = yaw;
    f[k * 9 + 5] = tilt;
    f[k * 9 + 6] = width;
    f[k * 9 + 7] = rootHeight;
    const b = this.bytes;
    // seeds and bend are 0..1, stored in 1/255 steps (cut off, not rounded)
    b[k * 36 + 32] = type;
    b[k * 36 + 33] = s1 * 255;
    b[k * 36 + 34] = s2 * 255;
    b[k * 36 + 35] = bend * 255;
    this.cell[k] = cell;
    // the height range of the cell's leaves, from the leaf's root less and plus its length
    if (y - length < this.lo[cell]) this.lo[cell] = y - length;
    if (y + length > this.hi[cell]) this.hi[cell] = y + length;
    if (!(this.perCell[cell]++ & 1)) {
      if (y - length < this.farLo[cell]) this.farLo[cell] = y - length;
      if (y + length > this.farHi[cell]) this.farHi[cell] = y + length;
    }
  }

  /** The leaves sorted by cell, keeping their order within each cell. */
  pack(): CellInstances<Uint8Array> {
    const start = new Uint32Array(CELL_COUNT + 1);
    for (let c = 0; c < CELL_COUNT; c++) start[c + 1] = start[c] + this.perCell[c];
    const fill = start.slice();
    const out = new Uint8Array(this.count * LEAF_BYTES);
    for (let k = 0; k < this.count; k++) {
      out.set(this.bytes.subarray(k * LEAF_BYTES, (k + 1) * LEAF_BYTES), fill[this.cell[k]]++ * LEAF_BYTES);
    }
    return { instances: out, cells: { start, lo: this.lo, hi: this.hi } };
  }

  /** Every second leaf of each cell, half again as wide: what stands in for the full set far away. */
  packFar(full: CellInstances<Uint8Array>): CellInstances<Uint8Array> {
    const start = new Uint32Array(CELL_COUNT + 1);
    for (let c = 0; c < CELL_COUNT; c++) start[c + 1] = start[c] + Math.ceil(this.perCell[c] / 2);
    const out = new Uint8Array(start[CELL_COUNT] * LEAF_BYTES);
    const floats = new Float32Array(out.buffer);
    let k = 0;
    for (let c = 0; c < CELL_COUNT; c++) {
      for (let i = full.cells.start[c]; i < full.cells.start[c + 1]; i += 2, k++) {
        out.set(full.instances.subarray(i * LEAF_BYTES, (i + 1) * LEAF_BYTES), k * LEAF_BYTES);
        floats[k * 9 + 6] *= 1.5;
      }
    }
    return { instances: out, cells: { start, lo: this.farLo, hi: this.farHi } };
  }
}

/** Twelve-float instances per cell, packed in cell order. The cell's height range is the instances' y, 3 m either way. */
function packCells(lists: number[][]): CellInstances<Float32Array> {
  const start = new Uint32Array(CELL_COUNT + 1);
  let n = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
    start[c] = n;
    n += lists[c].length / 12;
  }
  start[CELL_COUNT] = n;
  const instances = new Float32Array(n * 12);
  const lo = new Float32Array(CELL_COUNT).fill(1e9);
  const hi = new Float32Array(CELL_COUNT).fill(-1e9);
  let k = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
    const a = lists[c];
    for (let i = 0; i < a.length; i += 12) {
      for (let j = 0; j < 12; j++) instances[k++] = a[i + j];
      lo[c] = min(lo[c], a[i + 1] - 3);
      hi[c] = max(hi[c], a[i + 1] + 3);
    }
  }
  return { instances, cells: { start, lo, hi } satisfies CellTable };
}

const perCell = (): number[][] => Array.from({ length: CELL_COUNT }, () => []);

/**
 * @param density the density field, specks removed
 * @param flyPoints the camera path's clearance points, three numbers each
 * @param viewpoints the six authored viewpoints (their height is not used here)
 */
export function scatter(
  random: Random,
  level: Level,
  density: Float32Array,
  terrain: Terrain,
  flyPoints: Float64Array,
  viewpoints: readonly (readonly number[])[],
  /** called when the plants are done and the rocks, sponges and corals begin, for the progress display */
  halfWay?: () => void,
): Scattered {
  const rnd = () => random.next();
  const rr = (a: number, b: number) => random.range(a, b);
  const rseed = (stream: number) => random.reseed(stream);
  const T = { wp: terrain.positions, wn: terrain.normals, nv: terrain.vertexCount };

  const gi = (x: number, y: number, z: number) => x + NX * (y + NY * z);
  /** the density at a world position */
  const Dw = (x: number, y: number, z: number) =>
    terrain.sample((x - ORIGIN_X) / VOXEL, (y - ORIGIN_Y) / VOXEL, (z - ORIGIN_Z) / VOXEL);
  const cellOf = (x: number, z: number) =>
    clamp(floor((x - ORIGIN_X) / CELL_SIZE), 0, CELLS - 1) +
    CELLS * clamp(floor((z - ORIGIN_Z) / CELL_SIZE), 0, CELLS - 1);

  const big = new LeafList();
  const small = new LeafList();
  // Medium and Low keep every 2nd / 4th leaf, glint and pebble (but every kelp stem), and make the leaves that
  // stay wider. One counter thins all three, and the random draws are the same whether or not an item is kept.
  const THIN = 1 << level;
  let nth = 0;
  const leaf = (
    list: LeafList,
    x: number,
    y: number,
    z: number,
    len: number,
    yaw: number,
    tilt: number,
    wid: number,
    hA: number,
    type: number,
    s1: number,
    s2: number,
    bend: number,
  ) => {
    if (type === LEAF.stem || !(nth++ % THIN))
      list.add(
        cellOf(x, z),
        x,
        y,
        z,
        len,
        yaw,
        tilt,
        type === LEAF.stem ? wid : wid * (1 + level / 2),
        hA,
        type,
        s1,
        s2,
        bend,
      );
  };
  const glints: number[] = [];
  const glint = (x: number, y: number, z: number, hA: number, seed: number, hue: number, size: number, pad: number) => {
    if (!(nth++ % THIN)) glints.push(x, y, z, hA, seed, hue, size, pad);
  };
  // twelve floats per instance: position, scale, rotation, material, seed, fade distance or texture scale, bob
  const solids: number[][] = []; // by mesh, for meshes that are drawn whole
  const props = Array.from({ length: 6 }, perCell); // sponges and corals, meshes 4-9, by cell
  const solid = (
    mesh: number,
    x: number,
    y: number,
    z: number,
    sc: number,
    q: Quat,
    mat: number,
    seed: number,
    ts = 1,
    bob = 0,
  ) => {
    (mesh > 3 && mesh < 10 ? props[mesh - 4][cellOf(x, z)] : (solids[mesh] ||= [])).push(
      x,
      y,
      z,
      sc,
      q[0],
      q[1],
      q[2],
      q[3],
      mat,
      seed,
      ts,
      bob,
    );
  };
  const chunks = Array.from({ length: 7 }, perCell);
  /** A point `f` metres in front of viewpoint i and `r` metres to its right, on the ground plane. */
  const rel = (i: number, f: number, r: number): [number, number] => {
    const p = viewpoints[i];
    let fx = p[3] - p[0],
      fz = p[5] - p[2];
    const l = hypot(fx, fz);
    fx /= l;
    fz /= l;
    return [p[0] + fx * f - fz * r, p[2] + fz * f + fx * r];
  };
  const bubbles: number[] = [];
  /** how much kelp stands in each voxel of the half-resolution volume: it shades the skylight below it */
  const kelpAbs = new Float32Array((NX / 2) * (NY / 2) * (NZ / 2));

  // ---------------------------------------------------------------- surface queries
  /** Every floor in the column at (x, z), top down: y and headroom, in pairs. The array is reused between calls. */
  const fl: number[] = [];
  const floorsAt = (x: number, z: number) => {
    const ix = clamp(round((x - ORIGIN_X) / VOXEL), 1, NX - 2),
      iz = clamp(round((z - ORIGIN_Z) / VOXEL), 1, NZ - 2);
    fl.length = 0;
    let ceil = 3;
    for (let gy = NY - 2; gy >= 0; gy--) {
      const d = density[gi(ix, gy, iz)],
        da = density[gi(ix, gy + 1, iz)];
      if (da <= 0 && d > 0) {
        const y = ORIGIN_Y + (gy + d / (d - da)) * VOXEL;
        fl.push(y, min(ceil, 0) - y);
      } else if (da > 0 && d <= 0) ceil = ORIGIN_Y + (gy + 0.5) * VOXEL;
    }
    return fl;
  };
  /** the surface normal at a world position */
  const grad = (x: number, y: number, z: number): [number, number, number] => {
    const e = 0.6;
    const nx = Dw(x - e, y, z) - Dw(x + e, y, z),
      ny = Dw(x, y - e, z) - Dw(x, y + e, z),
      nz = Dw(x, y, z - e) - Dw(x, y, z + e);
    const l = hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  };
  /** From 2.5 m out along n, marches back in to the rock surface: position and normal there, or null. */
  const snap = (x: number, y: number, z: number, n: readonly number[]): number[] | null => {
    let px = x + n[0] * 2.5,
      py = y + n[1] * 2.5,
      pz = z + n[2] * 2.5,
      prev = Dw(px, py, pz);
    if (prev > 0) return null;
    for (let i = 0; i < 24; i++) {
      const qx = px - n[0] * 0.25,
        qy = py - n[1] * 0.25,
        qz = pz - n[2] * 0.25,
        d = Dw(qx, qy, qz);
      if (d > 0) {
        const t = prev / (prev - d);
        const p = [mix(px, qx, t), mix(py, qy, t), mix(pz, qz, t)];
        return p.concat(grad(p[0], p[1], p[2]));
      }
      px = qx;
      py = qy;
      pz = qz;
      prev = d;
    }
    return null;
  };
  /** a random terrain vertex, as an offset into T.wp / T.wn */
  const pickV = () => ((rnd() * T.nv) | 0) * 3;
  const tangent = (n: readonly number[]): [number[], number[]] => {
    let t = abs(n[1]) < 0.9 ? [n[2], 0, -n[0]] : [1, 0, 0];
    const l = hypot(...t);
    t = t.map((v) => v / l);
    return [t, [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]]];
  };
  /** within r metres (on the ground plane) of the camera path, at about its height */
  const nearFly = (x: number, y: number, z: number, r: number) => {
    for (let i = 0; i < flyPoints.length; i += 3) {
      if (hypot(x - flyPoints[i], z - flyPoints[i + 2]) < r && y < flyPoints[i + 1] + 3 && y > flyPoints[i + 1] - 13)
        return true;
    }
    return false;
  };
  const nearPose = (x: number, z: number, r = 3) => {
    for (const p of viewpoints) if (hypot(x - p[0], z - p[2]) < r) return true;
    return false;
  };

  // ---------------------------------------------------------------- kelp columns
  // kind 0: olive kelp; 1: the grotto's purple and amber; 2: amber mixed with olive
  const column = (x: number, y: number, z: number, H: number, kind: number, dens = 1) => {
    const strands = 2 + (rnd() < 0.6 ? 1 : 0) + (rnd() < 0.3 ? 1 : 0),
      ph = rnd() * TAU,
      tw = rr(0.1, 0.28),
      sr = rr(0.2, 0.55),
      sc = rr(0.75, 1.25);
    const la = rnd() * TAU,
      lm = rr(0, 0.11),
      full = rr(0.55, 1.3) * dens;
    // the strands wind around each other, closing in towards the top, and the whole column leans
    const stem = (s: number, h: number) => {
      const a = ph + (s * TAU) / strands + h * tw,
        r = sr * (1 - (0.6 * h) / H),
        ln = (lm * h * h) / H;
      return [x + cos(a) * r + cos(la) * ln, z + sin(a) * r + sin(la) * ln, a];
    };
    for (let s = 0; s < strands; s++) {
      for (let h = 0; h < H - 1; h += 1.7) {
        const p = stem(s, h);
        leaf(big, p[0], y + h, p[1], 2.1, p[2] + PI / 2, 0.1, 0.17, h, LEAF.stem, rnd(), rnd(), 0.3);
      }
    }
    const n = floor(H * 30 * full);
    for (let i = 0; i < n; i++) {
      const t = pow(rnd(), 0.9),
        h = t * H,
        p = stem((rnd() * strands) | 0, h);
      const L = ((0.55 + 0.75 * rnd() * rnd()) * (1 - 0.5 * t * t) * sc + 0.25) * (kind === 1 ? 1.25 : 1.15);
      const tilt = mix(rr(0.4, 1.0), rr(0.15, 0.45), t);
      const type =
        kind === 1
          ? rnd() < 0.8
            ? LEAF.purple
            : LEAF.amber
          : kind === 2
            ? rnd() < 0.5
              ? LEAF.amber
              : LEAF.kelp
            : LEAF.kelp;
      leaf(
        big,
        p[0],
        y + h,
        p[1],
        L,
        rnd() * TAU,
        tilt,
        L * (kind === 1 ? rr(0.09, 0.13) : rr(0.15, 0.21)) + 0.03,
        h,
        type,
        rnd(),
        rnd(),
        rr(0.38, 0.95),
      );
    }
    for (let i = floor(H * (kind === 1 ? 16 : 13)); i > 0; i--) {
      const h = rnd() * H,
        a = rnd() * TAU,
        r = rr(0.15, 0.8) * (1 - (0.5 * h) / H),
        ln = (lm * h * h) / H;
      glint(
        x + cos(a) * r + cos(la) * ln,
        y + h,
        z + sin(a) * r + sin(la) * ln,
        h,
        rnd(),
        kind === 1 ? rnd() : rnd() * 0.6,
        rr(0.018, 0.05),
        0,
      );
    }
    // the column's footprint in the skylight bake
    const hx = round((x - ORIGIN_X) / VOXEL / 2),
      hz = round((z - ORIGIN_Z) / VOXEL / 2);
    for (let hy = floor((y - ORIGIN_Y) / VOXEL / 2); hy <= floor((y + H - ORIGIN_Y) / VOXEL / 2); hy++) {
      if (hy >= 0 && hy < NY / 2 && hx > 0 && hx < NX / 2 - 1 && hz > 0 && hz < NZ / 2 - 1)
        kelpAbs[hx + (NX / 2) * (hy + (NY / 2) * hz)] += 0.17;
    }
  };
  // where kelp grows (x, z, radius, density) and where it must not (x, z, radius)
  const KELP_ZONES = [
    [-32, -5, 13, 0.85],
    [0, -86, 46, 1],
    [72, -26, 27, 0.9],
    [-60, -4, 11, 0.8],
    [0, -36, 12, 0.55],
    [-17, -8, 6, 0.8],
    [15, -8, 6, 0.8],
    [-4, 120, 20, 0.4],
    [-45, -63, 15, 0.9],
    [62, -26, 12, 0.9],
    [-100, 70, 30, 0.8],
    [100, 60, 30, 0.8],
    [-95, -90, 32, 0.8],
    [105, -85, 30, 0.7],
  ];
  const NO_KELP = [
    [-5, -106.5, 8],
    [4.6, -109.4, 10],
    [14.2, -112.3, 12],
    [-26, -100, 6],
    [-20.5, -101.7, 4.5],
    [-14.8, -104.5, 6],
    [-7.5, -107.8, 7],
    [4, 112, 11],
    [2, 4, 15],
    [42, 22, 12],
    [6, 78, 19],
    [-58, -16, 8],
    [9, -66, 9],
    [8, -76, 8],
  ];
  const kelpDens = (x: number, z: number) => {
    for (const p of NO_KELP) if (hypot(x - p[0], z - p[1]) < p[2]) return 0;
    let d = smoothRamp(0.52, 0.64, fbm(x * 0.022, 4, z * 0.022, 3)) * 0.5;
    for (const p of KELP_ZONES) d = max(d, p[3] * smoothRamp(p[2], p[2] * 0.75, hypot(x - p[0], z - p[1])));
    return d;
  };
  /** one column per 2.3 m square */
  const occ = new Set<number>();
  rseed(1);
  const tryColumn = (x: number, z: number, kind: number, force: boolean, dens = 1) => {
    const key = floor(x / 2.3) * 4096 + floor(z / 2.3);
    if (occ.has(key)) return;
    // on a floor with more than 9 m of water above it, picked at random if there are several
    const f = floorsAt(x, z);
    const c: number[] = [];
    for (let i = 0; i < f.length; i += 2) if (f[i + 1] > 9) c.push(i);
    if (!c.length) return;
    const i = c[(rnd() * c.length) | 0],
      y = f[i];
    if (grad(x, y, z)[1] < 0.55) return; // too steep
    if (!force) {
      let onPath = false;
      for (let k = 0; k < flyPoints.length; k += 3)
        if (hypot(x - flyPoints[k], z - flyPoints[k + 2]) < 5) {
          onPath = true;
          break;
        }
      if (onPath) return;
    }
    occ.add(key);
    column(x, y - 0.3, z, min(f[i + 1] - rr(0.8, 5), force ? rr(30, 42) : rr(15, 40)), kind, dens);
  };
  // hand-placed columns framing the viewpoints: x, z, kind, density
  const PLACED: (number | undefined)[][] = [
    [...rel(0, 11, -8.5), 0],
    [...rel(0, 16, -10.5), 0],
    [...rel(0, 21, -9), 0],
    [...rel(0, 9, 7), 0],
    [...rel(0, 14, 9.5), 0],
    [...rel(0, 19, 8), 0],
    [...rel(0, 26, 6), 0],
    [...rel(5, 6.5, 5.2), 1],
    [...rel(5, 12, 7), 1],
    [...rel(5, 15, -8), 0],
    [...rel(5, 22, -5), 1],
    [...rel(3, 12, -5.5), 0],
    [...rel(3, 16, 5.5), 0],
    [...rel(3, 20, -4.5), 0],
    [...rel(3, 25, 6), 0],
    [...rel(3, 13, 8), 0],
    [...rel(3, 30, -7), 0],
    [24, 62, 1],
    [-6, 96, 1],
    [20, 96, 2],
    [-10, 70, 0],
    [16, 52, 1],
    [...rel(4, 15, -9), 0, 1.2],
    [...rel(4, 19, -13), 0, 1.2],
    [...rel(4, 23, -8.5), 0, 1.2],
    [...rel(4, 25, -15), 0, 1.2],
    [...rel(4, 25, 0.5), 2, 1.2],
    [...rel(4, 27, -3), 2, 1.2],
    [...rel(4, 28, 3.5), 2, 1.2],
    [...rel(4, 31, 0), 0, 1.3],
    [...rel(4, 33, -5), 0, 1.3],
    [...rel(4, 33, 5), 0, 1.3],
    [...rel(4, 21, 9), 0, 1.2],
    [...rel(4, 27, 11), 0, 1.2],
    [...rel(2, 6.5, -5.5), 0, 1.5],
    [...rel(2, 9.5, -8), 0, 1.3],
    [...rel(2, 8, 6), 0, 1.4],
    [...rel(2, 12, 3.6), 0, 1.3],
    [...rel(2, 17, -2.5), 0, 1.2],
    [...rel(2, 21, 4), 0, 1.2],
    [...rel(2, 12, -4.5), 2, 1.2],
    [...rel(2, 27, -9), 0, 1.2],
    [...rel(2, 30, 8.5), 0, 1.2],
    [...rel(2, 37, -3), 0, 1.1],
    [...rel(2, 13.5, 6.5), 0, 1.3],
    [...rel(2, 14.5, -7), 0, 1.3],
    [...rel(2, 6.5, 6.5), 0, 1.3],
    [...rel(2, 9, -8), 2, 1.3],
  ];
  for (const p of PLACED) tryColumn(p[0]!, p[1]!, p[2]!, true, p[3]);
  // random columns across the world
  rseed(2);
  for (let i = 0; i < 15000; i++) {
    const a = rnd() * TAU,
      r = sqrt(rnd()) * 170,
      x = cos(a) * r,
      z = sin(a) * r;
    if (rnd() < kelpDens(x, z)) tryColumn(x, z, grottoAt(x, z) > 0.5 && rnd() < 0.5 ? 1 : rnd() < 0.03 ? 2 : 0, false);
  }

  // ---------------------------------------------------------------- clusters of ribbon leaves on the ground
  const cluster = (
    x: number,
    y: number,
    z: number,
    n: number,
    type: number,
    lmin: number,
    lmax: number,
    wmin: number,
    wmax: number,
    tmax: number,
    sway: number,
  ) => {
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU,
        r = rnd() * 0.5,
        L = rr(lmin, lmax);
      leaf(
        big,
        x + cos(a) * r,
        y - 0.15,
        z + sin(a) * r,
        L,
        a,
        rr(0.05, tmax),
        rr(wmin, wmax),
        sway,
        type,
        rnd(),
        rnd(),
        rr(0.3, 0.8),
      );
    }
  };
  // where ground plants are thickest: x, z, radius
  const HOT = [
    [0, 5, 30],
    [42, 30, 24],
    [6, 82, 34],
    [-58, 10, 24],
    [4, -88, 30],
    [-36, 44, 18],
    [-46, -60, 20],
  ];
  const hot = (x: number, z: number) => {
    let h = 0.4;
    for (const p of HOT) h = max(h, smoothRamp(p[2], p[2] * 0.4, hypot(x - p[0], z - p[1])));
    return h;
  };
  rseed(3);
  for (let i = 0; i < 40000; i++) {
    const k = pickV(),
      x = T.wp[k],
      y = T.wp[k + 1],
      z = T.wp[k + 2],
      ny = T.wn[k + 1];
    if (hypot(x, z) > 172 || y > -6) continue;
    const h = hot(x, z),
      zp = grottoAt(x, z),
      u = rnd();
    if (nearFly(x, y, z, 4) || hypot(x + 1, z - 2) < 9 || nearPose(x, z, 8)) continue;
    if (ny > 0.75 && u < 0.1 * h) cluster(x, y, z, (8 + rnd() * 14) | 0, LEAF.seagrass, 1.0, 3.0, 0.13, 0.26, 0.6, 2.5);
    else if (ny > 0.6 && u < 0.1 * h + 0.07 * max(zp, h * 0.4))
      cluster(x, y, z, (10 + rnd() * 18) | 0, rnd() < 0.8 ? LEAF.purple : LEAF.amber, 0.9, 2.6, 0.14, 0.28, 0.9, 1.5);
    else if (ny < -0.35 && u < 0.5 * max(zp, 0.2)) {
      // fronds hanging under overhangs
      const n = (12 + rnd() * 20) | 0;
      for (let j = 0; j < n; j++)
        leaf(
          big,
          x + rr(-0.6, 0.6),
          y + 0.2,
          z + rr(-0.6, 0.6),
          rr(0.8, 3.2),
          rnd() * TAU,
          PI - rr(0, 0.4),
          rr(0.08, 0.18),
          0,
          zp > 0.3 || rnd() < 0.5 ? LEAF.frond : LEAF.kelp,
          rnd(),
          rnd(),
          rr(0.3, 0.6),
        );
    } else if (ny > -0.2 && ny < 0.8 && u < 0.07) {
      // tufts growing out of walls
      const yaw = atan2(T.wn[k + 2], T.wn[k]),
        n = (5 + rnd() * 7) | 0;
      for (let j = 0; j < n; j++)
        leaf(
          big,
          x,
          y,
          z,
          rr(0.5, 1.4),
          yaw + rr(-0.9, 0.9),
          rr(0.3, 1.1),
          rr(0.06, 0.12),
          0.5,
          zp > 0.4 && rnd() < 0.6 ? LEAF.purple : LEAF.kelp,
          rnd(),
          rnd(),
          rr(0.2, 0.6),
        );
    }
  }
  // ---------------------------------------------------------------- ground cover: carpets of small tufts in the magenta patches
  rseed(4);
  for (const p of MAGENTA_PATCHES) {
    for (let i = p[2] * p[2] * PI * 45; i > 0; i--) {
      const a = rnd() * TAU,
        r = sqrt(rnd()) * p[2],
        x = p[0] + cos(a) * r,
        z = p[1] + sin(a) * r;
      if (rnd() > magentaAt(x, z) + 0.12 || nearPose(x, z)) continue;
      const f = floorsAt(x, z);
      if (!f.length) continue;
      const y = f[f.length - 2];
      if (grad(x, y, z)[1] < 0.7) continue;
      const nl = 2 + ((rnd() * 3) | 0),
        yw = rnd() * TAU;
      for (let j = 0; j < nl; j++)
        leaf(
          small,
          x,
          y - 0.03,
          z,
          rr(0.08, 0.26),
          yw + (j * TAU) / nl + rr(-0.4, 0.4),
          rr(0.15, 0.85),
          rr(0.035, 0.07),
          0,
          LEAF.magenta,
          rnd(),
          rnd(),
          rr(0.3, 0.7),
        );
      if (rnd() < 0.3)
        for (let j = 0; j < 2; j++)
          leaf(
            small,
            x + rr(-0.2, 0.2),
            y - 0.04,
            z + rr(-0.2, 0.2),
            rr(0.2, 0.55),
            rnd() * TAU,
            rr(0.05, 0.6),
            rr(0.03, 0.06),
            0,
            LEAF.tuft,
            rnd(),
            rnd(),
            rr(0.3, 0.8),
          );
      if (rnd() < 0.3) glint(x, y + rr(0.08, 0.22), z, 0, rnd(), 0.82 + rnd() * 0.18, rr(0.01, 0.02), 0);
    }
  }
  rseed(5);
  for (let i = 0; i < 620000; i++) {
    const k = pickV(),
      ny = T.wn[k + 1];
    if (ny < 0.72) continue;
    const x = T.wp[k] + rr(-0.45, 0.45),
      z = T.wp[k + 2] + rr(-0.45, 0.45),
      y = T.wp[k + 1];
    if (hypot(x, z) > 170 || nearPose(x, z)) continue;
    const m = magentaAt(x, z),
      zp = grottoAt(x, z),
      u = rnd();
    if (m > 0.3 && u < m * 0.9)
      for (let j = 0; j < 4; j++)
        leaf(
          small,
          x + rr(-0.1, 0.1),
          y - 0.05,
          z + rr(-0.1, 0.1),
          rr(0.12, 0.34),
          rnd() * TAU,
          rr(0.05, 0.75),
          rr(0.04, 0.08),
          0,
          LEAF.magenta,
          rnd(),
          rnd(),
          rr(0.3, 0.7),
        );
    else if (u < m * 0.9 + 0.5 * max(zp, hot(x, z)) * smoothRamp(0.42, 0.6, fbm(x * 0.09, 9, z * 0.09, 2)))
      for (let j = 0; j < 3; j++)
        leaf(
          small,
          x + rr(-0.1, 0.1),
          y - 0.05,
          z + rr(-0.1, 0.1),
          rr(0.25, 0.7),
          rnd() * TAU,
          rr(0.1, 0.8),
          rr(0.05, 0.1),
          0,
          LEAF.tuft,
          rnd(),
          rnd(),
          rr(0.3, 0.8),
        );
  }

  halfWay?.();

  // ---------------------------------------------------------------- sponges and coral, in clusters on rock
  /** places that will vent bubbles: beside some of the sponge clusters */
  const spots: number[][] = [];
  const SPONGE_ZONES = [
    [-58, 8, 30, 1],
    [0, 0, 30, 0.7],
    [6, 84, 36, 0.9],
    [4, -88, 22, 0.6],
    [44, 20, 24, 0.5],
  ];
  const zw = (x: number, z: number) => {
    let h = 0.45;
    for (const p of SPONGE_ZONES) h = max(h, p[3] * smoothRamp(p[2], p[2] * 0.4, hypot(x - p[0], z - p[1])));
    return h;
  };
  rseed(6);
  for (let i = 0; i < 13000; i++) {
    const k = pickV(),
      x = T.wp[k],
      y = T.wp[k + 1],
      z = T.wp[k + 2];
    if (hypot(x, z) > 170 || y > -8 || T.wn[k + 1] < -0.15 || rnd() > zw(x, z) || nearFly(x, y, z, 3)) continue;
    const n0 = [T.wn[k], T.wn[k + 1], T.wn[k + 2]],
      [t1, t2] = tangent(n0),
      coral = T.wn[k + 1] > 0.85 || rnd() < 0.35,
      cnt = coral ? (2 + rnd() * 5) | 0 : (3 + rnd() * 9) | 0,
      sd = rnd();
    for (let j = 0; j < cnt; j++) {
      const a = rr(-1, 1) * (0.5 + cnt * 0.13),
        b = rr(-1, 1) * (0.5 + cnt * 0.13);
      const s = snap(x + t1[0] * a + t2[0] * b, y + t1[1] * a + t2[1] * b, z + t1[2] * a + t2[2] * b, n0);
      if (!s) continue;
      // standing between the surface normal and straight up
      let ux = s[3],
        uy = s[4] + (coral ? 0.9 : 1.1),
        uz = s[5];
      const l = hypot(ux, uy, uz);
      ux /= l;
      uy /= l;
      uz /= l;
      const q = quatMul(quatFromY(ux, uy, uz), quatAxis(0, 1, 0, rnd() * TAU)),
        sc = coral ? rr(0.5, 1.5) : rr(0.35, 0.9) * (rnd() < 0.1 ? 1.6 : 1);
      solid(
        coral ? 7 + ((rnd() * 3) | 0) : 4 + ((rnd() * 3) | 0),
        s[0] - ux * 0.12 * sc,
        s[1] - uy * 0.12 * sc,
        s[2] - uz * 0.12 * sc,
        sc,
        q,
        coral ? 5 : 4,
        fract(sd + rr(-0.03, 0.03)),
        1,
        0,
      );
    }
    if (!coral && rnd() < 0.3) spots.push([x + n0[0], y + n0[1] + 0.5, z + n0[2]]);
  }
  // dense sponge and coral gardens: x, z, radius, count
  rseed(7);
  for (const g of [
    [-68, -6, 9, 260],
    [-66, 6, 7, 160],
    [16, 72, 7, 200],
    [-6, 74, 6, 120],
    [-13, -2, 6, 80],
    [8, -88, 8, 160],
    [44, 12, 7, 120],
    [-62, 22, 6, 140],
    [-47, 40, 6, 140],
    [-30, 47, 6, 120],
    [-12, 48, 5, 100],
    [14, 28, 6, 140],
    [28, 45, 6, 120],
    [-36, -76, 6, 130],
    [-49, -58, 6, 130],
    [-58, -38, 6, 120],
  ]) {
    let made = 0;
    for (let i = 0; i < 400000 && made < g[3]; i++) {
      const k = pickV(),
        x = T.wp[k],
        y = T.wp[k + 1],
        z = T.wp[k + 2];
      if (hypot(x - g[0], z - g[1]) > g[2] || y > -14 || T.wn[k + 1] < -0.1 || nearFly(x, y, z, 2.2)) continue;
      made++;
      const coral = T.wn[k + 1] > 0.85 || rnd() < 0.3,
        nx = T.wn[k],
        ny = T.wn[k + 1] + (coral ? 0.9 : 1.1),
        nz = T.wn[k + 2],
        l = hypot(nx, ny, nz);
      const sc = coral ? rr(0.5, 1.4) : rr(0.35, 0.9) * (rnd() < 0.15 ? 1.7 : 1);
      solid(
        coral ? 7 + ((rnd() * 3) | 0) : 4 + ((rnd() * 3) | 0),
        x - (nx / l) * 0.1 * sc,
        y - (ny / l) * 0.1 * sc,
        z - (nz / l) * 0.1 * sc,
        sc,
        quatMul(quatFromY(nx / l, ny / l, nz / l), quatAxis(0, 1, 0, rnd() * TAU)),
        coral ? 5 : 4,
        rnd(),
        1,
        0,
      );
    }
  }

  // ---------------------------------------------------------------- rocks: floating boulder clusters, then rocks on the ground
  // clusters: x, y, z, count, spread
  const BOULDERS = [
    [-11, -11, -105, 14, 5],
    [-56, -19, -18, 18, 6],
    [10, -13, -88, 22, 7],
    [24, -15, -24, 22, 7],
    [-18, -12, 4, 14, 6],
    [30, -14, 30, 16, 6],
    [36, -12, -70, 22, 8],
    [-30, -13, -84, 16, 7],
    [-58, -14, 0, 14, 6],
    [19, -13, 98, 18, 6],
    [62, -9, 34, 14, 6],
  ];
  rseed(8);
  for (let i = 0; i < 9; i++) {
    const a = rnd() * TAU,
      r = rr(60, 150);
    BOULDERS.push([cos(a) * r, rr(-20, -9), sin(a) * r, (10 + rnd() * 12) | 0, rr(5, 9)]);
  }
  for (const b of BOULDERS) {
    for (let i = 0; i < b[3]; i++) {
      const sc = rnd() < 0.12 ? rr(1.8, 3.2) : rr(0.35, 1.5);
      const x = b[0] + rr(-1, 1) * b[4],
        y = b[1] + rr(-1, 1) * b[4] * 0.6,
        z = b[2] + rr(-1, 1) * b[4];
      if (Dw(x, y, z) > -sc) continue; // too close to rock
      const bob = rr(0.12, 0.4),
        sd = rnd();
      solid((rnd() * 4) | 0, x, min(y, -2 - sc), z, sc, quatRandom(random), 1, sd, 1, bob);
      // a large boulder has small ones drifting with it
      if (sc > 1.1)
        for (let j = 0; j < 7; j++)
          solid(
            (rnd() * 4) | 0,
            x + rr(-1.6, 1.6) * sc,
            min(y, -2 - sc) + rr(-1.4, 1) * sc,
            z + rr(-1.6, 1.6) * sc,
            rr(0.1, 0.35),
            quatRandom(random),
            1,
            sd,
            1,
            bob,
          );
    }
  }
  rseed(9);
  for (let i = 0; i < 2600; i++) {
    const k = pickV();
    if (T.wn[k + 1] < 0.7 || hypot(T.wp[k], T.wp[k + 2]) > 170 || nearFly(T.wp[k], T.wp[k + 1], T.wp[k + 2], 6))
      continue;
    const sc = rr(0.25, 1.3) * (rnd() < 0.1 ? 2 : 1);
    solid((rnd() * 4) | 0, T.wp[k], T.wp[k + 1] + sc * 0.2, T.wp[k + 2], sc, quatRandom(random), 1, rnd(), 1, 0);
  }
  // rock chunks half sunk into the surface: three small kinds (vanishing at 96 m) and three large
  rseed(10);
  for (let i = 0; i < 60000; i++) {
    const k = pickV(),
      x = T.wp[k],
      y = T.wp[k + 1],
      z = T.wp[k + 2],
      ny = T.wn[k + 1];
    if (hypot(x, z) > 172 || y > -3 || (ny > 0.8 && rnd() < 0.6) || nearFly(x, y, z, 3.5)) continue;
    const sc = (0.35 + 2.1 * pow(rnd(), 2.6)) * (ny > 0.8 ? 0.5 : 1),
      q = quatRandom(random);
    chunks[(sc > 1.15 ? 3 : 0) + ((rnd() * 3) | 0)][cellOf(x, z)].push(
      x - T.wn[k] * sc * 0.3,
      y - ny * sc * 0.3,
      z - T.wn[k + 2] * sc * 0.3,
      sc,
      q[0],
      q[1],
      q[2],
      q[3],
      1,
      rnd(),
      sc > 1.15 ? 0 : 96,
      0,
    );
  }
  // pebbles and rubble on the sea floor
  rseed(11);
  for (let i = 0; i < 170000; i++) {
    const k = pickV(),
      x = T.wp[k] + rr(-0.4, 0.4),
      z = T.wp[k + 2] + rr(-0.4, 0.4),
      y = T.wp[k + 1];
    if (T.wn[k + 1] < 0.8 || hypot(x, z) > 170 || nearFly(x, y, z, 1.3)) continue;
    const sc = 0.05 + 0.3 * pow(rnd(), 2),
      q = quatRandom(random);
    // (a pebble that is thinned out does not draw its seed)
    if (!(nth++ % THIN)) chunks[6][cellOf(x, z)].push(x, y - sc * 0.25, z, sc, q[0], q[1], q[2], q[3], 1, rnd(), 44, 0);
  }

  // ---------------------------------------------------------------- set pieces
  const gy = (x: number, z: number) => {
    const f = floorsAt(x, z);
    return f.length ? f[f.length - 2] : -45;
  };
  // the whale tail, standing in the seabed in front of viewpoint 1
  solid(
    10,
    -5,
    gy(-5, -4) - 0.6,
    -4,
    1,
    quatMul(quatAxis(0, 1, 0, 1.2), quatMul(quatAxis(0, 0, 1, 0.16), quatAxis(1, 0, 0, -0.3))),
    2,
    0.3,
    1,
    0,
  );
  // the ship, wedged between the rocks
  solid(
    11,
    59.5,
    -23,
    6,
    1,
    quatMul(quatAxis(0, 1, 0, -PI / 2), quatMul(quatAxis(0, 0, 1, -0.1), quatAxis(1, 0, 0, 0.32))),
    3,
    0.5,
    1,
    0,
  );
  // barrel sponges in front of viewpoint 4 (leaning towards it), small sponges around the foot of the tail
  rseed(12);
  for (const b of [
    [7, 3.2, 1.3, 4],
    [8.4, 4.6, 1.0, 6],
    [9.6, 2.6, 1.5, 4],
    [11, 5, 1.1, 5],
    [8, -3.6, 1.2, 4],
    [12.5, 2, 1.2, 6],
    [9, 3.9, 0.8, 4],
  ]) {
    const p = rel(3, b[0], b[1]),
      c = viewpoints[3];
    const ux = (c[0] - p[0]) * 0.07,
      uz = (c[2] - p[1]) * 0.07;
    const l = hypot(ux, 1, uz);
    solid(b[3], p[0], gy(p[0], p[1]) - 0.1, p[1], b[2], quatFromY(ux / l, 1 / l, uz / l), 4, rnd(), 1, 0);
  }
  for (let i = 0; i < 9; i++) {
    const a = rnd() * TAU;
    const x = -5 + cos(a) * rr(1.2, 2.6),
      z = -4 + sin(a) * rr(1.5, 4);
    solid(6, x, gy(x, z) + 0.05, z, rr(0.4, 0.9), quatAxis(0, 1, 0, rnd() * 6), 4, rnd(), 1, 0);
  }

  // ---------------------------------------------------------------- bubbles
  // vents: x, y, z; a y of -44 means "on the seabed here"
  const VENTS = [
    [4, -44, -3],
    [4.5, -44, -3.5],
    [-1, -44, 2],
    [2, -44, -1],
    [5.5, -44, -7],
    [3, -44, -9],
    [6, -44, -90],
    [8, -44, -84],
    [4, -44, -93],
    [-9, -44, 3],
    [5, -35, -86],
    [9, -37, -92],
    [40, -44, 20],
    [-56, -44, 12],
    [10, -44, 80],
    [-2, -44, 30],
    [0, -44, -30],
    [12, -44, 2],
    [6, -44, -2],
    [46, -44, 30],
    [-20, -44, -103],
    [-52, -44, -12],
    [4, -44, 70],
    [9, -44, -74],
    [4, -44, -78],
    [14, -44, 26],
    [26, -44, 40],
    [-45, -44, -64],
    [-55, -44, -40],
    [-58, -44, 22],
    [-40, -44, 40],
    [-14, -44, 45],
    [-1, -44, -9],
    [-7, -44, -6],
  ];
  rseed(13);
  for (const s of spots) if (rnd() < 0.28) VENTS.push(s);
  for (const v of VENTS) {
    const n = (90 + rnd() * 70) | 0,
      y0 = v[1] === -44 ? gy(v[0], v[2]) : v[1];
    for (let i = 0; i < n; i++) {
      const sz = rnd() < 0.24 ? rr(0.1, 0.3) : rr(0.025, 0.08);
      // position and size, then phase, rise speed (larger bubbles are faster), the height to the surface, wobble
      bubbles.push(
        v[0] + rr(-0.3, 0.3),
        y0,
        v[2] + rr(-0.3, 0.3),
        sz,
        rnd(),
        rr(1.1, 2.4) * (0.6 + sz * 3),
        -y0 - 0.2,
        rr(0.05, 0.16),
      );
    }
  }

  // ---------------------------------------------------------------- the skylight volume, at half the grid's resolution
  // r = openness (0.5 at a rock surface), g = skylight: light comes straight down, layer by layer, spreading a
  // little sideways and dimmed by the rock and the kelp it passes through
  const hx = NX / 2,
    hy = NY / 2,
    hz = NZ / 2,
    volume = new Uint8Array(hx * hy * hz * 2);
  let Lp = new Float32Array(hx * hz).fill(1),
    Ln = new Float32Array(hx * hz);
  const tmp = new Float32Array(hx * hz);
  for (let y = hy - 1; y >= 0; y--) {
    for (let z = 0; z < hz; z++) {
      for (let x = 0; x < hx; x++) {
        const i = x + hx * z;
        tmp[i] = (Lp[x > 0 ? i - 1 : i] + 2 * Lp[i] + Lp[x < hx - 1 ? i + 1 : i]) * 0.25;
      }
    }
    for (let z = 0; z < hz; z++) {
      for (let x = 0; x < hx; x++) {
        const i = x + hx * z,
          b = (tmp[z > 0 ? i - hx : i] + 2 * tmp[i] + tmp[z < hz - 1 ? i + hx : i]) * 0.25;
        const g0 = gi(x * 2, y * 2, z * 2);
        const d =
          (density[g0] +
            density[g0 + 1] +
            density[g0 + NX] +
            density[g0 + NX + 1] +
            density[g0 + NX * NY] +
            density[g0 + NX * NY + 1] +
            density[g0 + NX * NY + NX] +
            density[g0 + NX * NY + NX + 1]) *
          0.125;
        const o = x + hx * (y + hy * z);
        const l = b * clamp(0.5 - d / 1.5, 0, 1) * (1 - min(kelpAbs[o], 0.5));
        Ln[i] = l;
        volume[o * 2] = clamp(0.5 - d / 12, 0, 1) * 255;
        volume[o * 2 + 1] = min(1, b) * 255;
      }
    }
    const t = Lp;
    Lp = Ln;
    Ln = t;
  }

  // ---------------------------------------------------------------- fish schools, mantas, drifting particles
  const fish: number[] = [];
  rseed(14);
  // schools: centre x, y, z, radius, count, size, direction, and for some a fixed phase
  const SCHOOLS = [
    [-2, -36, -10, 15, 520, 0.3, 1, 0.945],
    [8, -30, -70, 22, 420, 0.32, -1],
    [48, -30, 14, 18, 360, 0.3, 1],
    [-58, -30, -8, 11, 420, 0.28, -1, 0.3],
    [8, -36, 84, 16, 320, 0.28, 1],
    [-90, -28, -70, 25, 300, 0.3, 1],
    [95, -30, 70, 25, 300, 0.3, -1],
    [0, -22, 20, 30, 380, 0.34, -1],
    [-30, -30, -100, 18, 300, 0.3, 1],
    [16, -36, 30, 12, 300, 0.3, 1],
    [-48, -34, -58, 12, 300, 0.3, -1],
    [-45, -35, 38, 14, 320, 0.3, 1],
  ];
  for (const s of SCHOOLS) {
    const phase = s[7] === undefined ? rnd() : s[7];
    for (let i = 0; i < s[4]; i++) fish.push(s[0], s[1], s[2], s[3], rnd(), (s[6] * 1.9) / s[3], s[5], phase);
  }
  // mantas: centre x, y, z, radius, phase, angular speed, size, second phase
  const mantas: number[] = [];
  for (const m of [
    [1, -28, 3.5, 14, 3.012, 0.085, 3.6, 0.1],
    [49, -31, 24.5, 5, 0.029, -0.08, 3.7, 0.4],
    [0, -14, -80, 34, 0.3, 0.06, 5.2, 0.7],
    [-50, -18, 20, 26, 5, -0.075, 3.8, 0.55],
    [10, -16, 86, 26, 2.2, 0.07, 4.4, 0.85],
    [20, -11, -20, 46, 4.2, -0.045, 5.6, 0.25],
  ])
    mantas.push(...m);
  const snow = new Float32Array(9000 * 4);
  for (let i = 0; i < snow.length; i++) snow[i] = rnd();

  // ---------------------------------------------------------------- packing
  const sol = { data: [] as number[], ranges: [] as [number, number][] };
  let si = 0;
  for (let m = 0; m < 12; m++) {
    const a = solids[m] || [];
    sol.ranges.push([si, a.length / 12]);
    si += a.length / 12;
    for (let i = 0; i < a.length; i++) sol.data.push(a[i]);
  }
  const bigPacked = big.pack();
  return {
    leaves: { big: bigPacked, bigFar: big.packFar(bigPacked), small: small.pack() },
    solids: { instances: new Float32Array(sol.data), ranges: sol.ranges },
    chunks: chunks.map(packCells),
    props: props.map(packCells),
    glints: new Float32Array(glints),
    bubbles: new Float32Array(bubbles),
    fish: new Float32Array(fish),
    mantas: new Float32Array(mantas),
    snow,
    volume,
    floorAt: gy,
  };
}
