// The swimmer's skeleton: two arms of nineteen bones each (upper arm, a forearm in two parts so that it can
// twist, hand, three bones a finger, three for the thumb), plus one bone each for the scooter and its propeller.
//
// The bind pose is the pose the meshes are sculpted in (src/body/meshes.ts): a right arm stretched out along +y
// from the shoulder at the origin, palm facing -z, thumb on the -x side, fingers a little fanned. The left arm
// is its mirror image in x.

/** Bone lengths, metres. */
export const UPPER_ARM = 0.29;
export const FOREARM = 0.26;
/** The wrist in the bind pose, along y from the shoulder. */
export const WRIST = UPPER_ARM + FOREARM;

export const ARM_BONES = 19;
/** Bones of an arm, counted from the arm's first bone. Fingers: index, middle, ring, little; three bones each. */
export const BONE = {
  upper: 0,
  fore: 1, // the elbow end of the forearm
  twist: 2, // the wrist end of the forearm (for now the two turn together, with the hand)
  hand: 3,
  finger: 4, // + 3 * finger + joint
  thumb: 16, // + joint
} as const;
/** The first bone of the right and of the left arm, and the gear's bones. */
export const RIGHT = 0;
export const LEFT = ARM_BONES;
export const SCOOTER_BONE = ARM_BONES * 2;
export const PROPELLER_BONE = ARM_BONES * 2 + 1;
export const BONES = ARM_BONES * 2 + 2;

/**
 * The four fingers of the right hand in the bind pose: where the knuckle is (from the wrist), which way the
 * finger points as an angle in the plane of the palm (radians, positive towards the thumb), the lengths of its
 * three bones, and its radius at the knuckle and at the tip.
 */
export const FINGERS = [
  { knuckle: [-0.0305, 0.091, 0.001], fan: 0.11, bones: [0.043, 0.026, 0.022], radius: [0.0102, 0.0074] },
  { knuckle: [-0.0102, 0.097, 0.002], fan: 0.03, bones: [0.047, 0.03, 0.023], radius: [0.0104, 0.0075] },
  { knuckle: [0.0102, 0.093, 0.001], fan: -0.06, bones: [0.043, 0.028, 0.022], radius: [0.0099, 0.0072] },
  { knuckle: [0.0292, 0.083, -0.001], fan: -0.16, bones: [0.034, 0.021, 0.02], radius: [0.0088, 0.0065] },
] as const;
/** The thumb likewise: its root, the way it points, bone lengths, radii. */
export const THUMB = {
  root: [-0.027, 0.03, -0.01],
  direction: [-0.72, 0.66, -0.21],
  bones: [0.04, 0.031, 0.027],
  radius: [0.0135, 0.0088],
} as const;

const normalised = (v: readonly number[]): [number, number, number] => {
  const length = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / length, v[1]! / length, v[2]! / length];
};
/** The way a finger of the right hand points in the bind pose. */
export const fingerDirection = (finger: number): [number, number, number] => [
  -Math.sin(FINGERS[finger]!.fan),
  Math.cos(FINGERS[finger]!.fan),
  0,
];
export const THUMB_DIRECTION = normalised(THUMB.direction);

/**
 * Where each bone of the right arm begins in the bind pose: x, y, z per bone. (Mirror x for the left arm.)
 * A bone's own shape runs from here to where the next bone of its chain begins.
 */
export const BIND = new Float64Array(ARM_BONES * 3);
{
  const put = (bone: number, x: number, y: number, z: number) => BIND.set([x, y, z], bone * 3);
  put(BONE.upper, 0, 0, 0);
  put(BONE.fore, 0, UPPER_ARM, 0);
  put(BONE.twist, 0, UPPER_ARM, 0);
  put(BONE.hand, 0, WRIST, 0);
  FINGERS.forEach(({ knuckle, bones }, f) => {
    const d = fingerDirection(f);
    let along = 0;
    for (let j = 0; j < 3; j++) {
      put(BONE.finger + f * 3 + j, knuckle[0] + d[0] * along, WRIST + knuckle[1] + d[1] * along, knuckle[2]);
      along += bones[j]!;
    }
  });
  let along = 0;
  for (let j = 0; j < 3; j++) {
    put(
      BONE.thumb + j,
      THUMB.root[0] + THUMB_DIRECTION[0] * along,
      WRIST + THUMB.root[1] + THUMB_DIRECTION[1] * along,
      THUMB.root[2] + THUMB_DIRECTION[2] * along,
    );
    along += THUMB.bones[j]!;
  }
}

