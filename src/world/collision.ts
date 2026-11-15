// What the camera collides with: the distance to the rock, kept only where the camera can go and only near the
// surface.
//
// The grid is cut into bricks of 4 x 4 x 4 voxels. A brick that is all water or all rock is one number in the
// index; only bricks the surface passes through keep their 64 distances (about 2 MB in all, as signed bytes in
// 1/127 m, positive in rock, clamped to one metre either way).
import { clamp } from '../math/scalar';
import { NX, NY } from './grid';

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
        if (Math.hypot(bx - N / 2 + 0.5, bz - N / 2 + 0.5) > 52) continue; // more than 156 m out: never reached
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
