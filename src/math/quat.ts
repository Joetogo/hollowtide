// Quaternions as [x, y, z, w] arrays. Generation-time only: these allocate.
import type { Random } from './random';
import { hypot3 } from './hypot';

export type Quat = [number, number, number, number];

/** Rotation by `angle` radians about an axis (which need not be normalised). */
export function quatAxis(x: number, y: number, z: number, angle: number): Quat {
  const length = hypot3(x, y, z) || 1;
  const s = Math.sin(angle / 2) / length;
  return [x * s, y * s, z * s, Math.cos(angle / 2)];
}

/** The rotation b followed by the rotation a. */
export function quatMul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/** A random rotation: four draws. (A normalised point of a 4D cube, so not quite uniform.) */
export function quatRandom(random: Random): Quat {
  const q: Quat = [random.range(-1, 1), random.range(-1, 1), random.range(-1, 1), random.range(-1, 1)];
  const length = Math.hypot(...q) || 1; // four numbers: the built-in
  return q.map((v) => v / length) as Quat;
}

/** The shortest rotation that takes +y to the unit vector n. */
export function quatFromY(nx: number, ny: number, nz: number): Quat {
  if (ny < -0.9999) return [1, 0, 0, 0];
  const q: Quat = [nz, 0, -nx, 1 + ny];
  const length = Math.hypot(...q);
  return q.map((v) => v / length) as Quat;
}
