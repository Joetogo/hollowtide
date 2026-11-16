import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildBody, GRIP, HANDLE, MATERIAL, PART } from '../../src/body/meshes';
import {
  createBodyParts,
  createBodyState,
  poseBody,
  stepBody,
  strokeGain,
  strokeRate,
  STROKE_SECONDS,
  type BodyState,
} from '../../src/body/rig';
import { BODY_VERTEX_BYTES, capsule, sculpt } from '../../src/body/sculpt';
import {
  ARM_BONES,
  BIND,
  BONE,
  BONES,
  createArmTarget,
  createPose,
  FOREARM,
  LEFT,
  poseArm,
  RIGHT,
  SCOOTER_BONE,
  UPPER_ARM,
  WRIST,
  writeSkin,
  LEG_LEFT,
  LEG_RIGHT,
  WAIST_BONE,
  ANKLE,
  KNEE,
  LEG,
  LEG_BIND,
} from '../../src/body/skeleton';
import { createCamera, lookAt } from '../../src/camera/camera';
import { createIntent, createSwimmer, SPEED, stepSwimmer, type Drive } from '../../src/camera/controls';

type V3 = [number, number, number];
/** Rotates a vector by the quaternion at `o` in `q`. */
function rotate(q: ArrayLike<number>, o: number, v: V3): V3 {
  const [x, y, z, w] = [q[o]!, q[o + 1]!, q[o + 2]!, q[o + 3]!];
  const cx = y * v[2] - z * v[1] + w * v[0];
  const cy = z * v[0] - x * v[2] + w * v[1];
  const cz = x * v[1] - y * v[0] + w * v[2];
  return [v[0] + 2 * (y * cz - z * cy), v[1] + 2 * (z * cx - x * cz), v[2] + 2 * (x * cy - y * cx)];
}
const at = (a: ArrayLike<number>, o: number): V3 => [a[o]!, a[o + 1]!, a[o + 2]!];
const distance = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const SHOULDER: V3 = [0.18, -0.27, 0.03];
const ELBOW: V3 = [0.5, -0.55, 0.36];

/** Poses the right arm (or, mirrored, the left) for a target and returns the pose. */
function arm(change: (t: ReturnType<typeof createArmTarget>) => void, side: 1 | -1 = 1) {
  const pose = createPose();
  const target = createArmTarget();
  target.wrist = [0.15 * side, -0.2, -0.4];
  change(target);
  poseArm(
    pose,
    side > 0 ? RIGHT : LEFT,
    side,
    target,
    SHOULDER[0] * side,
    SHOULDER[1],
    SHOULDER[2],
    ELBOW[0] * side,
    ELBOW[1],
    ELBOW[2],
  );
  return { pose, target, first: side > 0 ? RIGHT : LEFT };
}

/** A point turned by a quaternion (x, y, z, w). */
function turn(q: ArrayLike<number>, v: readonly number[]): [number, number, number] {
  const [qx, qy, qz, qw] = [q[0]!, q[1]!, q[2]!, q[3]!];
  const [vx, vy, vz] = [v[0]!, v[1]!, v[2]!];
  const cx = qy * vz - qz * vy + qw * vx;
  const cy = qz * vx - qx * vz + qw * vy;
  const cz = qx * vy - qy * vx + qw * vz;
  return [vx + 2 * (qy * cz - qz * cy), vy + 2 * (qz * cx - qx * cz), vz + 2 * (qx * cy - qy * cx)];
}