/**
 * A pose: for every bone, the rotation that takes its bind-pose shape to where it is now (a quaternion), and
 * where the bone begins now. Both in view space: metres from the eye, x right, y up, z back.
 */
export interface Pose {
  rotation: Float64Array; // 4 per bone
  position: Float64Array; // 3 per bone
}
export const createPose = (): Pose => {
  const pose = { rotation: new Float64Array(BONES * 4), position: new Float64Array(BONES * 3) };
  for (let b = 0; b < BONES; b++) pose.rotation[b * 4 + 3] = 1;
  return pose;
};

/** What the hand of one arm is to do: everything the pose of an arm follows from. */
export interface ArmTarget {
  /** where the wrist is to be */
  wrist: [number, number, number];
  /** which way the fingers point, and which way the palm faces (need not be unit or exactly at right angles) */
  fingers: [number, number, number];
  palm: [number, number, number];
  /** how far each finger is curled, 0 (straight) to about 1.6 (a fist): index, middle, ring, little */
  curl: [number, number, number, number];
  /** how far the fingers are spread apart, -1 (pressed together) to 1 (splayed) */
  spread: number;
  /** the thumb: how far it is swung under the palm, and how far it is bent, each 0..1 */
  thumbUnder: number;
  thumbBend: number;
}
export const createArmTarget = (): ArmTarget => ({
  wrist: [0, 0, 0],
  fingers: [0, 0, -1],
  palm: [0, -1, 0],
  curl: [0, 0, 0, 0],
  spread: 0,
  thumbUnder: 0,
  thumbBend: 0,
});

// ---- quaternion arithmetic without allocation: results land in these registers
let rx = 0;
let ry = 0;
let rz = 0;
let rw = 1;
/** a times b: the rotation b followed by the rotation a. */
function multiply(ax: number, ay: number, az: number, aw: number, bx: number, by: number, bz: number, bw: number) {
  rx = aw * bx + ax * bw + ay * bz - az * by;
  ry = aw * by - ax * bz + ay * bw + az * bx;
  rz = aw * bz + ax * by - ay * bx + az * bw;
  rw = aw * bw - ax * bx - ay * by - az * bz;
}
/** The rotation that takes +y to (yx, yy, yz) and +z to (zx, zy, zz): two unit vectors at right angles. */
function fromAxes(yx: number, yy: number, yz: number, zx: number, zy: number, zz: number) {
  const xx = yy * zz - yz * zy;
  const xy = yz * zx - yx * zz;
  const xz = yx * zy - yy * zx;
  const trace = xx + yy + zz;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    rw = s / 4;
    rx = (yz - zy) / s;
    ry = (zx - xz) / s;
    rz = (xy - yx) / s;
  } else if (xx > yy && xx > zz) {
    const s = Math.sqrt(1 + xx - yy - zz) * 2;
    rw = (yz - zy) / s;
    rx = s / 4;
    ry = (yx + xy) / s;
    rz = (zx + xz) / s;
  } else if (yy > zz) {
    const s = Math.sqrt(1 + yy - xx - zz) * 2;
    rw = (zx - xz) / s;
    rx = (yx + xy) / s;
    ry = s / 4;
    rz = (zy + yz) / s;
  } else {
    const s = Math.sqrt(1 + zz - xx - yy) * 2;
    rw = (xy - yx) / s;
    rx = (zx + xz) / s;
    ry = (zy + yz) / s;
    rz = s / 4;
  }
}
/** Rotates a vector by a quaternion; the result is in rx, ry, rz. */
function rotate(qx: number, qy: number, qz: number, qw: number, vx: number, vy: number, vz: number) {
  const cx = qy * vz - qz * vy + qw * vx;
  const cy = qz * vx - qx * vz + qw * vy;
  const cz = qx * vy - qy * vx + qw * vz;
  rx = vx + 2 * (qy * cz - qz * cy);
  ry = vy + 2 * (qz * cx - qx * cz);
  rz = vz + 2 * (qx * cy - qy * cx);
}

