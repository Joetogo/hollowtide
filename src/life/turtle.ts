// A green sea turtle. Not in the original. Sculpted the way the swimmer's hands are (a distance function
// meshed with surface nets, see body/sculpt.ts), a metre from the front of the shell to the back of it.
// Model space: x to its right, y up, z the way it swims.
//
// Each vertex is told which limb moves it and how much, so that shaders/turtle.wgsl can row the flippers and
// turn the head without bones: limb 0 is the shell, which does not move.
import { capsule, melt, sculpt, smoothstep } from '../body/sculpt';
import { flyPoint } from '../camera/path';
import { Random } from '../math/random';
import type { CollisionField } from '../world/collision';
import { openWater } from '../world/jellies';

export const LIMB = { shell: 0, front: 1, rear: 2, head: 3 } as const;
/** Where a front flipper leaves the shell, and a rear one: what they turn about (x is mirrored for the left). */
export const SHOULDER = [0.26, -0.02, 0.31] as const;
export const HIP = [0.16, -0.03, -0.37] as const;
/** Where the neck leaves the shell. */
export const NECK = [0, -0.01, 0.42] as const;
/** How far out from the shoulder a front flipper reaches (the shader's measure of "towards the tip"). */
export const FLIPPER_REACH = 0.66;
/** An eye (x mirrored for the other): the shader paints it. */
export const EYE = [0.067, 0.026, 0.71] as const;
/** The shell's half width and half length (the shader draws the scutes with these). */
export const SHELL = [0.36, 0.48] as const;

export interface TurtleMesh {
  vertices: Uint8Array;
  indices: Uint32Array;
}

/** Distance to an ellipsoid with radii r about c, to first order (exact on the surface, good near it). */
function ellipsoid(x: number, y: number, z: number, c: readonly number[], r: readonly number[]): number {
  const [px, py, pz] = [x - c[0]!, y - c[1]!, z - c[2]!];
  const k0 = Math.hypot(px / r[0]!, py / r[1]!, pz / r[2]!);
  const k1 = Math.hypot(px / (r[0]! * r[0]!), py / (r[1]! * r[1]!), pz / (r[2]! * r[2]!));
  return k1 > 0 ? (k0 * (k0 - 1)) / k1 : -Math.min(r[0]!, r[1]!, r[2]!);
}

/** A flat blade: an ellipsoid lying in the xz plane, its long axis from a to b (x and z), `chord` and `thick` its other radii. */
function blade(
  x: number,
  y: number,
  z: number,
  a: readonly [number, number],
  b: readonly [number, number],
  height: number,
  chord: number,
  thick: number,
): number {
  const [dx, dz] = [b[0] - a[0], b[1] - a[1]];
  const length = Math.hypot(dx, dz);
  const [ux, uz] = [dx / length, dz / length];
  const [px, pz] = [x - (a[0] + b[0]) / 2, z - (a[1] + b[1]) / 2];
  return ellipsoid(px * ux + pz * uz, y, -px * uz + pz * ux, [0, height, 0], [length / 2, thick, chord]);
}

/** The shell is widest ahead of its middle and draws in towards the tail. */
const taper = (z: number) => (1 - 0.24 * smoothstep(0.05, -0.48, z)) * (1 - 0.1 * smoothstep(0.15, 0.48, z));

function shell(x: number, y: number, z: number): number {
  const sx = x / taper(z);
  // the carapace: a low dome with a faint ridge down its middle; and the plastron under it, set in from its edge
  const dome =
    ellipsoid(sx, y, z, [0, -0.035, 0], [SHELL[0], 0.185, SHELL[1]]) - 0.006 * smoothstep(0.06, 0, Math.abs(x));
  const top = Math.max(dome, -0.035 - y); // only what is above the rim
  const under = ellipsoid(sx, y, z, [0, -0.03, 0], [0.325, 0.085, 0.44]);
  return melt(top, under, 0.012);
}

