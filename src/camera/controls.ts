// Swimming: how the camera answers to the keys, the mouse and a finger. The step itself is plain arithmetic on
// plain state, with no DOM in it, so it can be tested and replayed; src/ui/input.ts feeds it.
import { moveWithCollision, type Body, type CollisionField } from '../world/collision';
import { updateBasis, type Camera } from './camera';

/** What the swimmer is asking for this frame. */
export interface Intent {
  /** -1..1: backwards / forwards along the view direction */
  forward: number;
  /** -1..1: left / right */
  right: number;
  /** -1..1: down / up */
  up: number;
  fast: boolean;
  /** how far the view should turn, in mouse pixels, since the last frame; consumed by the step */
  lookX: number;
  lookY: number;
  /** -1..1: a held touch away from where it went down keeps turning, like a joystick */
  turnX: number;
  turnY: number;
}

export const createIntent = (): Intent => ({
  forward: 0,
  right: 0,
  up: 0,
  fast: false,
  lookX: 0,
  lookY: 0,
  turnX: 0,
  turnY: 0,
});

/** The swimmer between frames: velocity, and the view turn still to be played out by the smoothing. */
export interface Swimmer {
  vx: number;
  vy: number;
  vz: number;
  /** two cascaded low-pass stages for the view, in radians: pending in the first, pending in the second */
  look1X: number;
  look1Y: number;
  look2X: number;
  look2Y: number;
}

export const createSwimmer = (): Swimmer => ({ vx: 0, vy: 0, vz: 0, look1X: 0, look1Y: 0, look2X: 0, look2Y: 0 });

export const SPEED = 7; // metres per second
export const FAST_SPEED = 26;
const LOOK_SCALE = 0.0022; // radians per mouse pixel
const WORLD_RADIUS = 150; // the swimmer stays within this of the origin...
const DEEPEST = -52; // ...and between these depths
const SHALLOWEST = -1.2;
const MAX_PITCH = 1.55;

const body: Body = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };

/**
 * Advances the camera by dt seconds. The view follows the mouse through two smoothing stages, the velocity eases
 * towards what is asked for, and the move is made against the rock (if a collision field is given).
 */
export function stepSwimmer(
  camera: Camera,
  swimmer: Swimmer,
  intent: Intent,
  collision: CollisionField | null,
  dt: number,
): void {
  swimmer.look1X += intent.turnX * 1.5 * dt;
  swimmer.look1Y += intent.turnY * dt;
  // mouse look through two cascaded low-pass stages
  const kq = 1 - Math.exp(-dt * 30);
  swimmer.look1X += intent.lookX * LOOK_SCALE;
  swimmer.look1Y += intent.lookY * LOOK_SCALE;
  intent.lookX = 0;
  intent.lookY = 0;
  const ax = swimmer.look1X * kq,
    ay = swimmer.look1Y * kq;
  swimmer.look1X -= ax;
  swimmer.look1Y -= ay;
  swimmer.look2X += ax;
  swimmer.look2Y += ay;
  const dyaw = swimmer.look2X * kq,
    dpitch = swimmer.look2Y * kq;
  swimmer.look2X -= dyaw;
  swimmer.look2Y -= dpitch;
  const yaw = camera.yaw + dyaw;
  let pitch = camera.pitch - dpitch;
  pitch = pitch < -MAX_PITCH ? -MAX_PITCH : pitch > MAX_PITCH ? MAX_PITCH : pitch;

  // the velocity eases towards the wanted one: forward along the view, sideways level, up straight up
  const speed = intent.fast ? FAST_SPEED : SPEED,
    k = 1 - Math.exp(-dt * 4.5);
  const mf = intent.forward,
    mr = intent.right,
    mu = intent.up;
  const cp = Math.cos(pitch),
    sy = Math.sin(yaw),
    cw = Math.cos(yaw);
  const vx = swimmer.vx + ((sy * cp * mf + cw * mr) * speed - swimmer.vx) * k;
  const vy = swimmer.vy + ((Math.sin(pitch) * mf + mu) * speed - swimmer.vy) * k;
  const vz = swimmer.vz + ((-cw * cp * mf + sy * mr) * speed - swimmer.vz) * k;
  let x = camera.x + vx * dt,
    y = camera.y + vy * dt,
    z = camera.z + vz * dt;
  const radius = Math.sqrt(x * x + z * z);
  if (radius > WORLD_RADIUS) {
    x *= WORLD_RADIUS / radius;
    z *= WORLD_RADIUS / radius;
  }
  y = y < DEEPEST ? DEEPEST : y > SHALLOWEST ? SHALLOWEST : y;

  camera.yaw = yaw;
  camera.pitch = pitch;
  body.x = camera.x;
  body.y = camera.y;
  body.z = camera.z;
  body.vx = vx;
  body.vy = vy;
  body.vz = vz;
  if (collision) moveWithCollision(collision, body, x - camera.x, y - camera.y, z - camera.z);
  else {
    body.x = x;
    body.y = y;
    body.z = z;
  }
  camera.x = body.x;
  camera.y = body.y;
  camera.z = body.z;
  swimmer.vx = body.vx;
  swimmer.vy = body.vy;
  swimmer.vz = body.vz;
  updateBasis(camera);
}
