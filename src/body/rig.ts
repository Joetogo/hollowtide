// The swimmer's body in motion: what the arms and the scooter do, frame by frame.
//
// Each arm is told what its hand should do (where the wrist is, which way the fingers point and the palm
// faces, how the fingers are held), and ./skeleton.ts works the bones out from that. The telling is done here:
// a breaststroke described by a handful of key poses, hands that scull gently when the swimmer hangs still,
// and a grip on the scooter's handles. Everything is in view space: metres from the eye, x right, y up,
// z back (forward is -z).
import type { Drive, Intent } from '../camera/controls';
import { PELVIS } from './legs';
import { GRIP, HANDLE, PART, PROPELLER_AT } from './meshes';
import {
  BONES,
  createArmTarget,
  createPose,
  LEFT,
  poseArm,
  poseRigid,
  PROPELLER_BONE,
  RIGHT,
  SCOOTER_BONE,
  writeSkin,
  type ArmTarget,
  LEG_LEFT,
  LEG_RIGHT,
  poseLeg,
  poseWaist,
} from './skeleton';

/** Seconds for one breaststroke: glide, catch, pull, recover. */
export const STROKE_SECONDS = 1.45;
/** The phase at which the hands begin to press outwards: a stroke started from rest starts here. */
const CATCH = 0.22;
/** Seconds the arms stay stretched out after the last stroke before they come down. */
const GLIDE_HOLD = 0.8;

/**
 * The right shoulder; the left is its mirror image. Out to the side and a little below the eyes: what matters
 * is that the arms always come into the picture from its lower corners, where shoulders are, and never up the
 * middle as if from the chest.
 */
const SHOULDER = [0.25, -0.17, -0.03] as const;
/** Which way the right elbow goes: out to the side and down. Never inwards, whatever the hands do. */
const ELBOW = [0.7, -0.72, 0] as const;

// One breaststroke of the right arm, as key poses: when (0..1), where the wrist is, which way the fingers
// point, which way the palm faces, how far the fingers curl, how far they spread (-1 pressed together), and the
// thumb (swung under the palm, bent). The hands glide stretched out ahead, turn outwards and
// press out and back past the edges of the view, sweep in under the shoulders, and reach forward from
// there at shoulder width, meeting only as the arms straighten (so they never come up the middle of the picture).
// prettier-ignore
const STROKE = [
  // when   wrist                     fingers point           palm faces              curl  spread thumb
  [0.00,    0.066, -0.150, -0.530,   -0.08,  0.30, -0.95,     0.02, -0.95, -0.31,     0.10, -0.9,  0.10, 0.10], // glide: arms all but straight
  [0.22,    0.070, -0.152, -0.525,   -0.04,  0.26, -0.96,     0.28, -0.92, -0.27,     0.08, -0.9,  0.10, 0.10], // palms begin to turn out
  [0.33,    0.170, -0.150, -0.500,    0.30,  0.10, -0.95,     0.75, -0.62,  0.17,     0.04, -0.9,  0.20, 0.10], // catch
  [0.44,    0.300, -0.160, -0.420,    0.58,  0.08, -0.81,     0.70, -0.45,  0.55,     0.05, -0.9,  0.20, 0.10], // pressing out
  [0.55,    0.360, -0.300, -0.200,    0.30, -0.70, -0.64,     0.20, -0.50,  0.84,     0.08, -0.8,  0.25, 0.15], // pulling back and down
  [0.66,    0.250, -0.400, -0.120,   -0.30, -0.40, -0.86,    -0.50,  0.30,  0.80,     0.30, -0.2,  0.35, 0.30], // sweeping in, under the shoulders
  [0.78,    0.200, -0.320, -0.200,   -0.10,  0.10, -0.99,    -0.30, -0.90, -0.20,     0.36,  0.0,  0.30, 0.30], // turning palm down there
  [0.90,    0.130, -0.205, -0.410,   -0.12,  0.22, -0.97,    -0.10, -0.95, -0.25,     0.20, -0.5,  0.15, 0.15], // reaching forward, closing in
] as const;
const CHANNELS = 13;

