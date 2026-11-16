// The rest of the swimmer: a waist, two legs in the same wetsuit as the arms, boots, and a pair of fins. They
// are seen when the swimmer hangs upright in the water and looks down; while swimming the body lies along the
// way it goes and they trail behind, out of sight.
//
// Sculpted like the arms (sculpt.ts). A leg hangs from its hip at the origin along -y, toes down, the front of
// the knee towards -z (ahead, in view space); the waist hangs from its top at the origin the same way. Both
// are below y = 0 throughout, and the shader takes that as the way down them.
import type { BuiltMesh } from '../math/mesh';
import { MATERIAL } from './materials';
import { capsule, melt, roundBox, sculpt, smoothstep } from './sculpt';
import { ANKLE, BLADE_JOINT, FIN_TILT, KNEE, LEG, TOE } from './skeleton';

/** How far a point is along the fin from the toes (metres), and how far off the blade's face it stands. */
const alongFin = (y: number, z: number) => -(y - TOE[1]) * Math.cos(FIN_TILT) - (z - TOE[2]) * Math.sin(FIN_TILT);
const offFin = (y: number, z: number) => -(y - TOE[1]) * Math.sin(FIN_TILT) + (z - TOE[2]) * Math.cos(FIN_TILT);
/** The blade is 60 cm long and wider at its end than at the foot. */
const BLADE_LENGTH = 0.6;
const halfWidth = (s: number) => 0.068 + 0.04 * Math.min(Math.max(s / BLADE_LENGTH, 0), 1);

const thigh = (x: number, y: number, z: number) =>
  melt(
    capsule(x, y, z, [0, 0.03, 0], [0, -KNEE, 0], 0.086, 0.062),
    capsule(x, y, z, [0, -KNEE, 0], [0, -ANKLE, 0.004], 0.058, 0.042),
    0.03,
  );
/** The calf, behind the shin; and the kneecap's pad in front. */
const calf = (x: number, y: number, z: number) =>
  capsule(x, y, z, [0, -KNEE - 0.08, 0.02], [0, -KNEE - 0.24, 0.014], 0.047, 0.036);
const kneePad = (x: number, y: number, z: number) => roundBox(x, y, z, [0, -KNEE, -0.056], [0.036, 0.05, 0.005], 0.014);
/** The boot: ankle to instep, the foot pointed; and the fin's pocket over it. */
const boot = (x: number, y: number, z: number) =>
  melt(
    capsule(x, y, z, [0, -ANKLE + 0.02, 0.002], [0, -ANKLE - 0.05, -0.004], 0.045, 0.047),
    capsule(x, y, z, [0, -ANKLE - 0.05, -0.004], [0, TOE[1] + 0.01, TOE[2] + 0.004], 0.047, 0.04),
    0.02,
  );
function pocket(x: number, y: number, z: number) {
  const s = alongFin(y, z);
  const n = offFin(y, z);
  return roundBox(x, s, n, [0, -0.02, 0.012], [0.04, 0.075, 0.022], 0.022);
}
function blade(x: number, y: number, z: number) {
  const s = alongFin(y, z);
  const n = offFin(y, z);
  const qx = Math.abs(x) - halfWidth(s);
  const qs = Math.abs(s - BLADE_LENGTH / 2 - 0.01) - BLADE_LENGTH / 2;
  const qn = Math.abs(n) - 0.0035;
  return Math.hypot(Math.max(qx, 0), Math.max(qs, 0), Math.max(qn, 0)) + Math.min(Math.max(qx, qs, qn), 0) - 0.004;
}
/** A rail down each edge of the blade, and three ribs between them near the foot. */
function rails(x: number, y: number, z: number) {
  const s = alongFin(y, z);
  const n = offFin(y, z);
  const along = Math.min(Math.max(s, 0.02), BLADE_LENGTH - 0.02);
  let d = Math.hypot(Math.abs(x) - halfWidth(along), s - along, n) - 0.0105;
  const short = Math.min(Math.max(s, 0.04), 0.3);
  for (const at of [-0.03, 0, 0.03]) d = Math.min(d, Math.hypot(x - at, s - short, n + 0.004) - 0.006);
  return d;
}

