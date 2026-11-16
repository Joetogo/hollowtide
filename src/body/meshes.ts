// The swimmer's own body and gear, as seen in first person: two arms in a wetsuit with gloved hands, a dive
// computer on the left wrist, and a hand-held scooter. The arms are sculpted in the bind pose of
// ./skeleton.ts and every vertex is tied to the one or two bones that move it, so elbows, wrists and fingers
// bend without a seam.
import type { BuiltMesh } from '../math/mesh';
import type { MeshRange } from '../world/data';
import { band, BODY_VERTEX_BYTES, capsule, clamp01, melt, mix, roundBox, sculpt, smoothstep } from './sculpt';
import {
  ARM_BONES,
  BONE,
  fingerDirection,
  FINGERS,
  FOREARM,
  PROPELLER_BONE,
  SCOOTER_BONE,
  THUMB,
  THUMB_DIRECTION,
  UPPER_ARM,
  WRIST,
} from './skeleton';

/** The scooter's handles, from its origin: sideways (either way), forward, up. */
export const HANDLE = [0.19, -0.1, 0.06] as const;
/** Where the scooter's propeller turns, forward of its origin. */
export const PROPELLER_AT = -0.19;
/** Where a hand that grips a bar holds it, from the wrist, in the hand's own frame: along the fingers, towards the palm. */
export const GRIP = [0.088, 0.028] as const;

/** Positions in `BodyMeshes.ranges`. */
export const PART = { sleeveRight: 0, handRight: 1, sleeveLeft: 2, handLeft: 3, scooter: 4, propeller: 5 } as const;

/** What a surface is made of: the numbers shaders/body.wgsl knows. */
export const MATERIAL = {
  neoprene: 0,
  fabric: 1, // the back of the glove
  rubber: 2, // its palm and fingertips
  armour: 3, // the pads over the knuckles and fingers
  strap: 4,
  computer: 5,
  screen: 6,
  paint: 7,
  trim: 8,
  lamp: 9,
  blades: 10,
} as const;

export interface BodyMeshes {
  vertices: Uint8Array;
  indices: Uint32Array;
  ranges: MeshRange[];
}

// ---------------------------------------------------------------- the sleeve: shoulder to wrist

const ELBOW_BLEND = 0.05; // metres either side of the elbow over which the two bones share the sleeve
const COMPUTER_AT = WRIST - 0.1; // the dive computer: along the arm, on the back of the left forearm

function sleeve(side: 1 | -1): BuiltMesh {
  const first = side > 0 ? 0 : ARM_BONES;
  const U = UPPER_ARM;
  // the forearm is fullest a third of the way down and slim and rather flat at the wrist
  const flat = (y: number) => mix(1, 0.8, clamp01((y - U - 0.09) / (FOREARM - 0.09)));
  const computer = (x: number, y: number, z: number) =>
    side > 0 ? 1e9 : roundBox(x, y, z, [0, COMPUTER_AT, 0.043], [0.02, 0.0245, 0.0055], 0.0065);
  const arm = (x: number, y: number, z: number) => {
    let d = capsule(x, y, z, [0, -0.03, 0], [0, U * 0.5, 0.004], 0.061, 0.059);
    d = melt(d, capsule(x, y, z, [0, U * 0.5, 0.004], [0, U, 0], 0.059, 0.0485), 0.03);
    d = melt(d, capsule(x, y, z, [0, U, 0], [0, U + 0.09, 0.002], 0.0475, 0.0495), 0.03);
    return melt(d, capsule(x, y, z / flat(y), [0, U + 0.09, 0.002], [0, WRIST - 0.025, 0], 0.0495, 0.0315), 0.02);
  };
  const distance = (x: number, y: number, z: number) => {
    x *= side;
    let d = arm(x, y, z);
    if (side < 0) {
      // the computer's strap, snug round the forearm, and its case on top
      d = melt(d, band(x, y, z / flat(y), COMPUTER_AT, 0.0395, 0.011, 0.0028), 0.003);
      d = melt(d, computer(x, y, z), 0.004);
    }
    return d;
  };
  return sculpt({
    distance,
    describe(x, y, z, out) {
      x *= side;
      if (computer(x, y, z) < 0.003 || (side < 0 && Math.abs(y - COMPUTER_AT) < 0.0135 && arm(x, y, z) > 0.0012)) {
        // the computer and its strap: carried whole by the wrist end of the forearm
        out[0] = out[1] = first + BONE.twist;
        out[2] = 1;
        const face = z > 0.0475 && Math.abs(x) < 0.0165 && Math.abs(y - COMPUTER_AT) < 0.021;
        out[3] = face ? MATERIAL.screen : MATERIAL.computer;
        return;
      }
      out[3] = MATERIAL.neoprene;
      if (y < U + ELBOW_BLEND) {
        out[0] = first + BONE.upper;
        out[1] = first + BONE.fore;
        out[2] = 1 - smoothstep(-ELBOW_BLEND, ELBOW_BLEND, y - U);
      } else {
        // down the forearm the twist comes in gradually, as it does in a real one
        out[0] = first + BONE.fore;
        out[1] = first + BONE.twist;
        out[2] = 1 - smoothstep(U + ELBOW_BLEND, WRIST - 0.03, y);
      }
    },
    min: [-0.078, -0.1, -0.078],
    max: [0.078, WRIST - 0.004, 0.078],
    voxel: 0.0052,
  });
}

