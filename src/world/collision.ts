// What the camera collides with: the distance to the rock, kept only where the camera can go and only near the
// surface.
//
// The grid is cut into bricks of 4 x 4 x 4 voxels. A brick that is all water or all rock is one number in the
// index; only bricks the surface passes through keep their 64 distances (about 2 MB in all, as signed bytes in
// 1/127 m, positive in rock, clamped to one metre either way).
import { clamp } from '../math/scalar';
import { NX, NY, ORIGIN_X, ORIGIN_Y, ORIGIN_Z, VOXEL } from './grid';
import { hypot2 } from '../math/hypot';

/** The bricks start this many voxels in from the grid's x and z edges... */
export const COLLISION_OFFSET = 52;
/** ...and there are this many of them along x and along z. */
export const COLLISION_BRICKS = 102;
/** index value of a brick that is all water / all rock; any other value n is brick n - 2 of `bricks` */
export const ALL_WATER = 0;
export const ALL_ROCK = 1;

export interface CollisionField {
  /** one entry per brick: x + COLLISION_BRICKS * (y + NY / 4 * z) */
  index: Uint16Array;
  /** 64 distances per stored brick: x + 4 * y + 16 * z within the brick */
  bricks: Int8Array;
}

export function buildCollisionField(density: Float32Array): CollisionField {
  const N = COLLISION_BRICKS;
  const O = COLLISION_OFFSET;
  const slab = NX * NY;
  const index = new Uint16Array(N * N * (NY / 4));
  let bricks = new Int8Array(64 * 65534);
  let stored = 0;
  for (let bz = 0; bz < N; bz++) {
    for (let by = 1; by < NY / 4 - 1; by++) {
      for (let bx = 0; bx < N; bx++) {
        if (hypot2(bx - N / 2 + 0.5, bz - N / 2 + 0.5) > 52) continue; // more than 156 m out: never reached
        let lo = 127;
        let hi = -127;
        for (let z = 0; z < 4; z++) {
          for (let y = 0; y < 4; y++) {
            for (let x = 0; x < 4; x++) {
              const i = O + bx * 4 + x + NX * (by * 4 + y + NY * (O + bz * 4 + z));
              // the density is not a true distance: dividing by its gradient's length makes it close to one
              const gz = density[i + slab] - density[i - slab];
              const gx = density[i + 1] - density[i - 1];
              const gy = density[i + NX] - density[i - NX];
              const slope = Math.sqrt(gx * gx + gy * gy + gz * gz) / 1.5;
              const q = Math.round(clamp(density[i] / Math.max(slope, 0.05), -1, 1) * 127);
              bricks[stored * 64 + x + 4 * y + 16 * z] = q;
              if (q < lo) lo = q;
              if (q > hi) hi = q;
            }
          }
        }
        // all 64 at the same extreme: nothing to store
        index[bx + N * (by + (NY / 4) * bz)] = lo === hi && lo * lo === 16129 ? +(lo > 0) : (stored++, stored + 1);
      }
    }
  }
  bricks = bricks.slice(0, stored * 64);
  return { index, bricks };
}

// ---------------------------------------------------------------- queries

/** The stored distance at whole voxel coordinates (x and z counted from the bricks' corner), in 1/127 m. */
function voxelDistance(field: CollisionField, x: number, y: number, z: number): number {
  const b = field.index[(x >> 2) + COLLISION_BRICKS * ((y >> 2) + (NY / 4) * (z >> 2))];
  return b > 1 ? field.bricks[b * 64 - 128 + (x & 3) + 4 * (y & 3) + 16 * (z & 3)] : b * 254 - 127;
}

/** Distance to the rock at a world position, in metres: positive inside rock, clamped to one metre either way. */
export function rockDistance(field: CollisionField, wx: number, wy: number, wz: number): number {
  const x = (wx - ORIGIN_X) / VOXEL - COLLISION_OFFSET;
  const y = (wy - ORIGIN_Y) / VOXEL;
  const z = (wz - ORIGIN_Z) / VOXEL - COLLISION_OFFSET;
  const ix = x | 0,
    iy = y | 0,
    iz = z | 0;
  const u = x - ix,
    v = y - iy;
  const a = voxelDistance(field, ix, iy, iz),
    b = voxelDistance(field, ix, iy + 1, iz);
  const c = voxelDistance(field, ix, iy, iz + 1),
    d = voxelDistance(field, ix, iy + 1, iz + 1);
  const p = a + (voxelDistance(field, ix + 1, iy, iz) - a) * u,
    q = b + (voxelDistance(field, ix + 1, iy + 1, iz) - b) * u;
  const r = c + (voxelDistance(field, ix + 1, iy, iz + 1) - c) * u,
    s = d + (voxelDistance(field, ix + 1, iy + 1, iz + 1) - d) * u;
  const e = p + (q - p) * v;
  return (e + (r + (s - r) * v - e) * (z - iz)) / 127;
}

/** The camera is a ball of this radius, in metres. */
export const CAMERA_RADIUS = 0.5;
const PROBE = 0.375; // the distance is sampled this far either side of the camera to find which way is out

/** A thing that moves and can be stopped by rock: position and velocity. */
export interface Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/**
 * Moves a body by (mx, my, mz) without letting it into the rock. The move is taken in steps shorter than the
 * body's radius, so it cannot pass through a thin wall; after each step the body is pushed back out along the
 * distance field's gradient, and the part of its velocity that points into the rock is dropped, so it slides
 * along the surface instead of stopping.
 */
export function moveWithCollision(field: CollisionField, body: Body, mx: number, my: number, mz: number): void {
  const steps = Math.floor(Math.sqrt(mx * mx + my * my + mz * mz) / 0.4) + 1;
  for (let i = 0; i < steps; i++) {
    body.x += mx / steps;
    body.y += my / steps;
    body.z += mz / steps;
    for (let k = 0; k < 2; k++) {
      const inside = rockDistance(field, body.x, body.y, body.z) + CAMERA_RADIUS;
      if (inside <= 0) break;
      let gx =
        rockDistance(field, body.x + PROBE, body.y, body.z) - rockDistance(field, body.x - PROBE, body.y, body.z);
      let gy =
        rockDistance(field, body.x, body.y + PROBE, body.z) - rockDistance(field, body.x, body.y - PROBE, body.z);
      let gz =
        rockDistance(field, body.x, body.y, body.z + PROBE) - rockDistance(field, body.x, body.y, body.z - PROBE);
      const length = Math.sqrt(gx * gx + gy * gy + gz * gz);
      if (length < 0.075) break; // no slope: deep inside rock, nothing to slide along
      gx /= length;
      gy /= length;
      gz /= length;
      const into = body.vx * gx + body.vy * gy + body.vz * gz;
      body.x -= gx * inside;
      body.y -= gy * inside;
      body.z -= gz * inside;
      if (into > 0) {
        body.vx -= gx * into;
        body.vy -= gy * into;
        body.vz -= gz * into;
      }
    }
  }
}