/** Where the scooter is held: its origin, in front of the chest. */
const SCOOTER = [0, -0.27, -0.72] as const;
/** It is held nose down by this much (radians), so that the swimmer looks along its back. */
const SCOOTER_TILT = 0.3;

export interface BodyState {
  /** where in the stroke the arms are, 0..1; 0 is stretched out, gliding */
  phase: number;
  /** 0 = arms at rest, 1 = swimming */
  swim: number;
  /** seconds spent gliding since the last stroke ended */
  glide: number;
  /** 0 = hands free, 1 = the scooter is up and held; in between, the arms go down and it comes up */
  equip: number;
  /** how hard the scooter's propeller is driven, 0..1 */
  throttle: number;
  /** the propeller's angle, radians */
  spin: number;
  /** 0 = out of sight (in the menu), 1 = in the water */
  shown: number;
  /** seconds, for the scooter's tremble */
  time: number;
  /** the clock of the hands' sculling at rest: it runs faster the harder they work */
  scullClock: number;
  /** how hard the hands are sculling, 0 (hanging still) to 1 (moving sideways, backwards, up or down) */
  scull: number;
  /** strokes swum, and how wide this one is (no two strokes are quite alike) */
  strokes: number;
  width: number;
  /** how the view is turning, radians a second, smoothed: the arms and the scooter trail a little behind it */
  swayX: number;
  swayY: number;
  /** what the stroke does to the view: the head dips on the pull (radians) and rides up on the glide (metres) */
  nod: number;
  heave: number;
  /** 0..1: how much the scooter's pull has widened the view */
  rush: number;
  /** the hands as they are, following what they are told with a little give: right, left */
  hands: [ArmTarget, ArmTarget];
  /** false until the hands have been somewhere: the first frame puts them straight where they belong */
  settled: boolean;
  /** the way the swimmer looks, radians above level: set by whoever has the camera, before the body is posed */
  pitch: number;
  /** 0 = hanging upright in the water, 1 = lying along the way they swim (the legs then trail behind) */
  lean: number;
  /** the clock of the legs' kick, radians */
  kick: number;
}

export const createBodyState = (): BodyState => ({
  phase: 0,
  swim: 0,
  glide: 9,
  equip: 0,
  throttle: 0,
  spin: 0,
  shown: 0,
  time: 0,
  scullClock: 0,
  scull: 0,
  strokes: 0,
  width: 1,
  swayX: 0,
  swayY: 0,
  nod: 0,
  heave: 0,
  rush: 0,
  hands: [createArmTarget(), createArmTarget()],
  settled: false,
  pitch: 0,
  lean: 0,
  kick: 0,
});

const approach = (value: number, target: number, step: number) =>
  value < target ? Math.min(target, value + step) : Math.max(target, value - step);
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** The pull of a stroke at a phase, 0..1: nothing while the arms reach, a swell through the press and the pull. */
const pull = (phase: number) => {
  const t = (phase - 0.3) / 0.42;
  return t <= 0 || t >= 1 ? 0 : 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
};
/**
 * How fast the stroke runs at a phase, relative to its mean: a swimmer lingers in the glide and is quick about
 * pulling through and bringing the hands back (which is also the part that happens out of sight).
 */
