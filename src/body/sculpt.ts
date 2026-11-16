// Shapes for the swimmer's body and gear, sculpted the way the whale tail is: a distance function (negative
// inside) built from a few rounded primitives that melt into each other, sampled on a grid and meshed with
// surface nets. Each vertex also learns which bones move it, what it is made of, and how much of the light
// around it the shape itself blocks (so that the gaps between fingers and the folds of a glove are dark
// without any light being traced at run time).
import { sampler, surfaceNets } from '../math/field';
import type { BuiltMesh } from '../math/mesh';

/** Bytes per vertex: position (3 floats), normal and occlusion (4 signed bytes), two bones, a weight, a material. */
export const BODY_VERTEX_BYTES = 20;

export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** A capsule from a to b whose radius goes from ra to rb. */
export function capsule(
  x: number,
  y: number,
  z: number,
  a: readonly number[],
  b: readonly number[],
  ra: number,
  rb = ra,
): number {
  const bax = b[0]! - a[0]!;
  const bay = b[1]! - a[1]!;
  const baz = b[2]! - a[2]!;
  const pax = x - a[0]!;
  const pay = y - a[1]!;
  const paz = z - a[2]!;
  const h = clamp01((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz));
  return Math.sqrt((pax - bax * h) ** 2 + (pay - bay * h) ** 2 + (paz - baz * h) ** 2) - mix(ra, rb, h);
}

/** A box with half-size h around c, its edges rounded by r. */
export function roundBox(
  x: number,
  y: number,
  z: number,
  c: readonly number[],
  h: readonly number[],
  r: number,
): number {
  const qx = Math.abs(x - c[0]!) - h[0]!;
  const qy = Math.abs(y - c[1]!) - h[1]!;
  const qz = Math.abs(z - c[2]!) - h[2]!;
  const outside = Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2 + Math.max(qz, 0) ** 2);
  return outside + Math.min(Math.max(qx, qy, qz), 0) - r;
}

/** A band round the y axis at height cy: a ring of radius R, `half` wide along y, `thick` thick. */
export function band(x: number, y: number, z: number, cy: number, R: number, half: number, thick: number): number {
  return Math.hypot(Math.hypot(x, z) - R, Math.max(Math.abs(y - cy) - half, 0)) - thick;
}

/** The union of two shapes, melted together over a distance k. */
export function melt(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export interface Sculpture {
  /** distance to the surface in metres, negative inside */
  distance(x: number, y: number, z: number): number;
  /**
   * What a point of the surface is: writes the two bones that move it, the first one's share (0..1) and the
   * material into `out`.
   */
  describe(x: number, y: number, z: number, out: number[]): void;
  /** the box that is sampled; the shape must lie inside it with a voxel or two to spare */
  min: readonly [number, number, number];
  max: readonly [number, number, number];
  /** grid spacing in metres */
  voxel: number;
}

/** How far out from the surface the occlusion is probed, metres, and what each probe counts for. */
const PROBES = [
  [0.0035, 0.3],
  [0.008, 0.3],
  [0.015, 0.22],
  [0.026, 0.18],
] as const;

export function sculpt({ distance, describe, min, max, voxel }: Sculpture): BuiltMesh {
  const nx = Math.ceil((max[0] - min[0]) / voxel) + 1;
  const ny = Math.ceil((max[1] - min[1]) / voxel) + 1;
  const nz = Math.ceil((max[2] - min[2]) / voxel) + 1;
  const field = new Float32Array(nx * ny * nz);
  // Most of the box is nowhere near the surface, and there the exact distance does not matter, only its sign.
  // So the box is taken in blocks: one sample in the middle of a block tells whether the surface can come
  // within reach of any of its voxels. (A distance function changes by at most the distance moved; these are
  // not quite that, as some squash a shape along one axis, hence the factor.) Only the blocks near the surface
  // are sampled voxel by voxel: about a fifth of them.
  const BLOCK = 4;
  const far = (Math.sqrt(3) * (BLOCK / 2) * 1.3 + 2) * voxel;
  for (let bz = 0; bz < nz; bz += BLOCK) {
    for (let by = 0; by < ny; by += BLOCK) {
      for (let bx = 0; bx < nx; bx += BLOCK) {
        const half = (BLOCK - 1) / 2;
        const middle = distance(
          min[0] + (bx + half) * voxel,
          min[1] + (by + half) * voxel,
          min[2] + (bz + half) * voxel,
        );
        const whole = Math.abs(middle) > far;
        for (let z = bz; z < Math.min(bz + BLOCK, nz); z++) {
          for (let y = by; y < Math.min(by + BLOCK, ny); y++) {
            for (let x = bx; x < Math.min(bx + BLOCK, nx); x++) {
              field[x + nx * (y + ny * z)] = whole
                ? -middle
                : -distance(min[0] + x * voxel, min[1] + y * voxel, min[2] + z * voxel);
            }
          }
        }
      }
    }
  }
  const net = surfaceNets(field, nx, ny, nz);
  const sample = sampler(field, nx, ny, nz);
  const vertices = new ArrayBuffer(net.vertexCount * BODY_VERTEX_BYTES);
  const view = new DataView(vertices);
  const what = [0, 0, 1, 0];
  for (let k = 0; k < net.vertexCount; k++) {
    const gx = net.positions[k * 3]!;
    const gy = net.positions[k * 3 + 1]!;
    const gz = net.positions[k * 3 + 2]!;
    // the normal is the field's slope, taken a little wider than a voxel so that it is smooth
    const e = 0.8;
    let ax = sample(gx - e, gy, gz) - sample(gx + e, gy, gz);
    let ay = sample(gx, gy - e, gz) - sample(gx, gy + e, gz);
    let az = sample(gx, gy, gz - e) - sample(gx, gy, gz + e);
    const length = Math.hypot(ax, ay, az) || 1;
    ax /= length;
    ay /= length;
    az /= length;
    const x = min[0] + gx * voxel;
    const y = min[1] + gy * voxel;
    const z = min[2] + gz * voxel;
    // occlusion: out along the normal there should be as much room as the distance gone; where the shape
    // itself is in the way (between fingers, in a fold) there is less
    let blocked = 0;
    for (const [reach, share] of PROBES)
      blocked += clamp01(1 - distance(x + ax * reach, y + ay * reach, z + az * reach) / reach) * share;
    describe(x, y, z, what);
    const o = k * BODY_VERTEX_BYTES;
    view.setFloat32(o, x, true);
    view.setFloat32(o + 4, y, true);
    view.setFloat32(o + 8, z, true);
    view.setInt8(o + 12, Math.round(ax * 127));
    view.setInt8(o + 13, Math.round(ay * 127));
    view.setInt8(o + 14, Math.round(az * 127));
    view.setInt8(o + 15, Math.round(clamp01(1 - blocked * 1.15) * 127));
    view.setUint8(o + 16, what[0]!);
    view.setUint8(o + 17, what[1]!);
    view.setUint8(o + 18, Math.round(clamp01(what[2]!) * 255));
    view.setUint8(o + 19, what[3]!);
  }
  return { vertices, indices: new Uint32Array(net.indices), vertexCount: net.vertexCount };
}
