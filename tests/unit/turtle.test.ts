import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BODY_VERTEX_BYTES } from '../../src/body/sculpt';
import {
  buildTurtle,
  EYE,
  FLIPPER_REACH,
  HIP,
  LIMB,
  LOOP_RISE,
  LOOP_SQUASH,
  loopPoint,
  NECK,
  placeTurtles,
  SHELL,
  SHOULDER,
  TURTLE_FLOATS,
} from '../../src/life/turtle';
import { ALL_ROCK, COLLISION_BRICKS, COLLISION_OFFSET, type CollisionField } from '../../src/world/collision';
import { NY, ORIGIN_X, VOXEL } from '../../src/world/grid';

function field(rock: (x: number, y: number, z: number) => boolean = () => false): CollisionField {
  const index = new Uint16Array(COLLISION_BRICKS * (NY / 4) * COLLISION_BRICKS);
  for (let z = 0; z < COLLISION_BRICKS; z++)
    for (let y = 0; y < NY / 4; y++)
      for (let x = 0; x < COLLISION_BRICKS; x++)
        if (rock(x, y, z)) index[x + COLLISION_BRICKS * (y + (NY / 4) * z)] = ALL_ROCK;
  return { index, bricks: new Int8Array(0) };
}
const VIEWPOINTS = [[20, -20, 0, 30, -20, 0]];
const mesh = buildTurtle();

describe('the turtle', () => {
  it('is one closed shape of a sensible size, the same on both sides', () => {
    const count = mesh.vertices.length / BODY_VERTEX_BYTES;
    expect(count).toBeGreaterThan(6000);
    expect(count).toBeLessThan(45000);
    expect(mesh.indices.length % 3).toBe(0);
    expect(Math.max(...mesh.indices.subarray(0, 3000))).toBeLessThan(count);
    const positions = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset);
    let [left, right, widest, front, back] = [0, 0, 0, 0, 0];
    for (let i = 0; i < count; i++) {
      const x = positions.getFloat32(i * BODY_VERTEX_BYTES, true);
      const z = positions.getFloat32(i * BODY_VERTEX_BYTES + 8, true);
      if (x > 0.005) right++;
      else if (x < -0.005) left++;
      widest = Math.max(widest, Math.abs(x));
      front = Math.max(front, z);
      back = Math.min(back, z);
    }
    expect(Math.abs(left - right) / count).toBeLessThan(0.02);
    // flipper tip to flipper tip nearly two metres; beak to tail a little over one and a quarter
    expect(widest).toBeGreaterThan(0.85);
    expect(widest).toBeLessThan(0.97);
    expect(front).toBeGreaterThan(0.7);
    expect(back).toBeLessThan(-0.55);
  });

  it('tells each vertex which limb moves it: the shell none, the flippers wholly past the joint', () => {
    const count = mesh.vertices.length / BODY_VERTEX_BYTES;
    const positions = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset);
    const seen = [0, 0, 0, 0];
    let tips = 0;
    for (let i = 0; i < count; i++) {
      const at = i * BODY_VERTEX_BYTES;
      const [limb, , share, skin] = mesh.vertices.subarray(at + 16, at + 20) as unknown as number[];
      expect(limb).toBeLessThanOrEqual(LIMB.head);
      seen[limb!]!++;
      if (limb === LIMB.shell) expect(share).toBe(0);
      else expect(skin).toBe(1);
      const x = Math.abs(positions.getFloat32(at, true));
      if (x > SHOULDER[0] + 0.2) {
        // out here there is only flipper, and all of it rows
        expect(limb).toBe(LIMB.front);
        expect(share).toBe(255);
        tips++;
      }
    }
    expect(seen.every((n) => n > 150)).toBe(true);
    expect(tips).toBeGreaterThan(500);
  });

  it("the shader has the mesh's joints and the loop's shape", () => {
    const source = readFileSync('src/shaders/turtle.wgsl', 'utf8');
    const numbers = (name: string) =>
      source
        .match(new RegExp(`const ${name} = (?:vec\\df\\()?([^;)]*)\\)?;`))![1]!
        .split(',')
        .map(Number);
    expect(numbers('SHOULDER')).toEqual([...SHOULDER]);
    expect(numbers('HIP')).toEqual([...HIP]);
    expect(numbers('NECK')).toEqual([...NECK]);
    expect(numbers('EYE')).toEqual([...EYE]);
    expect(numbers('SHELL')).toEqual([...SHELL]);
    expect(numbers('FLIPPER_REACH')).toEqual([FLIPPER_REACH]);
    expect(numbers('LOOP_SQUASH')).toEqual([LOOP_SQUASH]);
    expect(numbers('LOOP_RISE')).toEqual([LOOP_RISE]);
  });
});