describe('the skeleton', () => {
  it('puts the wrist where it is asked to be, with both arm bones their full length', () => {
    const { pose, target } = arm(() => undefined);
    const p = pose.position;
    expect(distance(at(p, BONE.hand * 3), target.wrist)).toBeLessThan(1e-9);
    expect(distance(at(p, BONE.upper * 3), SHOULDER)).toBe(0);
    expect(distance(at(p, BONE.fore * 3), SHOULDER)).toBeCloseTo(UPPER_ARM, 9);
    expect(distance(at(p, BONE.fore * 3), target.wrist)).toBeCloseTo(FOREARM, 9);
    // the upper arm's bone really points at the elbow, and the forearm's at the wrist
    const upper = rotate(pose.rotation, BONE.upper * 4, [0, UPPER_ARM, 0]);
    expect(
      distance([SHOULDER[0] + upper[0], SHOULDER[1] + upper[1], SHOULDER[2] + upper[2]], at(p, BONE.fore * 3)),
    ).toBeLessThan(1e-9);
    for (const bone of [BONE.fore, BONE.twist]) {
      const fore = rotate(pose.rotation, bone * 4, [0, FOREARM, 0]);
      const e = at(p, bone * 3);
      expect(distance([e[0] + fore[0], e[1] + fore[1], e[2] + fore[2]], target.wrist)).toBeLessThan(1e-9);
    }
  });

  it('stops short of a wrist that is out of reach, with the arm all but straight', () => {
    const { pose } = arm((t) => (t.wrist = [0.2, -0.2, -3]));
    const reach = distance(at(pose.position, BONE.hand * 3), SHOULDER);
    expect(reach).toBeLessThan(UPPER_ARM + FOREARM);
    expect(reach).toBeGreaterThan((UPPER_ARM + FOREARM) * 0.99);
  });

  it('points the fingers and faces the palm as asked', () => {
    const { pose } = arm((t) => {
      t.fingers = [0.2, 0.3, -1];
      t.palm = [0.1, -1, 0];
    });
    const fingers = rotate(pose.rotation, BONE.hand * 4, [0, 1, 0]);
    const length = Math.hypot(0.2, 0.3, 1);
    expect(distance(fingers, [0.2 / length, 0.3 / length, -1 / length])).toBeLessThan(1e-9);
    const palm = rotate(pose.rotation, BONE.hand * 4, [0, 0, -1]);
    expect(palm[1]).toBeLessThan(-0.9);
    expect(palm[0] * fingers[0] + palm[1] * fingers[1] + palm[2] * fingers[2]).toBeCloseTo(0, 9); // square to the fingers
    // straight fingers lie along the hand
    const tip = rotate(pose.rotation, (BONE.finger + 3 + 2) * 4, [0, 1, 0]); // middle finger, last bone
    expect(tip[0] * fingers[0] + tip[1] * fingers[1] + tip[2] * fingers[2]).toBeGreaterThan(0.99);
  });

  it('bends a wrist no further than a wrist goes', () => {
    const { pose } = arm((t) => (t.fingers = [0, 0, 1])); // asked to point straight back
    const fingers = rotate(pose.rotation, BONE.hand * 4, [0, 1, 0]);
    const forearm = rotate(pose.rotation, BONE.twist * 4, [0, 1, 0]);
    const angle = Math.acos(fingers[0] * forearm[0] + fingers[1] * forearm[1] + fingers[2] * forearm[2]);
    expect(angle).toBeCloseTo(1.05, 6);
  });

  it('curls the fingers towards the palm, the fingertip coming in to the wrist as it goes', () => {
    let last = Infinity;
    for (const curl of [0, 0.4, 0.8, 1.2, 1.6]) {
      const { pose } = arm((t) => (t.curl = [curl, curl, curl, curl]));
      const tipBone = BONE.finger + 3 + 2;
      const along = rotate(pose.rotation, tipBone * 4, [0, 0.023, 0]);
      const start = at(pose.position, tipBone * 3);
      const tip: V3 = [start[0] + along[0], start[1] + along[1], start[2] + along[2]];
      const palm = rotate(pose.rotation, BONE.hand * 4, [0, 0, -1]);
      const wrist = at(pose.position, BONE.hand * 3);
      // never behind the back of the hand
      expect(
        (tip[0] - wrist[0]) * palm[0] + (tip[1] - wrist[1]) * palm[1] + (tip[2] - wrist[2]) * palm[2],
      ).toBeGreaterThan(-0.01);
      const d = distance(tip, wrist);
      expect(d).toBeLessThan(last);
      last = d;
    }
    expect(last).toBeLessThan(0.11); // a fist: the tip is back near the palm
  });

  it('makes the left arm the mirror image of the right', () => {
    const change = (side: number) => (t: ReturnType<typeof createArmTarget>) => {
      t.fingers = [0.3 * side, 0.2, -1];
      t.palm = [0.4 * side, -1, 0.2];
      t.curl = [0.3, 0.5, 0.7, 0.9];
      t.spread = 0.6;
      t.thumbUnder = 0.5;
      t.thumbBend = 0.7;
    };
    const right = arm(change(1), 1);
    const left = arm(change(-1), -1);
    for (let b = 0; b < ARM_BONES; b++) {
      const r = at(right.pose.position, b * 3);
      const l = at(left.pose.position, (LEFT + b) * 3);
      expect(distance([-r[0], r[1], r[2]], l)).toBeLessThan(1e-9);
      // and each bone carries a mirrored point of its bind shape to the mirrored place
      const pr = rotate(right.pose.rotation, b * 4, [0.01, 0.02, 0.005]);
      const pl = rotate(left.pose.rotation, (LEFT + b) * 4, [-0.01, 0.02, 0.005]);
      expect(distance([-pr[0], pr[1], pr[2]], pl)).toBeLessThan(1e-9);
    }
  });

  it('writes skinning data that carries each bone to where it is posed', () => {
    const { pose } = arm((t) => (t.curl = [0.5, 0.5, 0.5, 0.5]));
    const skin = new Float32Array(BONES * 8);
    writeSkin(pose, skin);
    for (let b = 0; b < ARM_BONES; b++) {
      const moved = rotate(skin, b * 4, at(BIND, b * 3));
      const t = at(skin, (BONES + b) * 4);
      expect(distance([moved[0] + t[0], moved[1] + t[1], moved[2] + t[2]], at(pose.position, b * 3))).toBeLessThan(
        1e-6,
      );
    }
  });
});

