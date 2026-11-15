// The per-frame uniform block every pass reads: camera, sun, resolution and a few global dials.
// Byte for byte the layout of the original's `G` struct, with each packed scalar given a name.
import type { Camera } from '../camera/camera';
import { struct } from '../gpu/struct';
import { GROTTO_CENTER } from '../world/layout';
import { SUN_DIRECTION, writeShadowMatrix } from './lighting';

/** Tangent of half the vertical field of view (about 62 degrees top to bottom). */
export const TAN_HALF_FOV = 0.6;
/** Near plane in metres. The projection is reversed-Z with an infinite far plane: depth = NEAR / distance. */
export const NEAR = 0.1;
export const EXPOSURE = 0.62;
export const SHAFT_GAIN = 0.54;

export const Frame = struct('Frame', {
  viewProj: 'mat4x4f',
  shadowMat: 'mat4x4f',
  camPos: 'vec3f',
  time: 'f32', // seconds
  right: 'vec3f',
  tanHalfX: 'f32',
  up: 'vec3f',
  tanHalfY: 'f32',
  fwd: 'vec3f',
  near: 'f32',
  sunDir: 'vec3f',
  zoneBlend: 'f32', // 0 in open water, 1 inside the purple grotto
  res: 'vec2f', // render size in pixels; x is 0 in the shadow pass
  invRes: 'vec2f',
  exposure: 'f32',
  shaftGain: 'f32',
  detail: 'f32', // draw-distance scale, 1 = full
});

const at = Frame.at;

/** A new frame block with the parts that never change (shadow matrix, sun direction) filled in. */
export function createFrameData(): Float32Array {
  const data = new Float32Array(Frame.size / 4);
  writeShadowMatrix(data, at.shadowMat);
  data.set(SUN_DIRECTION, at.sunDir);
  data[at.shaftGain] = SHAFT_GAIN;
  return data;
}

/**
 * Fills in everything that follows the camera. `camera` must have an up-to-date basis.
 * The arithmetic and its order mirror the original exactly: tests compare the result bit for bit.
 */
export function writeFrame(
  data: Float32Array,
  camera: Camera,
  width: number,
  height: number,
  time: number,
  detail: number,
): void {
  const { x: cx, y: cy, z: cz, fx, fy, fz, rx, rz, ux, uy, uz } = camera;
  const aspect = width / height;
  const sx = 1 / (TAN_HALF_FOV * aspect);
  const sy = 1 / TAN_HALF_FOV;
  // view-projection, column-major: clip.xy = scaled right/up, clip.z = NEAR, clip.w = distance along forward
  const m = at.viewProj;
  data[m + 0] = rx * sx;
  data[m + 4] = 0;
  data[m + 8] = rz * sx;
  data[m + 12] = -(rx * cx + rz * cz) * sx;
  data[m + 1] = ux * sy;
  data[m + 5] = uy * sy;
  data[m + 9] = uz * sy;
  data[m + 13] = -(ux * cx + uy * cy + uz * cz) * sy;
  data[m + 2] = 0;
  data[m + 6] = 0;
  data[m + 10] = 0;
  data[m + 14] = NEAR;
  data[m + 3] = fx;
  data[m + 7] = fy;
  data[m + 11] = fz;
  data[m + 15] = -(fx * cx + fy * cy + fz * cz);

  data[at.camPos] = cx;
  data[at.camPos + 1] = cy;
  data[at.camPos + 2] = cz;
  data[at.time] = time;
  data[at.right] = rx;
  data[at.right + 1] = 0;
  data[at.right + 2] = rz;
  data[at.tanHalfX] = TAN_HALF_FOV * aspect;
  data[at.up] = ux;
  data[at.up + 1] = uy;
  data[at.up + 2] = uz;
  data[at.tanHalfY] = TAN_HALF_FOV;
  data[at.fwd] = fx;
  data[at.fwd + 1] = fy;
  data[at.fwd + 2] = fz;
  data[at.near] = NEAR;

  // how far into the purple grotto the camera is: fully in within 26 m of its centre, out beyond 44 m
  const zx = cx - GROTTO_CENTER[0];
  const zz = cz - GROTTO_CENTER[1];
  let zone = (44 - Math.sqrt(zx * zx + zz * zz)) / 18;
  zone = zone < 0 ? 0 : zone > 1 ? 1 : zone;
  data[at.zoneBlend] = zone * zone * (3 - 2 * zone);

  data[at.res] = width;
  data[at.res + 1] = height;
  data[at.invRes] = 1 / width;
  data[at.invRes + 1] = 1 / height;

  // the eye adapts: exposure rises from 60 % near the surface to full at 34 m depth and below
  let deep = (-cy - 8) / 26;
  deep = deep < 0 ? 0 : deep > 1 ? 1 : deep;
  data[at.exposure] = EXPOSURE * (0.6 + 0.4 * deep);
  data[at.detail] = detail;
}
