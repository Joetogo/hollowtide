// The sun. The scene is lit from one fixed direction: the shadow map is baked once for it and the caustics are
// projected along it.

/** Unit vector pointing towards the sun. */
export const SUN_DIRECTION: readonly number[] = (() => {
  const v = [0.27, 1, -0.24];
  const length = Math.hypot(...v);
  return v.map((c) => c / length);
})();

const SHADOW_HALF_WIDTH = 225; // metres: the shadow map covers a 450 m square centred on the world origin
const SHADOW_NEAR = -175; // metres along the sun direction
const SHADOW_FAR = 125;

/**
 * Writes the world-to-shadow-map matrix (orthographic, column-major, 16 floats) into `out` at `at`.
 * x and y land in [-1, 1] across the map, z in [0, 1] with 0 nearest the sun.
 */
export function writeShadowMatrix(out: Float32Array, at: number): void {
  const L = SUN_DIRECTION as [number, number, number];
  // right: horizontal and perpendicular to the sun; up: perpendicular to both
  const right = [L[1], -L[0], 0] as [number, number, number];
  const length = Math.hypot(...right);
  right[0] /= length;
  right[1] /= length;
  const up = [L[1] * right[2] - L[2] * right[1], L[2] * right[0] - L[0] * right[2], L[0] * right[1] - L[1] * right[0]];
  const R = SHADOW_HALF_WIDTH;
  const depth = SHADOW_FAR - SHADOW_NEAR;
  out[at + 0] = right[0] / R;
  out[at + 4] = right[1] / R;
  out[at + 8] = right[2] / R;
  out[at + 12] = 0;
  out[at + 1] = up[0]! / R;
  out[at + 5] = up[1]! / R;
  out[at + 9] = up[2]! / R;
  out[at + 13] = 0;
  out[at + 2] = -L[0] / depth;
  out[at + 6] = -L[1] / depth;
  out[at + 10] = -L[2] / depth;
  out[at + 14] = SHADOW_FAR / depth;
  out[at + 3] = 0;
  out[at + 7] = 0;
  out[at + 11] = 0;
  out[at + 15] = 1;
}
