// A view as a link: where the eye is and which way it looks, written after the # of the page's address as
// `at=x,y,z,yaw,pitch` (metres and whole degrees), so that a place can be sent to someone.
import type { Camera } from './camera';

/** As far from the middle of the world as the swimmer can get, and the depths they can be at (camera/controls.ts). */
const WORLD_RADIUS = 150;
const DEEPEST = -52;
const SHALLOWEST = -1.2;
const DEGREE = Math.PI / 180;

export function viewToHash(camera: Camera): string {
  const turn = ((camera.yaw / DEGREE) % 360) + (camera.yaw < 0 ? 360 : 0);
  const numbers = [
    camera.x.toFixed(1),
    camera.y.toFixed(1),
    camera.z.toFixed(1),
    (Math.round(turn) % 360).toFixed(0),
    Math.round(camera.pitch / DEGREE).toFixed(0),
  ];
  return '#at=' + numbers.join(',');
}

/**
 * The view a link asks for: x, y, z, yaw and pitch in radians. Null if the address has none, or one that is
 * not five numbers, or a place outside the water the swimmer can reach (whether it is inside rock is for
 * whoever has the collision field to say).
 */
export function viewFromHash(hash: string): [x: number, y: number, z: number, yaw: number, pitch: number] | null {
  const match = /^#at=([-\d.,]+)$/.exec(hash);
  if (!match) return null;
  const parts = match[1]!.split(',');
  if (parts.length !== 5 || parts.some((part) => !/^-?\d+(\.\d+)?$/.test(part))) return null;
  const [x, y, z, yaw, pitch] = parts.map(Number) as [number, number, number, number, number];
  if (Math.hypot(x, z) > WORLD_RADIUS || y < DEEPEST || y > SHALLOWEST || Math.abs(pitch) > 89) return null;
  return [x, y, z, yaw * DEGREE, pitch * DEGREE];
}
