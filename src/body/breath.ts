// The swimmer's breath: every few seconds a run of bubbles leaves the regulator by the cheeks and rises past
// the mask. They are bubbles like the world's own (shaders/sprites.wgsl), each a closed-form climb from where
// it was let go to the surface; this only decides when and where one starts.
import type { Camera } from '../camera/camera';

/** How many of the swimmer's bubbles there can be at once; the oldest make way. */
export const BREATH_BUBBLES = 256;
const FLOATS = 8;
/** Seconds from one breath out to the next, at rest and working hard. */
const REST = 5.6;
const WORKING = 3.3;
/** Seconds a breath out lasts, and bubbles a second while it does. */
const OUT = 1.5;
const RATE = 26;

export interface Breath {
  /**
   * Eight floats a bubble, as the world's are: where it starts (x, y, z) and its size; then phase, metres a
   * second, the height it has to climb, wobble. A size of 0 is an empty place.
   */
  readonly data: Float32Array;
  /** scene time at which each bubble reaches the surface (its place is then emptied) */
  readonly expires: Float64Array;
  /** the place the next bubble goes */
  next: number;
  /** seconds into this breath */
  clock: number;
  /** bubbles let go in this breath so far */
  let: number;
  /** bubbles the hands have churned up that have not been let go yet (a fraction of one, between frames) */
  churned: number;
  /** `data` has changed since it was last sent to the GPU */
  dirty: boolean;
  /** a breath out has begun since this was last cleared: for the sound */
  began: boolean;
}

export const createBreath = (): Breath => ({
  data: new Float32Array(BREATH_BUBBLES * FLOATS),
  expires: new Float64Array(BREATH_BUBBLES),
  next: 0,
  clock: REST - 1.2, // the first breath out comes soon after the dive
  let: 0,
  churned: 0,
  dirty: false,
  began: false,
});

/**
 * Advances the breathing by dt seconds of scene time. `camera` must have its basis up to date; `effort` 0..1 is
 * how hard the swimmer works (breaths come faster); `breathing` false holds the breath (no body in the water).
 * `random` gives numbers in 0..1.
 */
export function stepBreath(
  breath: Breath,
  camera: Camera,
  time: number,
  dt: number,
  effort: number,
  breathing: boolean,
  random: () => number,
): void {
  const { data, expires } = breath;
  // bubbles that have reached the surface: they would start again from where they began
  for (let i = 0; i < BREATH_BUBBLES; i++) {
    if (data[i * FLOATS + 3]! > 0 && time >= expires[i]!) {
      data[i * FLOATS + 3] = 0;
      breath.dirty = true;
    }
  }
  if (!breathing || dt <= 0) return;
  breath.clock += dt;
  const period = REST + (WORKING - REST) * effort;
  if (breath.clock >= period) {
    breath.clock -= period;
    breath.let = 0;
    breath.began = true;
  }
  if (breath.clock > OUT) return;
  // a breath out starts strongly and tails off
  const due = Math.floor(RATE * OUT * (1 - (1 - breath.clock / OUT) ** 1.6));
  while (breath.let < due) {
    breath.let++;
    // out of the regulator's two sides, a hand's width apart, just below and ahead of the eyes
    const side = breath.let % 2 ? 1 : -1;
    const right = side * (0.105 + 0.03 * random());
    const up = -0.135 + 0.03 * random();
    const ahead = 0.17 + 0.04 * random();
    const x = camera.x + camera.rx * right + camera.ux * up + camera.fx * ahead;
    const y = camera.y + camera.uy * up + camera.fy * ahead;
    const z = camera.z + camera.rz * right + camera.uz * up + camera.fz * ahead;
    const r = random();
    const size = 0.0035 + 0.013 * r * r; // most are small
    letGo(breath, time, x, y, z, size, 0.3 + size * 16, -y, 0.008 + 0.01 * random());
  }
}

/** Puts a bubble into the water at a place: its size, metres a second, how far it climbs before it is gone. */
function letGo(
  breath: Breath,
  time: number,
  x: number,
  y: number,
  z: number,
  size: number,
  speed: number,
  height: number,
  wobble: number,
): void {
  if (y > -0.6) return; // at the surface there is nothing to rise through
  const { data, expires } = breath;
  const i = breath.next * FLOATS;
  data[i] = x;
  data[i + 1] = y;
  data[i + 2] = z;
  data[i + 3] = size;
  // the shader has a bubble at fract(time * speed / height + phase) of its climb: just begun, now
  const turns = (time * speed) / height;
  data[i + 4] = (1.0008 - (turns - Math.floor(turns))) % 1;
  data[i + 5] = speed;
  data[i + 6] = height;
  data[i + 7] = wobble;
  expires[breath.next] = time + (height / speed) * 0.99;
  breath.next = (breath.next + 1) % BREATH_BUBBLES;
  breath.dirty = true;
}

/**
 * The body is drawn through a longer lens than the world (shaders/body.wgsl: BODY_TAN), so a hand is seen
 * nearer the middle of the picture than a thing in the world at the same place would be. A bubble that is to
 * be seen leaving a hand has to start that much further out.
 */
export const BODY_TAN = 0.48;

/** Bubbles a second off one hand at the height of a pull, and while it sculls as hard as it can. */
const CHURN = 46;
const SCULL = 3;

/**
 * The water the hands churn: small bubbles off each on the pull of a stroke, and a few while they scull.
 * `hands` are the wrists in view space (x right, y up, -z ahead) with the way the fingers point; `pull` and
 * `scull` are 0..1; `tanHalf` is the world's lens (the tangent of half its vertical field of view).
 */
export function stepWash(
  breath: Breath,
  camera: Camera,
  time: number,
  dt: number,
  hands: readonly { wrist: readonly number[]; fingers: readonly number[] }[],
  pull: number,
  scull: number,
  tanHalf: number,
  random: () => number,
): void {
  if (dt <= 0) return;
  breath.churned += (CHURN * pull + SCULL * scull) * dt;
  const lens = tanHalf / BODY_TAN;
  while (breath.churned >= 1) {
    breath.churned--;
    for (const { wrist, fingers } of hands) {
      // somewhere along the hand, from the wrist to the fingertips
      const along = (0.03 + 0.14 * random()) / (Math.hypot(fingers[0]!, fingers[1]!, fingers[2]!) || 1);
      const right = (wrist[0]! + fingers[0]! * along + 0.05 * (random() - 0.5)) * lens;
      const up = (wrist[1]! + fingers[1]! * along + 0.05 * (random() - 0.5)) * lens;
      const ahead = -(wrist[2]! + fingers[2]! * along);
      const x = camera.x + camera.rx * right + camera.ux * up + camera.fx * ahead;
      const y = camera.y + camera.uy * up + camera.fy * ahead;
      const z = camera.z + camera.rz * right + camera.uz * up + camera.fz * ahead;
      const r = random();
      const size = 0.0016 + 0.0045 * r * r;
      // small enough to be gone again within a couple of metres
      letGo(breath, time, x, y, z, size, 0.2 + size * 20, Math.min(-y, 1.2 + 1.6 * random()), 0.006);
    }
  }
}