export function strokeRate(phase: number): number {
  const t = (phase - 0.48) / 0.46;
  return 0.82 + (t <= 0 || t >= 1 ? 0 : 0.85 * (0.5 - 0.5 * Math.cos(t * Math.PI * 2)));
}
// Two numbers that follow from the two curves above, found by adding them up once: how long a stroke would take
// at these rates (so that it can be made to take STROKE_SECONDS), and how strong the pull has to be for the push
// to average 1 over the time of a stroke.
const BASE_GAIN = 0.62;
let strokeTime = 0;
let pullTime = 0;
for (let i = 0; i < 2000; i++) {
  const phase = (i + 0.5) / 2000;
  strokeTime += 1 / strokeRate(phase) / 2000;
  pullTime += pull(phase) / strokeRate(phase) / 2000;
}
const PULL_GAIN = ((1 - BASE_GAIN) * strokeTime) / pullTime;
/** The pull of a stroke at a phase, 0..1 (see `pull`): for what else follows it, such as the water it churns. */
export const strokePull = (phase: number): number => pull(phase);
/** How hard a stroke pushes at a phase, as a multiple of the steady swimming speed; over the time of a stroke it averages 1. */
export function strokeGain(phase: number): number {
  return BASE_GAIN + PULL_GAIN * pull(phase);
}

/**
 * Advances the body by dt seconds, given what the swimmer is asking for, whether the body is to be seen, and
 * how fast the view is turning (radians a second, to the right and upwards). Fills `drive` for the swimming step.
 */
export function stepBody(
  state: BodyState,
  intent: Intent,
  visible: boolean,
  dt: number,
  drive: Drive,
  yawRate = 0,
  pitchRate = 0,
): void {
  state.time += dt;
  state.shown = approach(state.shown, visible ? 1 : 0, dt / 0.8);
  state.equip = approach(state.equip, intent.fast ? 1 : 0, dt / 0.55);

  // the stroke: runs while forward is asked for, and a pull that has begun is always finished
  const wanted = intent.forward > 0.1 && state.equip === 0;
  // let go while the arms are still reaching: there is no pull to finish, they are already where a glide has them
  if (!wanted && state.phase < CATCH) state.phase = 0;
  const under = state.phase > 0; // somewhere in a stroke
  if (wanted || under) {
    if (!under && state.glide > 0.25) state.phase = CATCH; // from rest, or after a long glide: straight into the catch
    state.phase += (dt / STROKE_SECONDS) * strokeRate(state.phase) * strokeTime;
    if (state.phase >= 1) {
      state.phase = wanted ? state.phase - 1 : 0;
      // the next stroke is a little wider or narrower than this one
      state.strokes++;
      state.width = 0.93 + 0.14 * (((state.strokes * 0.61803398875) % 1) + 0);
    }
    state.glide = 0;
  } else state.glide += dt;
  const swimming = (wanted || under || state.glide < GLIDE_HOLD) && state.equip === 0;
  state.swim = approach(state.swim, swimming ? 1 : 0, dt / 0.4);
  // swimming or riding, the body lies along its way; hanging still it comes upright, and the legs kick slowly
  // to stay there, faster when the swimmer is going up, down or sideways
  state.lean = approach(state.lean, swimming || state.equip > 0 ? 1 : 0, dt / 0.9);
  state.kick = (state.kick + dt * (1.7 + 2.4 * state.scull)) % (Math.PI * 2);

  const held = state.equip > 0.9;
  drive.jet = held && intent.fast;
  drive.gain = held ? 1 : 1 + (strokeGain(state.phase) - 1) * state.swim * (under || wanted ? 1 : 0);
  state.throttle = approach(state.throttle, drive.jet ? 1 : 0, dt / 0.35);
  state.spin = (state.spin + state.throttle * 55 * dt) % (Math.PI * 2);

  // moving any way but forward is done with the hands alone: they scull harder and faster
  const effort = Math.min(1, Math.abs(intent.right) + Math.abs(intent.up) + Math.max(-intent.forward, 0));
  state.scull += (effort - state.scull) * (1 - Math.exp(-dt * 5));
  state.scullClock += dt * (1.5 + 2.4 * state.scull);

  // what the body does to the view, and the view to the body
  const ease = 1 - Math.exp(-dt * 7);
  state.swayX += (clamp(yawRate, -3, 3) - state.swayX) * ease;
  state.swayY += (clamp(pitchRate, -3, 3) - state.swayY) * ease;
  state.rush += (state.throttle - state.rush) * (1 - Math.exp(-dt * 2.2));
  const stroking = state.swim * (under ? 1 : 0);
  state.nod += (-0.016 * pull(state.phase) * stroking - state.nod) * (1 - Math.exp(-dt * 10));
  state.heave += ((0.02 * Math.sin((state.phase - 0.12) * Math.PI * 2) - 0.008) * stroking - state.heave) * ease;
}