describe('the body in motion', () => {
  it('moves the hands smoothly through the whole stroke, the wrap from one stroke to the next included', () => {
    const parts = createBodyParts();
    const wristAt = (phase: number) => {
      const state = { ...createBodyState(), shown: 1, swim: 1, phase };
      poseBody(state, parts);
      return [...state.hands[0].wrist] as V3;
    };
    let last = wristAt(0.999);
    for (let phase = 0; phase < 1; phase += 0.002) {
      const now = wristAt(phase);
      expect(distance(now, last)).toBeLessThan(0.012); // 2 thousandths of a stroke: about a centimetre
      last = now;
    }
    expect(parts.skin.every(Number.isFinite)).toBe(true);
  });

  it('draws both arms, the scooter only once it is on its way up, and nothing when not shown', () => {
    const parts = createBodyParts();
    poseBody({ ...createBodyState(), shown: 1, swim: 1 }, parts);
    expect([...parts.mesh.slice(0, parts.count)]).toEqual([
      PART.sleeveRight,
      PART.handRight,
      PART.sleeveLeft,
      PART.handLeft,
    ]);
    poseBody({ ...createBodyState(), shown: 1, equip: 1 }, parts);
    expect([...parts.mesh.slice(0, parts.count)]).toContain(PART.scooter);
    expect([...parts.mesh.slice(0, parts.count)]).toContain(PART.propeller);
    poseBody({ ...createBodyState(), shown: 0 }, parts);
    expect(parts.count).toBe(0);
  });

  it('closes each hand round its handle of the scooter, even when the scooter leans', () => {
    for (const swayX of [0, 2, -2]) {
      const parts = createBodyParts();
      const state = { ...createBodyState(), shown: 1, equip: 1, swayX };
      poseBody(state, parts);
      const skin = parts.skin;
      for (const side of [1, -1]) {
        const first = side > 0 ? RIGHT : LEFT;
        // where the bar lies in the hand, carried by the hand bone: along the fingers, towards the palm
        const hold = rotate(skin, (first + BONE.hand) * 4, [0, WRIST + GRIP[0], -GRIP[1]]);
        const ht = at(skin, (BONES + first + BONE.hand) * 4);
        // the handle, carried by the scooter's bone
        const handle = rotate(skin, SCOOTER_BONE * 4, [HANDLE[0] * side, HANDLE[1], HANDLE[2]]);
        const st = at(skin, (BONES + SCOOTER_BONE) * 4);
        const gap = distance(
          [hold[0] + ht[0], hold[1] + ht[1], hold[2] + ht[2]],
          [handle[0] + st[0], handle[1] + st[1], handle[2] + st[2]],
        );
        expect(gap).toBeLessThan(0.02);
      }
    }
  });
});