// ---------------------------------------------------------------- the hand: a glove from the wrist out

/** A finger or the thumb in the bind pose: where it starts, the way it points, its bones and radii. */
interface Digit {
  root: readonly number[];
  direction: readonly number[];
  bones: readonly number[];
  radius: readonly number[];
  /** the first of its three bones, counted from the arm's first */
  bone: number;
  thumb: boolean;
}
const DIGITS: Digit[] = [
  ...FINGERS.map((f, i) => ({
    root: [f.knuckle[0], WRIST + f.knuckle[1], f.knuckle[2]],
    direction: fingerDirection(i),
    bones: f.bones,
    radius: f.radius,
    bone: BONE.finger + i * 3,
    thumb: false,
  })),
  {
    root: [THUMB.root[0], WRIST + THUMB.root[1], THUMB.root[2]],
    direction: THUMB_DIRECTION,
    bones: THUMB.bones,
    radius: THUMB.radius,
    bone: BONE.thumb,
    thumb: true,
  },
];
/** A point `along` a digit from its root. */
const at = (d: Digit, along: number) => [
  d.root[0]! + d.direction[0]! * along,
  d.root[1]! + d.direction[1]! * along,
  d.root[2]! + d.direction[2]! * along,
];
const lengthOf = (d: Digit) => d.bones[0]! + d.bones[1]! + d.bones[2]!;

function digit(x: number, y: number, z: number, d: Digit): number {
  const total = lengthOf(d);
  const [r0, r1] = [d.radius[0]!, d.radius[1]!];
  const j1 = d.bones[0]!;
  const j2 = j1 + d.bones[1]!;
  const r = (along: number) => mix(r0, r1, along / total);
  // three bones, each a touch fuller in the middle than at its joints, and a rounded tip
  let s = capsule(x, y, z, at(d, 0), at(d, j1), r(0), r(j1) * 0.985);
  s = melt(s, capsule(x, y, z, at(d, j1), at(d, j2), r(j1), r(j2) * 0.98), 0.004);
  return melt(s, capsule(x, y, z, at(d, j2), at(d, total - r1 * 0.6), r(j2), r1), 0.004);
}

/** The pads on the back of the glove: a plate over the knuckles and a bar along each finger's first bone. */
function armour(x: number, y: number, z: number): number {
  let d = roundBox(x, y, z, [-0.001, WRIST + 0.071, 0.0162], [0.0295, 0.0105, 0.0016], 0.0042);
  for (let f = 0; f < 4; f++) {
    const finger = DIGITS[f]!;
    const lift = finger.radius[0]! - 0.0008;
    const a = at(finger, finger.bones[0]! * 0.3);
    const b = at(finger, finger.bones[0]! * 0.82);
    d = Math.min(d, capsule(x, y, z, [a[0]!, a[1]!, a[2]! + lift], [b[0]!, b[1]!, b[2]! + lift], 0.0044));
  }
  return d;
}
/** The strap round the wrist, with its tab on the back. */
function strap(x: number, y: number, z: number): number {
  const d = band(x, y, z / 0.84, WRIST - 0.026, 0.0345, 0.0085, 0.0026);
  return Math.min(d, roundBox(x, y, z, [0.012, WRIST - 0.026, 0.0315], [0.011, 0.0075, 0.0012], 0.003));
}

