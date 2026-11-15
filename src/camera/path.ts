// The scripted fly-through: a camera position and look-at point for every moment of a 60-second flight along
// the authored path, at a steady speed.
import { FLY_PATH } from '../world/layout';

/** Length of the flight in seconds. */
export const FLY_SECONDS = 60;

const POINTS = FLY_PATH.length / 6;
const LUT_SIZE = 1024;
/** lut[k] = spline parameter at fraction k / LUT_SIZE of the path's length; built on first use. */
let lut: Float32Array | null = null;

/** Eye xyz and look-at xyz at spline parameter s (0 .. POINTS - 1): Catmull-Rom through the authored points. */
function spline(s: number, out: Float64Array): void {
  let i = Math.floor(s) | 0;
  if (i > POINTS - 2) i = POINTS - 2;
  const u = s - i;
  const i0 = (i > 0 ? i - 1 : 0) * 6;
  const i1 = i * 6;
  const i2 = (i + 1) * 6;
  const i3 = (i + 2 < POINTS ? i + 2 : POINTS - 1) * 6;
  for (let o = 0; o < 6; o++) {
    const a = FLY_PATH[i0 + o]!;
    const b = FLY_PATH[i1 + o]!;
    const c = FLY_PATH[i2 + o]!;
    const d = FLY_PATH[i3 + o]!;
    out[o] = 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u * u * u);
  }
}

/** The spline's parameter does not advance evenly along the path, so it is re-timed by arc length. */
function buildLut(): Float32Array {
  const STEPS = 4096;
  const length = new Float32Array(STEPS + 1);
  const p = new Float64Array(6);
  let px = 0;
  let py = 0;
  let pz = 0;
  for (let k = 0; k <= STEPS; k++) {
    spline((k / STEPS) * (POINTS - 1), p);
    if (k) length[k] = length[k - 1]! + Math.hypot(p[0]! - px, p[1]! - py, p[2]! - pz);
    px = p[0]!;
    py = p[1]!;
    pz = p[2]!;
  }
  const table = new Float32Array(LUT_SIZE + 1);
  for (let k = 0, j = 0; k <= LUT_SIZE; k++) {
    const d = (k / LUT_SIZE) * length[STEPS]!;
    while (j < STEPS - 1 && length[j + 1]! < d) j++;
    table[k] = ((j + (d - length[j]!) / Math.max(length[j + 1]! - length[j]!, 1e-6)) / STEPS) * (POINTS - 1);
  }
  return table;
}

/**
 * Writes the camera of the fly-through at `seconds` into `out`: eye xyz, look-at xyz. The flight eases in and
 * out a little at its ends; times outside 0 .. FLY_SECONDS give the first or last point.
 */
export function flyPoint(seconds: number, out: Float64Array): void {
  lut ??= buildLut();
  let s = seconds / FLY_SECONDS;
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  s = s * s * (3 - 2 * s) * 0.25 + s * 0.75;
  s *= LUT_SIZE;
  let k = Math.floor(s) | 0;
  if (k > LUT_SIZE - 1) k = LUT_SIZE - 1;
  spline(lut[k]! + (lut[k + 1]! - lut[k]!) * (s - k), out);
}

/**
 * Points the generator keeps clear of kelp and rocks: the flight sampled every tenth of a second, and a point
 * 40 m down under each viewpoint. Three numbers per point.
 */
export function clearancePoints(viewpoints: readonly (readonly number[])[]): Float64Array {
  const points: number[] = [];
  const p = new Float64Array(6);
  // (the sum of tenths falls just short of 60, so this is 600 points and the last is at 59.9 s)
  for (let t = 0; t <= FLY_SECONDS; t += 0.1) {
    flyPoint(t, p);
    points.push(p[0], p[1], p[2]);
  }
  for (const view of viewpoints) points.push(view[0], -40, view[2]);
  return new Float64Array(points);
}
