// The ground map: a 512 x 512 picture of the whole ground plane that the shaders and the generator both read.
//   r = magenta ground cover, b = how far into the purple grotto, a = sand
import { fbm } from '../math/noise';
import { smoothRamp } from '../math/scalar';
import { GROTTO_CENTER, MAGENTA_PATCHES } from './layout';

export const GROUND_MAP_SIZE = 512;
const WORLD_SIZE = 384; // metres covered, centred on the origin

/** How far into the purple grotto a point is: 1 within 26 m of its centre, 0 beyond 44 m. */
export const grottoAt = (x: number, z: number): number =>
  smoothRamp(44, 26, Math.hypot(x - GROTTO_CENTER[0], z - GROTTO_CENTER[1]));

/** Magenta ground cover at a point, 0..1: noise patches and the authored discs, broken up by finer noise. */
export function magentaAt(x: number, z: number): number {
  let m = smoothRamp(0.54, 0.66, fbm(x * 0.03, 7, z * 0.03, 3)) * 0.9;
  for (const p of MAGENTA_PATCHES) m = Math.max(m, smoothRamp(p[2], p[2] * 0.45, Math.hypot(x - p[0], z - p[1])));
  return m * smoothRamp(0.3, 0.55, fbm(x * 0.17, 1, z * 0.17, 2) + m * 0.25);
}

export function buildGroundMap(): Uint8Array {
  const N = GROUND_MAP_SIZE;
  const map = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = ((i + 0.5) / N) * WORLD_SIZE - WORLD_SIZE / 2;
      const z = ((j + 0.5) / N) * WORLD_SIZE - WORLD_SIZE / 2;
      const o = (i + N * j) * 4;
      map[o] = magentaAt(x, z) * 255;
      map[o + 2] = grottoAt(x, z) * 255;
      map[o + 3] = smoothRamp(0.42, 0.6, fbm(x * 0.04, 3, z * 0.04, 3)) * 255;
    }
  }
  return map;
}
