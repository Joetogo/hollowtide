// Value noise for the generator's placement rules and mesh shapes. (The terrain itself uses the GPU noise in
// shaders/common/noise.wgsl; the two are built alike but hash differently, so they are not interchangeable.)
import { mix } from './scalar';

/** A hash of three integers, in [0, 1). */
export function hash3(x: number, y: number, z: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise on the integer lattice, smoothly interpolated, in [0, 1). */
export function valueNoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  let fx = x - ix;
  let fy = y - iy;
  let fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const a = mix(
    mix(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), fx),
    mix(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), fx),
    fy,
  );
  const b = mix(
    mix(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), fx),
    mix(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), fx),
    fy,
  );
  return mix(a, b, fz);
}

/** Fractal sum of `octaves` layers of value noise, normalised to [0, 1). */
export function fbm(x: number, y: number, z: number, octaves = 4): number {
  let amplitude = 0.5;
  let sum = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * valueNoise(x, y, z);
    x = x * 2.03 + 17.1;
    y = y * 2.03 + 31.7;
    z = z * 2.03 + 5.3;
    amplitude *= 0.5;
  }
  return sum / (1 - 2 * amplitude);
}