// ---------------------------------------------------------------- posing

/** Where the body turns when it goes from upright to lying along its way: the base of the neck, from the eye. */
const NECK = [0, -0.13, 0.09] as const;
/**
 * The top of the waist from the neck, in the upright body; and how far each hip is from the middle. (It hangs
 * well behind the eye: someone looking down their body leans over it, and sees their legs past their hips.)
 */
const WAIST_TOP = [0, -0.42, 0.11] as const;
const HIP_APART = 0.094;
/** Upright in the water: how far forward the thighs are held, and how far the knees are bent (radians). */
const SIT = 0.8;
const KNEES = 0.5;
/** How far the body lies back when it swims, radians from upright. */
const PRONE = 1.25;
/** The legs are posed and drawn once the swimmer looks this far down their own body (radians): before that
 * they are below the picture. */
const LEGS_SEEN = 0.75;

/** What to draw this frame: which meshes, and where every bone has taken its part of them. */
export interface BodyParts {
  count: number;
  mesh: Uint8Array;
  /** for the shader: 4 floats of rotation for every bone, then 4 of offset for every bone */
  skin: Float32Array;
}
export const createBodyParts = (): BodyParts => ({
  count: 0,
  mesh: new Uint8Array(9),
  skin: new Float32Array(BONES * 8),
});

const pose = createPose();
const stroke = createArmTarget();
const rest = createArmTarget();
const wanted = createArmTarget();
const key = new Float64Array(CHANNELS);

/** The right arm's target at a stroke phase: the key poses joined by a smooth closed curve. */
function strokeAt(phase: number, out: ArmTarget): void {
  phase -= Math.floor(phase);
  const n = STROKE.length;
  let i = n - 1;
  while (i > 0 && STROKE[i]![0] > phase) i--;
  const k0 = STROKE[(i + n - 1) % n]!;
  const k1 = STROKE[i]!;
  const k2 = STROKE[(i + 1) % n]!;
  const k3 = STROKE[(i + 2) % n]!;
  // key times, unwrapped around the segment k1..k2
  const t1 = k1[0];
  const t2 = k2[0] + (i + 1 >= n ? 1 : 0);
  const t0 = k0[0] - (i === 0 ? 1 : 0);
  const t3 = k3[0] + (i + 2 >= n ? 1 : 0);
  const span = t2 - t1;
  const u = (phase - t1) / span;
  const u2 = u * u;
  const u3 = u2 * u;
  for (let c = 0; c < CHANNELS; c++) {
    // a Hermite segment whose slopes at the keys are those of the chords across them
    const m1 = ((k2[c + 1]! - k0[c + 1]!) / (t2 - t0)) * span;
    const m2 = ((k3[c + 1]! - k1[c + 1]!) / (t3 - t1)) * span;
    key[c] =
      (2 * u3 - 3 * u2 + 1) * k1[c + 1]! + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * k2[c + 1]! + (u3 - u2) * m2;
  }
  out.wrist[0] = key[0]!;
  out.wrist[1] = key[1]!;
  out.wrist[2] = key[2]!;
  out.fingers[0] = key[3]!;
  out.fingers[1] = key[4]!;
  out.fingers[2] = key[5]!;
  out.palm[0] = key[6]!;
  out.palm[1] = key[7]!;
  out.palm[2] = key[8]!;
  // the little finger trails the index a touch: a hand is not a board
  for (let f = 0; f < 4; f++) out.curl[f] = Math.max(0, key[9]! * (1 + f * 0.12));
  out.spread = key[10]!;
  out.thumbUnder = key[11]!;
  out.thumbBend = key[12]!;
}