function front(ax: number, y: number, z: number): number {
  // an arm out and forward from the shoulder, then the long blade swept back from the elbow
  const arm = blade(ax, y, z, [0.2, 0.3], [0.5, 0.385], -0.02, 0.062, 0.03);
  const paddle = blade(ax, y, z, [0.42, 0.4], [0.93, 0.02], -0.02, 0.098, 0.019);
  return melt(arm, paddle, 0.04);
}

const rear = (ax: number, y: number, z: number) => blade(ax, y, z, [0.13, -0.33], [0.33, -0.66], -0.03, 0.078, 0.017);

function head(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  let d = capsule(x, y, z, [0, -0.015, 0.34], [0, 0.002, 0.61], 0.07, 0.06); // the neck
  d = melt(d, ellipsoid(x, y, z, [0, 0.01, 0.675], [0.075, 0.069, 0.108]), 0.035);
  d = melt(d, ellipsoid(x, y, z, [0, -0.014, 0.757], [0.046, 0.041, 0.052]), 0.03); // the beak
  d = melt(d, ellipsoid(ax, y, z, [0.057, 0.03, 0.705], [0.017, 0.016, 0.022]), 0.008); // the brow over each eye
  return d;
}

const tail = (x: number, y: number, z: number) => capsule(x, y, z, [0, -0.035, -0.42], [0, -0.04, -0.57], 0.03, 0.008);

export function buildTurtle(): TurtleMesh {
  const mesh = sculpt({
    distance(x, y, z) {
      const ax = Math.abs(x);
      let d = shell(x, y, z);
      d = melt(d, front(ax, y, z), 0.02);
      d = melt(d, rear(ax, y, z), 0.02);
      d = melt(d, head(x, y, z), 0.025);
      return melt(d, tail(x, y, z), 0.02);
    },
    describe(x, y, z, out) {
      const ax = Math.abs(x);
      const parts = [shell(x, y, z), front(ax, y, z), rear(ax, y, z), head(x, y, z), tail(x, y, z)];
      let nearest = 0;
      for (let i = 1; i < parts.length; i++) if (parts[i]! < parts[nearest]!) nearest = i;
      out[0] = out[1] = out[2] = 0;
      if (nearest === 1) {
        out[0] = LIMB.front;
        out[2] = smoothstep(SHOULDER[0] - 0.03, SHOULDER[0] + 0.1, ax); // nothing at the root, all of it past the shoulder
      } else if (nearest === 2) {
        out[0] = LIMB.rear;
        out[2] = smoothstep(-HIP[2] - 0.02, -HIP[2] + 0.09, -z);
      } else if (nearest === 3) {
        out[0] = LIMB.head;
        out[2] = smoothstep(NECK[2] - 0.02, NECK[2] + 0.12, z);
      }
      out[3] = nearest === 0 ? 0 : 1; // shell, or skin
    },
    min: [-0.98, -0.16, -0.72],
    max: [0.98, 0.19, 0.84],
    voxel: 0.011,
  });
  return { vertices: new Uint8Array(mesh.vertices), indices: mesh.indices };
}

// ---------------------------------------------------------------- where they swim

/** Floats a turtle: the middle of its loop (x, y, z) and the loop's radius; a phase, radians a second (its sign
 * the way round), its size, a second phase. The same layout as the mantas'. */
export const TURTLE_FLOATS = 8;
/** The loop is this much narrower along z than along x, and rises and falls by this many metres twice a lap. */
export const LOOP_SQUASH = 0.8;
export const LOOP_RISE = 1.1;

/** Where a turtle is on its loop, for an angle round it (shaders/turtle.wgsl has the same line). */
export function loopPoint(turtle: ArrayLike<number>, angle: number, out: number[] = []): number[] {
  out[0] = turtle[0]! + turtle[3]! * Math.cos(angle);
  out[1] = turtle[1]! + LOOP_RISE * Math.sin(2 * angle + turtle[7]!);
  out[2] = turtle[2]! + turtle[3]! * LOOP_SQUASH * Math.sin(angle);
  return out;
}

/** Columns of kelp in squares of this many metres, for finding the ones near a point. */
const SQUARE = 6;
const square = (x: number, z: number) => Math.floor(x / SQUARE) * 4096 + Math.floor(z / SQUARE);