/** Sets a bone's rotation to its parent's followed by a turn of `angle` about an axis given in the bind pose. */
function bend(pose: Pose, bone: number, parent: number, ax: number, ay: number, az: number, angle: number) {
  const q = pose.rotation;
  const s = Math.sin(angle / 2);
  multiply(
    q[parent * 4]!,
    q[parent * 4 + 1]!,
    q[parent * 4 + 2]!,
    q[parent * 4 + 3]!,
    ax * s,
    ay * s,
    az * s,
    Math.cos(angle / 2),
  );
  q[bone * 4] = rx;
  q[bone * 4 + 1] = ry;
  q[bone * 4 + 2] = rz;
  q[bone * 4 + 3] = rw;
}
/** Puts a bone where its parent, as posed, carries the point (x, y, z) of the parent's bind-pose shape (given from the parent's beginning). */
function attach(pose: Pose, bone: number, parent: number, x: number, y: number, z: number) {
  const q = pose.rotation;
  const p = pose.position;
  rotate(q[parent * 4]!, q[parent * 4 + 1]!, q[parent * 4 + 2]!, q[parent * 4 + 3]!, x, y, z);
  p[bone * 3] = p[parent * 3]! + rx;
  p[bone * 3 + 1] = p[parent * 3 + 1]! + ry;
  p[bone * 3 + 2] = p[parent * 3 + 2]! + rz;
}
function setBone(pose: Pose, bone: number, px: number, py: number, pz: number) {
  pose.rotation[bone * 4] = rx;
  pose.rotation[bone * 4 + 1] = ry;
  pose.rotation[bone * 4 + 2] = rz;
  pose.rotation[bone * 4 + 3] = rw;
  pose.position[bone * 3] = px;
  pose.position[bone * 3 + 1] = py;
  pose.position[bone * 3 + 2] = pz;
}

/** How far the hand may be bent at the wrist, from the line of the forearm. */
const WRIST_LIMIT = Math.cos(1.05);
/** How much of a finger's curl each of its three joints takes. */
const CURL = [0.85, 1.1, 0.7] as const;

/**
 * Poses one arm so that its hand does what `target` says. `first` is the arm's first bone (RIGHT or LEFT),
 * `side` 1 for the right arm and -1 for the left; the shoulder and the way the elbow tends to point are given
 * in view space.
 */
