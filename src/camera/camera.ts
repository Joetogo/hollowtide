// The camera: a position, a yaw and a pitch, plus the basis vectors derived from them.
// Yaw 0 looks along -z and grows clockwise seen from above; the right vector is always horizontal.

export interface Camera {
  x: number;
  y: number;
  z: number;
  /** radians */
  yaw: number;
  /** radians, positive looks up */
  pitch: number;
  /** how wide the view is, as a multiple of the usual field of view's tangent: 1, but for a moment at speed */
  wide: number;
  // unit basis, filled by updateBasis(): forward, right (y is always 0) and up
  fx: number;
  fy: number;
  fz: number;
  rx: number;
  rz: number;
  ux: number;
  uy: number;
  uz: number;
}

export function createCamera(): Camera {
  const camera = {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    wide: 1,
    fx: 0,
    fy: 0,
    fz: -1,
    rx: 1,
    rz: 0,
    ux: 0,
    uy: 1,
    uz: 0,
  };
  updateBasis(camera);
  return camera;
}

/** Puts the camera at a point and turns it towards another. */
export function lookAt(camera: Camera, x: number, y: number, z: number, tx: number, ty: number, tz: number): void {
  const dx = tx - x;
  const dy = ty - y;
  const dz = tz - z;
  camera.x = x;
  camera.y = y;
  camera.z = z;
  camera.yaw = Math.atan2(dx, -dz);
  camera.pitch = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));
  updateBasis(camera);
}

/** Recomputes forward, right and up after yaw or pitch changed. */
export function updateBasis(camera: Camera): void {
  const cp = Math.cos(camera.pitch);
  const fy = Math.sin(camera.pitch);
  const rx = Math.cos(camera.yaw);
  const rz = Math.sin(camera.yaw);
  const fx = cp * rz;
  const fz = -cp * rx;
  camera.fx = fx;
  camera.fy = fy;
  camera.fz = fz;
  camera.rx = rx;
  camera.rz = rz;
  camera.ux = -rz * fy;
  camera.uy = rz * fx - rx * fz;
  camera.uz = rx * fy;
}