describe('where turtles swim', () => {
  it('three loops in open water, the same every time, the first near the first viewpoint', () => {
    const water = field();
    const turtles = placeTurtles(VIEWPOINTS, water);
    expect(turtles.length).toBe(3 * TURTLE_FLOATS);
    expect(turtles.every(Number.isFinite)).toBe(true);
    expect(Array.from(placeTurtles(VIEWPOINTS, water))).toEqual(Array.from(turtles));
    expect(Math.hypot(turtles[0]! - 29, turtles[2]!)).toBeLessThan(11);
    for (let i = 0; i < turtles.length; i += TURTLE_FLOATS) {
      const [, , , radius, , speed, size] = turtles.subarray(i, i + TURTLE_FLOATS) as unknown as number[];
      expect(radius! >= 2.5 && radius! <= 9).toBe(true);
      // about half a metre a second, either way round
      expect(Math.abs(speed!) * radius!).toBeGreaterThan(0.4);
      expect(Math.abs(speed!) * radius!).toBeLessThan(0.65);
      expect(size! > 0.8 && size! < 1.2).toBe(true);
    }
  });

  it('no loop passes through kelp', () => {
    const water = field();
    // a column of kelp every 7 m over the whole floor, but for a glade 26 m across round (60, 20)
    const kelp: number[] = [];
    for (let x = -140; x <= 140; x += 7)
      for (let z = -140; z <= 140; z += 7) if (Math.hypot(x - 60, z - 20) > 13) kelp.push(x, -45, z, 40);
    const columns = new Float32Array(kelp);
    // with nowhere near it to go, a turtle is left out
    expect(placeTurtles([[-80, -20, -80, -70, -20, -80]], water, columns).length).toBeLessThan(3 * TURTLE_FLOATS);
    // by the glade one finds it
    const turtles = placeTurtles([[52, -20, 20, 62, -20, 20]], water, columns);
    expect(turtles.length).toBeGreaterThanOrEqual(TURTLE_FLOATS);
    const point: number[] = [];
    for (let i = 0; i < turtles.length; i += TURTLE_FLOATS) {
      const turtle = turtles.subarray(i, i + TURTLE_FLOATS);
      for (let step = 0; step < 64; step++) {
        loopPoint(turtle, (step / 64) * Math.PI * 2, point);
        for (let k = 0; k < columns.length; k += 4)
          expect(Math.hypot(columns[k]! - point[0]!, columns[k + 2]! - point[2]!)).toBeGreaterThan(2.3);
      }
    }
  });

  it('no loop passes through rock', () => {
    expect(
      placeTurtles(
        VIEWPOINTS,
        field(() => true),
      ).length,
    ).toBe(0);
    // rock everywhere west of x = 0
    const edge = Math.floor(((0 - ORIGIN_X) / VOXEL - COLLISION_OFFSET) / 4);
    const turtles = placeTurtles(
      VIEWPOINTS,
      field((x) => x < edge),
    );
    const point: number[] = [];
    for (let i = 0; i < turtles.length; i += TURTLE_FLOATS) {
      const turtle = turtles.subarray(i, i + TURTLE_FLOATS);
      for (let step = 0; step < 64; step++) {
        loopPoint(turtle, (step / 64) * Math.PI * 2, point);
        expect(point[0]! - 1.2).toBeGreaterThan(-0.1);
      }
    }
  });
});