export function poseArm(
  pose: Pose,
  first: number,
  side: 1 | -1,
  target: ArmTarget,
  shoulderX: number,
  shoulderY: number,
  shoulderZ: number,
  elbowX: number,
  elbowY: number,
  elbowZ: number,
): void {
  // ---- shoulder to wrist: two bones and a bent elbow
  let dx = target.wrist[0] - shoulderX;
  let dy = target.wrist[1] - shoulderY;
  let dz = target.wrist[2] - shoulderZ;
  let d = Math.hypot(dx, dy, dz) || 1e-6;
  dx /= d;
  dy /= d;
  dz /= d;
  // within reach: never quite straight, never folded flat
  d = Math.min(Math.max(d, Math.abs(UPPER_ARM - FOREARM) + 0.03), (UPPER_ARM + FOREARM) * 0.996);
  const along = (UPPER_ARM * UPPER_ARM - FOREARM * FOREARM + d * d) / (2 * d);
  const out = Math.sqrt(Math.max(UPPER_ARM * UPPER_ARM - along * along, 0));
  // the elbow lies on a circle about the line from shoulder to wrist: the point of it furthest the way elbows go
  let ex = elbowX;
  let ey = elbowY;
  let ez = elbowZ;
  const e = ex * dx + ey * dy + ez * dz;
  ex -= dx * e;
  ey -= dy * e;
  ez -= dz * e;
  const el = Math.hypot(ex, ey, ez) || 1;
  ex /= el;
  ey /= el;
  ez /= el;
  const elbowPx = shoulderX + dx * along + ex * out;
  const elbowPy = shoulderY + dy * along + ey * out;
  const elbowPz = shoulderZ + dz * along + ez * out;
  const wristX = shoulderX + dx * d;
  const wristY = shoulderY + dy * d;
  const wristZ = shoulderZ + dz * d;
  // the two bones' directions
  const ux = (elbowPx - shoulderX) / UPPER_ARM;
  const uy = (elbowPy - shoulderY) / UPPER_ARM;
  const uz = (elbowPz - shoulderZ) / UPPER_ARM;
  const fx = (wristX - elbowPx) / FOREARM;
  const fy = (wristY - elbowPy) / FOREARM;
  const fz = (wristZ - elbowPz) / FOREARM;

  // ---- the hand: fingers and palm as asked, but no further from the forearm's line than a wrist bends
  let hx = target.fingers[0];
  let hy = target.fingers[1];
  let hz = target.fingers[2];
  let hl = Math.hypot(hx, hy, hz) || 1;
  hx /= hl;
  hy /= hl;
  hz /= hl;
  const c = hx * fx + hy * fy + hz * fz;
  if (c < WRIST_LIMIT) {
    // swing it back towards the forearm, in the plane of the two
    let px = hx - fx * c;
    let py = hy - fy * c;
    let pz = hz - fz * c;
    const pl = Math.hypot(px, py, pz);
    if (pl < 1e-6) {
      px = ex;
      py = ey;
      pz = ez;
    } else {
      px /= pl;
      py /= pl;
      pz /= pl;
    }
    const s = Math.sqrt(1 - WRIST_LIMIT * WRIST_LIMIT);
    hx = fx * WRIST_LIMIT + px * s;
    hy = fy * WRIST_LIMIT + py * s;
    hz = fz * WRIST_LIMIT + pz * s;
  }
  // the palm's direction, made square to the fingers; the hand's own +z is the back of the hand
  let nx = target.palm[0];
  let ny = target.palm[1];
  let nz = target.palm[2];
  const n = nx * hx + ny * hy + nz * hz;
  nx -= hx * n;
  ny -= hy * n;
  nz -= hz * n;
  hl = Math.hypot(nx, ny, nz);
  if (hl < 1e-6) {
    // the palm was asked to face along the fingers: any way square to them will have to do
    nx = hy;
    ny = -hx;
    nz = 0;
    hl = Math.hypot(nx, ny, nz) || 1;
  }
  nx /= hl;
  ny /= hl;
  nz /= hl;

  // ---- how the arm is turned about its own length. The forearm turns with the hand: its +z is the back of
  // the hand, made square to the forearm. (A wrist does not bend far enough for the two to line up.)
  let bx = -nx + fx * (nx * fx + ny * fy + nz * fz);
  let by = -ny + fy * (nx * fx + ny * fy + nz * fz);
  let bz = -nz + fz * (nx * fx + ny * fy + nz * fz);
  const bl = Math.hypot(bx, by, bz) || 1;
  bx /= bl;
  by /= bl;
  bz /= bl;
  fromAxes(fx, fy, fz, bx, by, bz);
  setBone(pose, first + BONE.fore, elbowPx, elbowPy, elbowPz);
  setBone(pose, first + BONE.twist, elbowPx, elbowPy, elbowPz);
  // The upper arm carries that turn on round the elbow by the shortest way: the rotation that swings the
  // forearm's direction onto the upper arm's, applied to the forearm's +z. Nothing here can jump (an arm is
  // never folded quite flat), which a turn measured from the plane of the bend would whenever the elbow
  // crossed from one side to the other; and the shoulder, which has to take up the difference, is out of sight.
  const c2 = fx * ux + fy * uy + fz * uz;
  const wx = fy * uz - fz * uy;
  const wy = fz * ux - fx * uz;
  const wz = fx * uy - fy * ux;
  const k = (wx * bx + wy * by + wz * bz) / (1 + c2);
  const uzx = bx * c2 + (wy * bz - wz * by) + wx * k;
  const uzy = by * c2 + (wz * bx - wx * bz) + wy * k;
  const uzz = bz * c2 + (wx * by - wy * bx) + wz * k;
  fromAxes(ux, uy, uz, uzx, uzy, uzz);
  setBone(pose, first + BONE.upper, shoulderX, shoulderY, shoulderZ);
  fromAxes(hx, hy, hz, -nx, -ny, -nz);
  setBone(pose, first + BONE.hand, wristX, wristY, wristZ);

  // ---- fingers: each bends at three joints about its own axis, and fans at the knuckle
  const hand = first + BONE.hand;
  for (let f = 0; f < 4; f++) {
    const { knuckle, fan, bones } = FINGERS[f]!;
    // the way it points in the bind pose, and the axis that curls it towards the palm
    const ex0 = -Math.sin(fan) * side;
    const ey0 = Math.cos(fan);
    const curlX = -ey0;
    const curlY = ex0;
    const curl = target.curl[f]!;
    const bone = first + BONE.finger + f * 3;
    // fanned out from (or in towards) the middle of the hand: the outer fingers move most
    const spread = target.spread * (f - 1.3) * -0.11 * side;
    bend(pose, bone, hand, 0, 0, 1, spread);
    bend(pose, bone, bone, curlX, curlY, 0, curl * CURL[0]);
    attach(pose, bone, hand, knuckle[0] * side, knuckle[1], knuckle[2]);
    bend(pose, bone + 1, bone, curlX, curlY, 0, curl * CURL[1]);
    attach(pose, bone + 1, bone, ex0 * bones[0], ey0 * bones[0], 0);
    bend(pose, bone + 2, bone + 1, curlX, curlY, 0, curl * CURL[2]);
    attach(pose, bone + 2, bone + 1, ex0 * bones[1], ey0 * bones[1], 0);
  }
  // ---- the thumb: swung under the palm about the hand's length, and bent along its own
  const tx = THUMB_DIRECTION[0] * side;
  const ty = THUMB_DIRECTION[1];
  const tz = THUMB_DIRECTION[2];
  const tl = Math.hypot(ty, tx);
  const bendX = -ty / tl;
  const bendY = tx / tl;
  const thumb = first + BONE.thumb;
  // (and laid in against the first finger when the fingers are pressed together)
  bend(pose, thumb, hand, 0, 0, 1, Math.min(target.spread, 0) * 0.62 * side);
  bend(pose, thumb, thumb, 0, 1, 0, -target.thumbUnder * 0.95 * side);
  bend(pose, thumb, thumb, bendX, bendY, 0, target.thumbBend * 0.45);
  attach(pose, thumb, hand, THUMB.root[0] * side, THUMB.root[1], THUMB.root[2]);
  bend(pose, thumb + 1, thumb, bendX, bendY, 0, target.thumbBend * 0.75);
  attach(pose, thumb + 1, thumb, tx * THUMB.bones[0], ty * THUMB.bones[0], tz * THUMB.bones[0]);
  bend(pose, thumb + 2, thumb + 1, bendX, bendY, 0, target.thumbBend * 0.9);
  attach(pose, thumb + 2, thumb + 1, tx * THUMB.bones[1], ty * THUMB.bones[1], tz * THUMB.bones[1]);
}