describe('swimming with a body', () => {
  it('pushes as hard over the time of a stroke as the steady glide does', () => {
    // the stroke runs at different speeds through its phases, so the mean is taken over time, not phase
    let push = 0;
    let time = 0;
    for (let i = 0; i < 4000; i++) {
      const phase = (i + 0.5) / 4000;
      push += strokeGain(phase) / strokeRate(phase);
      time += 1 / strokeRate(phase);
    }
    expect(push / time).toBeCloseTo(1, 3);
    expect(strokeGain(0.1)).toBeLessThan(0.7); // the reach
    expect(strokeGain(0.51)).toBeGreaterThan(2); // the pull
    expect(strokeRate(0.7)).toBeGreaterThan(strokeRate(0.1) * 1.5); // quick through the part that is out of sight
  });

  const swim = (seconds: number, set: (intent: ReturnType<typeof createIntent>, t: number) => void) => {
    const camera = createCamera();
    lookAt(camera, 0, -30, 0, 0, -30, -10);
    const swimmer = createSwimmer();
    const intent = createIntent();
    const body = createBodyState();
    const drive: Drive = { gain: 1, jet: false };
    const speeds: number[] = [];
    for (let i = 0; i < seconds * 60; i++) {
      set(intent, i / 60);
      stepBody(body, intent, true, 1 / 60, drive);
      stepSwimmer(camera, swimmer, intent, null, 1 / 60, drive);
      speeds.push(Math.hypot(swimmer.vx, swimmer.vy, swimmer.vz));
    }
    return { camera, body, speeds, drive };
  };

  it('takes the time it says for a stroke', () => {
    const { body } = swim(STROKE_SECONDS * 5 + 0.3, (i) => (i.forward = 1));
    // started at the catch, so five strokes later it is a little way past the catch again
    expect(body.strokes).toBe(5);
  });

  it('covers about the same ground as the glide, in surges', () => {
    const { camera, speeds } = swim(13, (i) => (i.forward = 1));
    const metres = -camera.z;
    expect(metres).toBeGreaterThan(SPEED * 13 * 0.85);
    expect(metres).toBeLessThan(SPEED * 13 * 1.15);
    const steady = speeds.slice(120);
    expect(Math.max(...steady)).toBeGreaterThan(SPEED * 1.25);
    expect(Math.min(...steady)).toBeLessThan(SPEED * 0.85);
    expect(Math.min(...steady)).toBeGreaterThan(SPEED * 0.4); // never to a standstill
  });

  it('finishes a pull that has begun when forward is let go, then lowers the arms', () => {
    // let go a quarter of a second in: the first pull is under way
    const during = swim(0.5, (i, t) => (i.forward = t < 0.25 ? 1 : 0));
    expect(during.body.phase).toBeGreaterThan(0.5); // still finishing it
    const { body } = swim(3.5, (i, t) => (i.forward = t < 0.25 ? 1 : 0));
    expect(body.phase).toBe(0);
    expect(body.swim).toBe(0);
  });

  it('nods the view on the pull and leaves it alone at rest', () => {
    const moving = swim(4, (i) => (i.forward = 1));
    const still = swim(4, () => undefined);
    expect(still.body.nod).toBe(0);
    expect(still.body.heave).toBe(0);
    let lowest = 0;
    const body = createBodyState();
    const intent = createIntent();
    intent.forward = 1;
    const drive: Drive = { gain: 1, jet: false };
    for (let i = 0; i < 240; i++) {
      stepBody(body, intent, true, 1 / 60, drive);
      lowest = Math.min(lowest, body.nod);
    }
    expect(lowest).toBeLessThan(-0.005);
    expect(lowest).toBeGreaterThan(-0.03); // a nod, not a lurch
    expect(Number.isFinite(moving.body.heave)).toBe(true);
  });

  it('brings the scooter up before it pulls, then goes at full speed wherever the view points', () => {
    const early = swim(0.3, (i) => (i.fast = true));
    expect(early.drive.jet).toBe(false);
    expect(early.body.equip).toBeGreaterThan(0);
    const { speeds, body, camera } = swim(4, (i) => (i.fast = true));
    expect(body.equip).toBe(1);
    expect(speeds.at(-1)).toBeGreaterThan(25);
    expect(camera.z).toBeLessThan(-60);
    expect(body.spin).toBeGreaterThan(0);
  });
});