/**
 * The right arm's target at rest: low and wide, palm down, sculling in slow figures of eight. `t` is the
 * sculling clock; `work` (0..1) makes the strokes larger and brings the hands up, as when the swimmer moves
 * sideways or backs away.
 */
function restAt(t: number, work: number, out: ArmTarget): void {
  const reach = 1 + 1.2 * work;
  out.wrist[0] = 0.21 + 0.02 * work + 0.04 * reach * Math.sin(t);
  out.wrist[1] = -0.2 + 0.025 * work + 0.012 * reach * Math.sin(t * 2 + 0.4);
  out.wrist[2] = -0.43 + 0.022 * reach * Math.cos(t);
  out.fingers[0] = 0.2 + 0.16 * reach * Math.cos(t);
  out.fingers[1] = 0.16;
  out.fingers[2] = -0.96;
  // the palm rocks to press on the water whichever way the hand is going
  out.palm[0] = (0.42 + 0.3 * work) * Math.cos(t);
  out.palm[1] = -1;
  out.palm[2] = 0.08;
  for (let f = 0; f < 4; f++) out.curl[f] = 0.3 + f * 0.07 + 0.06 * Math.sin(t * 1.3 + f * 0.9);
  out.spread = 0.3 + 0.1 * Math.sin(t * 0.7);
  out.thumbUnder = 0.22;
  out.thumbBend = 0.25;
}

/** a + (b - a) * w, for every part of an arm target. */
function blend(out: ArmTarget, a: ArmTarget, b: ArmTarget, w: number): void {
  for (let i = 0; i < 3; i++) {
    out.wrist[i] = a.wrist[i]! + (b.wrist[i]! - a.wrist[i]!) * w;
    out.fingers[i] = a.fingers[i]! + (b.fingers[i]! - a.fingers[i]!) * w;
    out.palm[i] = a.palm[i]! + (b.palm[i]! - a.palm[i]!) * w;
  }
  for (let f = 0; f < 4; f++) out.curl[f] = a.curl[f]! + (b.curl[f]! - a.curl[f]!) * w;
  out.spread = a.spread + (b.spread - a.spread) * w;
  out.thumbUnder = a.thumbUnder + (b.thumbUnder - a.thumbUnder) * w;
  out.thumbBend = a.thumbBend + (b.thumbBend - a.thumbBend) * w;
}

/**
 * Poses both arms straight from what their hands are told, with nothing else in play: for holding a hand up to
 * look at it. Targets are in view space, each for its own arm (no mirroring).
 */
export function poseHands(parts: BodyParts, right: ArmTarget, left: ArmTarget): void {
  parts.count = 0;
  for (const side of [1, -1] as const) {
    const first = side > 0 ? RIGHT : LEFT;
    const target = side > 0 ? right : left;
    poseArm(
      pose,
      first,
      side,
      target,
      SHOULDER[0] * side,
      SHOULDER[1],
      SHOULDER[2],
      ELBOW[0] * side,
      ELBOW[1],
      ELBOW[2],
    );
  }
  parts.mesh[parts.count++] = PART.sleeveRight;
  parts.mesh[parts.count++] = PART.handRight;
  parts.mesh[parts.count++] = PART.sleeveLeft;
  parts.mesh[parts.count++] = PART.handLeft;
  writeSkin(pose, parts.skin);
}

/**
 * Fills `parts` with the body as it is in `state`. `dt` is the time since the last call: the hands follow what
 * they are told with a little give, so nothing about them is abrupt (0 puts them straight there).
 */