function hand(side: 1 | -1): BuiltMesh {
  const first = side > 0 ? 0 : ARM_BONES;
  const distance = (x: number, y: number, z: number) => {
    x *= side;
    // the gauntlet over the end of the sleeve, flaring a little at its edge
    let d = capsule(x, y, z / 0.84, [0, WRIST - 0.066, 0], [0, WRIST - 0.002, 0], 0.0372, 0.0318);
    d = melt(d, band(x, y, z / 0.84, WRIST - 0.066, 0.0362, 0.002, 0.0026), 0.004);
    // the palm, with the ball of the thumb and the heel of the hand
    d = melt(d, roundBox(x, y, z, [-0.001, WRIST + 0.047, 0], [0.0335, 0.04, 0.0078], 0.0125), 0.016);
    d = melt(
      d,
      capsule(x, y, z, [-0.019, WRIST + 0.014, -0.0105], [-0.034, WRIST + 0.047, -0.0125], 0.0165, 0.0138),
      0.012,
    );
    d = melt(d, capsule(x, y, z, [0.027, WRIST + 0.016, -0.0065], [0.0305, WRIST + 0.06, -0.0045], 0.0132), 0.012);
    // knuckles: a little proud of the back of the hand
    for (let f = 0; f < 4; f++) {
      const k = DIGITS[f]!.root;
      const knuckle = capsule(x, y, z, [k[0]!, k[1]! - 0.004, k[2]! + 0.0045], [k[0]!, k[1]!, k[2]! + 0.0045], 0.0112);
      d = melt(d, knuckle, 0.008);
    }
    // the digits: each melts into the palm, but not into its neighbour
    let digits = 1e9;
    for (const each of DIGITS) digits = Math.min(digits, digit(x, y, z, each));
    d = melt(d, digits, 0.0085);
    d = melt(d, armour(x, y, z), 0.0022);
    return melt(d, strap(x, y, z), 0.002);
  };
  return sculpt({
    distance,
    describe(x, y, z, out) {
      x *= side;
      // ---- which bones: the digit this point belongs to, if any
      let best: Digit | null = null;
      let bestAlong = 0;
      let bestGap = 1e9;
      for (const each of DIGITS) {
        const dx = x - each.root[0]!;
        const dy = y - each.root[1]!;
        const dz = z - each.root[2]!;
        const along = dx * each.direction[0]! + dy * each.direction[1]! + dz * each.direction[2]!;
        if (along < -0.012) continue;
        const gap =
          Math.hypot(
            dx - each.direction[0]! * along,
            dy - each.direction[1]! * along,
            dz - each.direction[2]! * along,
          ) - each.radius[0]!;
        if (gap < 0.0065 && gap < bestGap) {
          best = each;
          bestAlong = along;
          bestGap = gap;
        }
      }
      let palmSide = z < -0.003;
      if (best) {
        const j1 = best.bones[0]!;
        const j2 = j1 + best.bones[1]!;
        const bone = first + best.bone;
        // a joint shares the surface a centimetre or so either side between the bones it joins
        if (bestAlong < j1 * 0.5) {
          out[0] = first + BONE.hand;
          out[1] = bone;
          out[2] = 1 - smoothstep(-0.011, 0.011, bestAlong);
        } else if (bestAlong < (j1 + j2) * 0.5) {
          out[0] = bone;
          out[1] = bone + 1;
          out[2] = 1 - smoothstep(j1 - 0.0085, j1 + 0.0085, bestAlong);
        } else {
          out[0] = bone + 1;
          out[1] = bone + 2;
          out[2] = 1 - smoothstep(j2 - 0.0075, j2 + 0.0075, bestAlong);
        }
        // a digit's palm side is the side its curl takes it to (for the thumb, that is partly sideways); its
        // tip is capped all round
        const towardsPalm = best.thumb ? (z - best.root[2]!) * 0.6 - (x - best.root[0]!) * 0.5 : z - best.root[2]!;
        palmSide = towardsPalm < -0.0015 || bestAlong > lengthOf(best) - best.bones[2]! * 0.62;
      } else {
        out[0] = first + BONE.twist;
        out[1] = first + BONE.hand;
        out[2] = 1 - smoothstep(WRIST - 0.034, WRIST + 0.012, y);
      }
      // ---- what it is made of
      out[3] =
        strap(x, y, z) < 0.0014
          ? MATERIAL.strap
          : armour(x, y, z) < 0.0013
            ? MATERIAL.armour
            : palmSide && y > WRIST - 0.004
              ? MATERIAL.rubber
              : MATERIAL.fabric;
    },
    min: [-0.088, WRIST - 0.076, -0.05],
    max: [0.066, WRIST + 0.2, 0.04],
    voxel: 0.0023,
  });
}

// ---------------------------------------------------------------- the scooter

/**
 * The scooter: a torpedo-shaped body with a ring at the back around the propeller and a handle on either side.
 * +y is forward, +z up. The swimmer holds it out in front and looks along its back.
 */