/** Poses a rigid bone: its shape's +y to `forward` and +z to `up` (unit, at right angles), its origin at a point. */
export function poseRigid(
  pose: Pose,
  bone: number,
  x: number,
  y: number,
  z: number,
  forwardX: number,
  forwardY: number,
  forwardZ: number,
  upX: number,
  upY: number,
  upZ: number,
): void {
  fromAxes(forwardX, forwardY, forwardZ, upX, upY, upZ);
  setBone(pose, bone, x, y, z);
}

/**
 * What the shader needs to move a vertex with a bone: per bone a quaternion q and an offset t, such that a
 * bind-pose point v goes to rotate(q, v) + t. Written as 4 floats each: all the q, then all the t.
 */
export function writeSkin(pose: Pose, out: Float32Array): void {
  const q = pose.rotation;
  const p = pose.position;
  for (let b = 0; b < BONES; b++) {
    const arm = b < ARM_BONES * 2;
    const k = arm ? (b % ARM_BONES) * 3 : 0;
    // where the bone begins in the bind pose (the left arm is the right arm's mirror image; gear begins at 0)
    const bindX = arm ? BIND[k]! * (b < ARM_BONES ? 1 : -1) : 0;
    const bindY = arm ? BIND[k + 1]! : 0;
    const bindZ = arm ? BIND[k + 2]! : 0;
    rotate(q[b * 4]!, q[b * 4 + 1]!, q[b * 4 + 2]!, q[b * 4 + 3]!, bindX, bindY, bindZ);
    out[b * 4] = q[b * 4]!;
    out[b * 4 + 1] = q[b * 4 + 1]!;
    out[b * 4 + 2] = q[b * 4 + 2]!;
    out[b * 4 + 3] = q[b * 4 + 3]!;
    const t = (BONES + b) * 4;
    out[t] = p[b * 3]! - rx;
    out[t + 1] = p[b * 3 + 1]! - ry;
    out[t + 2] = p[b * 3 + 2]! - rz;
    out[t + 3] = 0;
  }
}