/** One leg, for the four bones that begin at `first` (the two legs are the same shape). */
export function leg(first: number): BuiltMesh {
  const parts = (x: number, y: number, z: number) => [
    melt(thigh(x, y, z), calf(x, y, z), 0.03),
    kneePad(x, y, z),
    melt(boot(x, y, z), pocket(x, y, z), 0.012),
    rails(x, y, z),
    blade(x, y, z),
  ];
  return sculpt({
    distance(x, y, z) {
      const [suit, pad, foot, rail, fin] = parts(x, y, z) as [number, number, number, number, number];
      return Math.min(melt(melt(suit, pad, 0.008), foot, 0.02), melt(melt(foot, rail, 0.006), fin, 0.006));
    },
    describe(x, y, z, out) {
      const [suit, pad, foot, rail, fin] = parts(x, y, z) as [number, number, number, number, number];
      const nearest = Math.min(suit, pad, foot, rail, fin);
      out[3] =
        nearest === fin
          ? MATERIAL.paint
          : nearest === rail || nearest === foot
            ? MATERIAL.rubber
            : pad < 0.003
              ? MATERIAL.armour
              : MATERIAL.suit;
      // which bones carry it: thigh, shin, foot (with the fin's pocket), and the far half of the blade, which bends
      const down = -y;
      const s = alongFin(y, z);
      if (down < KNEE + 0.05) {
        out[0] = first + LEG.thigh;
        out[1] = first + LEG.shin;
        out[2] = 1 - smoothstep(KNEE - 0.05, KNEE + 0.05, down);
      } else if (down < ANKLE + 0.035 && nearest !== fin && nearest !== rail) {
        out[0] = first + LEG.shin;
        out[1] = first + LEG.foot;
        out[2] = 1 - smoothstep(ANKLE - 0.035, ANKLE + 0.035, down);
      } else {
        out[0] = first + LEG.foot;
        out[1] = first + LEG.blade;
        out[2] = 1 - smoothstep(BLADE_JOINT - 0.09, BLADE_JOINT + 0.09, s);
      }
    },
    min: [-0.135, TOE[1] - BLADE_LENGTH - 0.06, -0.26],
    max: [0.135, 0.13, 0.1],
    voxel: 0.0062,
  });
}

/** How far below its top the waist's belt is, and the hips. */
export const BELT = 0.075;
export const PELVIS = 0.2;

/**
 * The waist: the hips and a weight belt. One bone. (No chest: a swimmer looking down their body looks over
 * it, and a chest drawn where it is would be most of the picture.)
 */
export function waist(bone: number): BuiltMesh {
  const body = (x: number, y: number, z: number) =>
    melt(
      roundBox(x, y, z, [0, -0.17, 0], [0.11, 0.05, 0.04], 0.078),
      // (rounded off above, towards where a chest would be)
      capsule(x, y, z, [-0.07, -0.13, 0.01], [0.07, -0.13, 0.01], 0.105),
      0.05,
    );
  const belt = (x: number, y: number, z: number) => Math.max(body(x, y, z) - 0.006, Math.abs(y + BELT) - 0.021);
  const buckle = (x: number, y: number, z: number) =>
    roundBox(x, y, z, [0, -BELT, -0.126], [0.026, 0.019, 0.004], 0.004);
  // a weight on the belt at each hip
  const weights = (x: number, y: number, z: number) =>
    roundBox(Math.abs(x), y, z, [0.19, -BELT, 0.004], [0.012, 0.03, 0.036], 0.008);
  return sculpt({
    distance: (x, y, z) => Math.min(body(x, y, z), belt(x, y, z), buckle(x, y, z), weights(x, y, z)),
    describe(x, y, z, out) {
      out[0] = out[1] = bone;
      out[2] = 1;
      out[3] =
        Math.min(buckle(x, y, z), weights(x, y, z)) < 0.002
          ? MATERIAL.trim
          : belt(x, y, z) < 0.002
            ? MATERIAL.strap
            : MATERIAL.suit;
    },
    min: [-0.225, -0.32, -0.16],
    max: [0.225, 0.02, 0.15],
    voxel: 0.0068,
  });
}