export function poseBody(state: BodyState, parts: BodyParts, dt = 0): void {
  parts.count = 0;
  if (state.shown <= 0) {
    state.settled = false;
    return;
  }
  const hidden = (1 - smooth(state.shown)) * 0.6;
  const follow = state.settled && dt > 0 ? 1 - Math.exp(-dt * 24) : 1;
  state.settled = true;
  // the arms hang back a little from a turning view, as they would in water
  const swayX = -state.swayX * 0.022;
  const swayY = -state.swayY * 0.018;
  const swimming = state.equip < 0.5;
  const drop = hidden + (swimming ? smooth(state.equip * 2) : 1 - smooth(state.equip * 2 - 1)) * 0.58;

  // ---- the scooter, held nose down: its forward and up in view space
  const ct = Math.cos(SCOOTER_TILT);
  const st = Math.sin(SCOOTER_TILT);
  // it leans into a turn and trembles a little under power
  const lean = clamp(-state.swayX * 0.1, -0.3, 0.3);
  const cl = Math.cos(lean);
  const sl = Math.sin(lean);
  const shake = state.throttle * 0.0022;
  const ox = SCOOTER[0] + swayX * 0.6 + Math.sin(state.time * 31) * shake;
  const oy = SCOOTER[1] - drop + swayY * 0.6 + Math.sin(state.time * 37 + 1) * shake;
  const oz = SCOOTER[2];
  // right (x), forward (y) and up (z) of the scooter's own frame, as view-space vectors
  const rightX = cl;
  const rightY = sl * ct;
  const rightZ = -sl * st;
  const upX = -sl;
  const upY = cl * ct;
  const upZ = -cl * st;

  for (const side of [1, -1] as const) {
    const hand = state.hands[side > 0 ? 0 : 1];
    if (swimming) {
      // the stroke, blended with hands at rest; the left arm runs a hair behind the right, as arms do
      strokeAt(state.phase + (side > 0 ? 0 : -0.012), stroke);
      restAt(state.scullClock + (side > 0 ? 0 : 1.4), state.scull, rest);
      // (how wide the hands go differs a little from stroke to stroke)
      stroke.wrist[0] = 0.066 + (stroke.wrist[0] - 0.066) * state.width;
      blend(wanted, rest, stroke, smooth(state.swim));
    } else {
      // on the scooter's handle: fingers forward along its back, palm down on the bar, hand closed round it
      const handleX = ox + rightX * HANDLE[0] * side + upX * HANDLE[2];
      const handleY = oy + rightY * HANDLE[0] * side - st * HANDLE[1] + upY * HANDLE[2];
      const handleZ = oz + rightZ * HANDLE[0] * side - ct * HANDLE[1] + upZ * HANDLE[2];
      wanted.fingers[0] = 0;
      wanted.fingers[1] = -st;
      wanted.fingers[2] = -ct;
      wanted.palm[0] = -upX * side;
      wanted.palm[1] = -upY;
      wanted.palm[2] = -upZ;
      // the wrist is where it must be for the bar to lie in the hand (less what is added to every wrist below)
      wanted.wrist[0] = (handleX + upX * GRIP[1] - swayX) * side;
      wanted.wrist[1] = handleY + st * GRIP[0] + upY * GRIP[1] + drop - swayY;
      wanted.wrist[2] = handleZ + ct * GRIP[0] + upZ * GRIP[1];
      for (let f = 0; f < 4; f++) wanted.curl[f] = 1.36 + f * 0.03;
      wanted.spread = -0.3;
      wanted.thumbUnder = 0.95;
      wanted.thumbBend = 0.85;
    }
    // (targets are worked out for a right arm; the left one's are their mirror image)
    wanted.wrist[0] = wanted.wrist[0] * side + swayX;
    wanted.wrist[1] += swayY - drop;
    wanted.fingers[0] *= side;
    wanted.palm[0] *= side;
    blend(hand, hand, wanted, swimming ? follow : 1); // a hand on a handle goes exactly where the handle goes

    // the elbow goes out to the side and down, and stays high through the pull
    const high = smooth((-0.26 - (hand.wrist[1] + drop)) / 0.1) * clamp((Math.abs(hand.wrist[0]) - 0.15) / 0.09, 0, 1);
    poseArm(
      pose,
      side > 0 ? RIGHT : LEFT,
      side,
      hand,
      SHOULDER[0] * side,
      SHOULDER[1] - drop,
      SHOULDER[2],
      ELBOW[0] * side,
      ELBOW[1] + 0.75 * high,
      ELBOW[2],
    );
  }
  parts.mesh[parts.count++] = PART.sleeveRight;
  parts.mesh[parts.count++] = PART.handRight;
  parts.mesh[parts.count++] = PART.sleeveLeft;
  parts.mesh[parts.count++] = PART.handLeft;

  if (!swimming) {
    poseRigid(pose, SCOOTER_BONE, ox, oy, oz, 0, -st, -ct, upX, upY, upZ);
    // the propeller turns about the scooter's forward axis, at the back
    const cs = Math.cos(state.spin);
    const ss = Math.sin(state.spin);
    poseRigid(
      pose,
      PROPELLER_BONE,
      ox,
      oy - st * PROPELLER_AT,
      oz - ct * PROPELLER_AT,
      0,
      -st,
      -ct,
      upX * cs + rightX * ss,
      upY * cs + rightY * ss,
      upZ * cs + rightZ * ss,
    );
    parts.mesh[parts.count++] = PART.scooter;
    parts.mesh[parts.count++] = PART.propeller;
  }

  // ---- the waist and the legs. The body turns at the base of the neck: upright it hangs straight down from
  // there, swimming it lies back along the way it goes. Seen from the eye, which looks `pitch` above level, it
  // hangs at `hang` from straight down the picture: only a swimmer who is upright and looks down sees it.
  const hang = -state.pitch - PRONE * smooth(state.lean);
  if (state.shown >= 1 && hang > LEGS_SEEN) {
    const cp = Math.cos(state.pitch);
    const sp = Math.sin(state.pitch);
    const cb = Math.cos(hang);
    const sb = Math.sin(hang);
    const neckY = NECK[1] * cp + NECK[2] * sp;
    const neckZ = -NECK[1] * sp + NECK[2] * cp;
    // where a point of the upright body (given from the neck) is in view space
    const atY = (y: number, z: number) => neckY + y * cb - z * sb;
    const atZ = (y: number, z: number) => neckZ + y * sb + z * cb;
    const upright = 1 - smooth(state.lean);
    // the hips tip back a little, as they do when the knees come forward
    poseWaist(pose, 0, atY(WAIST_TOP[1], WAIST_TOP[2]), atZ(WAIST_TOP[1], WAIST_TOP[2]), hang - 0.3 * upright);
    const hipY = WAIST_TOP[1] - PELVIS * Math.cos(0.3 * upright) - 0.02;
    const hipZ = WAIST_TOP[2] - PELVIS * Math.sin(0.3 * upright) * 0.5;
    const work = 1 + 0.6 * state.scull;
    for (const side of [1, -1] as const) {
      // Upright, a swimmer sits in the water: thighs forward, knees bent, fins hanging below them (legs hanging
      // straight down would be hidden under the hips of whoever looks down at them). On that, a slow flutter:
      // the thigh swings, the knee gives on the way back, the fin trails behind the foot.
      const beat = state.kick + (side > 0 ? 0 : Math.PI);
      poseLeg(
        pose,
        side > 0 ? LEG_RIGHT : LEG_LEFT,
        HIP_APART * side,
        atY(hipY, hipZ),
        atZ(hipY, hipZ),
        hang,
        SIT * upright + 0.17 * work * Math.sin(beat),
        0.14 * side,
        -0.16 * side,
        KNEES * upright + 0.12 + 0.24 * work * (0.5 - 0.5 * Math.cos(beat - 0.9)),
        0.42 * upright - 0.24 * work * Math.cos(beat),
        -0.32 * work * Math.cos(beat - 0.6),
      );
    }
    parts.mesh[parts.count++] = PART.waist;
    parts.mesh[parts.count++] = PART.legRight;
    parts.mesh[parts.count++] = PART.legLeft;
  }
  writeSkin(pose, parts.skin);
}