/** The kelp (x, foot y, z, height per column) sorted into squares. */
function kelpSquares(kelp: Float32Array): Map<number, number[]> {
  const squares = new Map<number, number[]>();
  for (let i = 0; i < kelp.length; i += 4) {
    const key = square(kelp[i]!, kelp[i + 2]!);
    let list = squares.get(key);
    if (!list) squares.set(key, (list = []));
    list.push(i);
  }
  return squares;
}

/** Does a column of kelp stand within `reach` metres of a point, at that point's depth? */
function inKelp(kelp: Float32Array, squares: Map<number, number[]>, x: number, y: number, z: number, reach: number) {
  for (let dx = -SQUARE; dx <= SQUARE; dx += SQUARE) {
    for (let dz = -SQUARE; dz <= SQUARE; dz += SQUARE) {
      for (const i of squares.get(square(x + dx, z + dz)) ?? []) {
        if (y < kelp[i + 1]! - 1 || y > kelp[i + 1]! + kelp[i + 3]! + 1.5) continue;
        if (Math.hypot(kelp[i]! - x, kelp[i + 2]! - z) < reach) return true;
      }
    }
  }
  return false;
}

/** Is there water for a turtle all the way round a loop: no rock, and no kelp to swim through? */
function clearLoop(
  field: CollisionField,
  kelp: Float32Array,
  squares: Map<number, number[]>,
  turtle: number[],
): boolean {
  const steps = Math.ceil((Math.PI * 2 * turtle[3]!) / 1.8);
  const point: number[] = [];
  for (let i = 0; i < steps; i++) {
    loopPoint(turtle, (i / steps) * Math.PI * 2, point);
    if (!openWater(field, point[0]!, point[1]!, point[2]!, 1.2, 0.8)) return false;
    if (inKelp(kelp, squares, point[0]!, point[1]!, point[2]!, KELP_BERTH)) return false;
  }
  return true;
}
/** How far a turtle keeps from a column of kelp, metres (the leaves reach out a metre or so from the stalk). */
const KELP_BERTH = 2.6;

/**
 * Up to three turtles, each on a loop of open water clear of the kelp (x, foot y, z, height per column): one by
 * the first viewpoint (eye, then what it looks at), so that it is met soon after waking, the others along the
 * tour's route.
 */
export function placeTurtles(
  viewpoints: readonly (readonly number[])[],
  field: CollisionField,
  kelp: Float32Array = new Float32Array(0),
): Float32Array {
  const random = new Random();
  random.reseed(401);
  const squares = kelpSquares(kelp);
  const out: number[] = [];
  const near = (x: number, y: number, z: number, spread: number) => {
    // the smaller the loop the easier it is to find room for, so big ones are tried first
    for (let attempt = 0; attempt < 240; attempt++) {
      const radius = random.range(4.5, 9) - 2 * (attempt / 240);
      const way = random.next() < 0.5 ? -1 : 1;
      const wide = spread * (1 + attempt / 120);
      const turtle = [
        x + random.range(-1, 1) * wide,
        y + random.range(-0.3, 1) * spread * 0.4,
        z + random.range(-1, 1) * wide,
        radius,
        random.next() * Math.PI * 2,
        (way * random.range(0.45, 0.62)) / radius, // about half a metre a second
        random.range(0.85, 1.15),
        random.next() * Math.PI * 2,
      ];
      if (!clearLoop(field, kelp, squares, turtle)) continue;
      out.push(...turtle);
      return;
    }
  };
  const first = viewpoints[0];
  if (first) {
    const [ex, ey, ez, tx, ty, tz] = first as [number, number, number, number, number, number];
    const ahead = 9 / (Math.hypot(tx - ex, ty - ey, tz - ez) || 1);
    near(ex + (tx - ex) * ahead, ey + (ty - ey) * ahead + 1, ez + (tz - ez) * ahead, 7);
  }
  const point = new Float64Array(6);
  for (const seconds of [21, 41]) {
    flyPoint(seconds, point);
    near(point[0]!, point[1]! + 1.5, point[2]!, 9);
  }
  return new Float32Array(out);
}