function scooter(): BuiltMesh {
  const [hx, hy, hz] = HANDLE;
  const RING = 0.1; // radius of the ring round the propeller
  const shell = (x: number, y: number, z: number) => {
    const d = capsule(x, y, z, [0, -0.1, 0], [0, 0.2, 0], 0.088, 0.062);
    return melt(d, capsule(x, y, z, [0, 0.2, 0], [0, 0.275, 0], 0.062, 0.03), 0.03); // the nose
  };
  const gauge = (x: number, y: number, z: number) => roundBox(x, y, z, [0, 0.12, 0.066], [0.016, 0.022, 0.004], 0.004);
  const distance = (x: number, y: number, z: number) => {
    const ax = Math.abs(x);
    let d = shell(x, y, z);
    // a little raised panel on top for the battery gauge
    d = melt(d, gauge(x, y, z), 0.006);
    // the ring round the propeller (a short tube), on three struts
    let trim = band(x, y, z, PROPELLER_AT, RING, 0.032, 0.008);
    for (const angle of [-Math.PI / 2, -Math.PI / 2 + 2.094, -Math.PI / 2 - 2.094]) {
      const [cx, cz] = [Math.cos(angle), Math.sin(angle)];
      const strut = capsule(x, y, z, [cx * 0.07, -0.13, cz * 0.07], [cx * RING, PROPELLER_AT + 0.02, cz * RING], 0.01);
      trim = melt(trim, strut, 0.01);
    }
    // handles: an arm up and out from the body on each side, and a grip across its end
    trim = melt(trim, capsule(ax, y, z, [0.06, hy + 0.04, 0.03], [hx - 0.065, hy, hz], 0.016, 0.013), 0.012);
    trim = melt(trim, capsule(ax, y, z, [hx - 0.065, hy, hz], [hx + 0.06, hy, hz], 0.0155), 0.01);
    trim = Math.min(trim, capsule(ax, y, z, [hx + 0.06, hy, hz], [hx + 0.064, hy, hz], 0.021)); // the grip's end stop
    return melt(d, trim, 0.012);
  };
  return sculpt({
    distance,
    describe(x, y, z, out) {
      out[0] = out[1] = SCOOTER_BONE;
      out[2] = 1;
      // the lamp in the tip of the nose; the gauge's face; paint on the shell, but for a dark band where the
      // body comes apart; everything else is trim
      const painted = shell(x, y, z) < 0.0045 && Math.abs(y - 0.03) > 0.011;
      out[3] =
        y > 0.262
          ? MATERIAL.lamp
          : gauge(x, y, z) < 0.002 && z > 0.07
            ? MATERIAL.screen
            : painted
              ? MATERIAL.paint
              : MATERIAL.trim;
    },
    min: [-0.28, -0.25, -0.13],
    max: [0.28, 0.32, 0.13],
    voxel: 0.005,
  });
}

/** Three blades on a hub, turning about y. */
function propeller(): BuiltMesh {
  const distance = (x: number, y: number, z: number) => {
    let d = capsule(x, y, z, [0, -0.02, 0], [0, 0.03, 0], 0.024, 0.016);
    for (let blade = 0; blade < 3; blade++) {
      const angle = (blade * Math.PI * 2) / 3;
      const [c, s] = [Math.cos(angle), Math.sin(angle)];
      // into the blade's own frame: u along the blade, v across it, then twisted about u
      const u = x * c + z * s;
      const v = -x * s + z * c;
      const twist = 0.75;
      const p = v * Math.cos(twist) + y * Math.sin(twist);
      const q = -v * Math.sin(twist) + y * Math.cos(twist);
      d = melt(d, roundBox(u, q, p, [0.052, 0, 0], [0.032, 0.0012, 0.02], 0.003), 0.008);
    }
    return d;
  };
  return sculpt({
    distance,
    describe(_x, _y, _z, out) {
      out[0] = out[1] = PROPELLER_BONE;
      out[2] = 1;
      out[3] = MATERIAL.blades;
    },
    min: [-0.11, -0.05, -0.11],
    max: [0.11, 0.05, 0.11],
    voxel: 0.0034,
  });
}

export function buildBody(): BodyMeshes {
  const meshes = [sleeve(1), hand(1), sleeve(-1), hand(-1), scooter(), propeller()];
  const ranges: MeshRange[] = [];
  let vertexCount = 0;
  let indexCount = 0;
  for (const mesh of meshes) {
    ranges.push({
      firstVertex: vertexCount,
      firstIndex: indexCount,
      vertexCount: mesh.vertexCount,
      indexCount: mesh.indices.length,
    });
    vertexCount += mesh.vertexCount;
    indexCount += mesh.indices.length;
  }
  const vertices = new Uint8Array(vertexCount * BODY_VERTEX_BYTES);
  const indices = new Uint32Array(indexCount);
  meshes.forEach((mesh, i) => {
    vertices.set(new Uint8Array(mesh.vertices), ranges[i]!.firstVertex * BODY_VERTEX_BYTES);
    indices.set(mesh.indices, ranges[i]!.firstIndex);
  });
  return { vertices, indices, ranges };
}