describe('sculpting', () => {
  it('meshes a capsule close to its true surface, facing outwards, with what it is told about each vertex', () => {
    const mesh = sculpt({
      distance: (x, y, z) => capsule(x, y, z, [0, 0, 0], [0, 0.2, 0], 0.05),
      describe(_x, y, _z, out) {
        out[0] = 3;
        out[1] = 7;
        out[2] = y > 0.1 ? 1 : 0.25;
        out[3] = 5;
      },
      min: [-0.07, -0.07, -0.07],
      max: [0.07, 0.27, 0.07],
      voxel: 0.005,
    });
    const view = new DataView(mesh.vertices);
    expect(mesh.vertexCount).toBeGreaterThan(1000);
    expect(mesh.vertices.byteLength).toBe(mesh.vertexCount * BODY_VERTEX_BYTES);
    for (let k = 0; k < mesh.vertexCount; k++) {
      const o = k * BODY_VERTEX_BYTES;
      const [x, y, z] = [view.getFloat32(o, true), view.getFloat32(o + 4, true), view.getFloat32(o + 8, true)];
      expect(Math.abs(capsule(x, y, z, [0, 0, 0], [0, 0.2, 0], 0.05))).toBeLessThan(0.004);
      // the normal points away from the axis
      const outward =
        view.getInt8(o + 12) * x +
        view.getInt8(o + 14) * z +
        view.getInt8(o + 13) * (y < 0 ? y : y > 0.2 ? y - 0.2 : 0);
      expect(outward).toBeGreaterThan(0);
      expect(view.getInt8(o + 15)).toBeGreaterThan(110); // a convex shape blocks none of its own light
      expect([view.getUint8(o + 16), view.getUint8(o + 17), view.getUint8(o + 19)]).toEqual([3, 7, 5]);
      expect(view.getUint8(o + 18)).toBe(y > 0.1 ? 255 : 64);
    }
    expect(mesh.indices.length % 6).toBe(0);
  });

  it('builds the body: every vertex tied to bones that exist, the creases between fingers shaded', () => {
    const body = buildBody();
    expect(body.ranges.length).toBe(9);
    const view = new DataView(body.vertices.buffer);
    const materials = new Set<number>();
    for (const [part, range] of body.ranges.entries()) {
      expect(range.vertexCount).toBeGreaterThan(500);
      const left = part === PART.sleeveLeft || part === PART.handLeft;
      const gear = part === PART.scooter || part === PART.propeller;
      // the legs and the waist have their own bones, after the gear's
      const below: [number, number] | null =
        part === PART.legRight
          ? [LEG_RIGHT, LEG_LEFT]
          : part === PART.legLeft
            ? [LEG_LEFT, WAIST_BONE]
            : part === PART.waist
              ? [WAIST_BONE, BONES]
              : null;
      let darkest = 127;
      for (let k = range.firstVertex; k < range.firstVertex + range.vertexCount; k++) {
        const o = k * BODY_VERTEX_BYTES;
        for (const bone of [view.getUint8(o + 16), view.getUint8(o + 17)]) {
          expect(bone).toBeLessThan(BONES);
          // each arm's mesh is moved by that arm's bones only, the gear by its own, a leg by its own four
          expect(
            below
              ? bone >= below[0] && bone < below[1]
              : gear
                ? bone >= SCOOTER_BONE && bone < LEG_RIGHT
                : left
                  ? bone >= LEFT && bone < SCOOTER_BONE
                  : bone < LEFT,
          ).toBe(true);
        }
        materials.add(view.getUint8(o + 19));
        darkest = Math.min(darkest, view.getInt8(o + 15));
      }
      if (part === PART.handRight || part === PART.handLeft) expect(darkest).toBeLessThan(60);
    }
    expect([...materials].sort((a, b) => a - b)).toEqual(Object.values(MATERIAL));
  }, 60_000);

  it('the legs are there for a swimmer who hangs upright and looks down, and not otherwise', () => {
    const drawn = (state: Partial<BodyState>) => {
      const parts = createBodyParts();
      poseBody({ ...createBodyState(), shown: 1, ...state }, parts);
      return [...parts.mesh.slice(0, parts.count)];
    };
    const legs = [PART.waist, PART.legRight, PART.legLeft];
    // looking level, or up, or only a little down: they are below the picture
    for (const pitch of [0.5, 0, -0.4, -0.7]) for (const part of legs) expect(drawn({ pitch })).not.toContain(part);
    // looking well down
    for (const pitch of [-0.9, -1.2, -1.55]) for (const part of legs) expect(drawn({ pitch })).toContain(part);
    // swimming, the body lies along its way and the legs trail behind, wherever the swimmer looks
    for (const pitch of [0, -0.9, -1.2]) {
      for (const part of legs) expect(drawn({ pitch, lean: 1, swim: 1, phase: 0.2 })).not.toContain(part);
    }
    // and not while the body is still coming into the water
    for (const part of legs) expect(drawn({ pitch: -1.2, shown: 0.5 })).not.toContain(part);
  });

  it('the body lies along its way while swimming or riding, and comes upright again at rest', () => {
    const state = createBodyState();
    const drive = { gain: 1, jet: false };
    const intent = { forward: 0, right: 0, up: 0, fast: false, lookX: 0, lookY: 0, turnX: 0, turnY: 0 };
    const run = (seconds: number) => {
      for (let i = 0; i < seconds * 60; i++) stepBody(state, intent, true, 1 / 60, drive);
    };
    run(1);
    expect(state.lean).toBe(0);
    const kicked = state.kick;
    run(0.5);
    expect(state.kick).not.toBe(kicked); // the legs keep kicking slowly to stay upright
    intent.forward = 1;
    run(2);
    expect(state.lean).toBe(1);
    intent.forward = 0;
    run(4);
    expect(state.lean).toBe(0);
    intent.fast = true;
    run(2);
    expect(state.lean).toBe(1);
  });

  it('a leg is one chain from the hip, in front of and below the eye of whoever looks down it', () => {
    const parts = createBodyParts();
    for (const kick of [0, 1, 2, 3, 4, 5, 6]) {
      poseBody({ ...createBodyState(), shown: 1, pitch: -1.3, kick }, parts);
      const skin = parts.skin;
      for (const first of [LEG_RIGHT, LEG_LEFT]) {
        // where each bone has taken the point at which it begins in the bind pose
        const joint = (bone: number) => {
          const q = skin.subarray((first + bone) * 4, (first + bone) * 4 + 4);
          const t = skin.subarray((BONES + first + bone) * 4, (BONES + first + bone) * 4 + 3);
          const [x, y, z] = turn(q, LEG_BIND[bone]!);
          return [x + t[0]!, y + t[1]!, z + t[2]!] as const;
        };
        const [hip, knee, ankle, blade] = [joint(LEG.thigh), joint(LEG.shin), joint(LEG.foot), joint(LEG.blade)];
        // the bones keep their lengths: nothing stretches as the leg kicks
        expect(Math.hypot(knee[0] - hip[0], knee[1] - hip[1], knee[2] - hip[2])).toBeCloseTo(KNEE, 5);
        expect(Math.hypot(ankle[0] - knee[0], ankle[1] - knee[1], ankle[2] - knee[2])).toBeCloseTo(ANKLE - KNEE, 5);
        // in view space (x right, y up, z back): everything ahead of the eye, the knee nearer the middle of
        // the picture than the hip, the right leg on the right
        for (const point of [hip, knee, ankle, blade]) expect(point[2]).toBeLessThan(-0.3);
        expect(Math.atan2(-knee[1], -knee[2])).toBeLessThan(Math.atan2(-hip[1], -hip[2]));
        expect(Math.sign(knee[0])).toBe(first === LEG_RIGHT ? 1 : -1);
      }
    }
  });

  it('the kick moves the legs smoothly, one forward as the other goes back', () => {
    const parts = createBodyParts();
    const kneeAhead = (kick: number, first: number) => {
      poseBody({ ...createBodyState(), shown: 1, pitch: -1.3, kick }, parts);
      const q = parts.skin.subarray((first + LEG.shin) * 4, (first + LEG.shin) * 4 + 4);
      const t = parts.skin.subarray((BONES + first + LEG.shin) * 4, (BONES + first + LEG.shin) * 4 + 3);
      return -(turn(q, LEG_BIND[LEG.shin])[2] + t[2]!);
    };
    let [last, biggest] = [kneeAhead(0, LEG_RIGHT), 0];
    let opposed = 0;
    for (let i = 1; i <= 628; i++) {
      const [right, left] = [kneeAhead(i / 100, LEG_RIGHT), kneeAhead(i / 100, LEG_LEFT)];
      biggest = Math.max(biggest, Math.abs(right - last));
      last = right;
      if (Math.abs(right - left) > 0.02) opposed++;
    }
    expect(biggest).toBeLessThan(0.003); // metres for a hundredth of a radian of the kick's clock
    expect(opposed).toBeGreaterThan(400);
  });

  it('agrees with the shader about the skeleton', () => {
    const shader = readFileSync(new URL('../../src/shaders/body.wgsl', import.meta.url), 'utf8');
    expect(Number(/const BONES = (\d+);/.exec(shader)?.[1])).toBe(BONES);
    expect(Number(/const ELBOW = ([\d.]+);/.exec(shader)?.[1])).toBeCloseTo(UPPER_ARM, 9);
    expect(Number(/const WRIST = ([\d.]+);/.exec(shader)?.[1])).toBeCloseTo(WRIST, 9);
    for (const [name, id] of Object.entries(MATERIAL))
      expect(shader).toMatch(new RegExp(`const ${name.toUpperCase()} = ${id};`));
  });
});
