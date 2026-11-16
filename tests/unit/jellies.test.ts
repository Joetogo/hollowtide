import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JELLY_VERTICES } from '../../src/render/passes/jellies';
import { ALL_ROCK, COLLISION_BRICKS, COLLISION_OFFSET, type CollisionField } from '../../src/world/collision';
import { NY, ORIGIN_X, VOXEL } from '../../src/world/grid';
import { JELLY_FLOATS, openWater, placeJellies } from '../../src/world/jellies';

/** A field that is water everywhere, but rock in the bricks `rock` picks (by brick x, y, z). */
function field(rock: (x: number, y: number, z: number) => boolean = () => false): CollisionField {
  const index = new Uint16Array(COLLISION_BRICKS * (NY / 4) * COLLISION_BRICKS);
  for (let z = 0; z < COLLISION_BRICKS; z++)
    for (let y = 0; y < NY / 4; y++)
      for (let x = 0; x < COLLISION_BRICKS; x++)
        if (rock(x, y, z)) index[x + COLLISION_BRICKS * (y + (NY / 4) * z)] = ALL_ROCK;
  return { index, bricks: new Int8Array(0) };
}
const VIEWPOINTS = [[0, -20, 0, 10, -20, 0]];
/** The brick a world x falls in. */
const brickX = (x: number) => Math.floor(((x - ORIGIN_X) / VOXEL - COLLISION_OFFSET) / 4);

describe('jellyfish', () => {
  it('the pass draws as many vertices as the shader makes of one jelly', () => {
    const source = readFileSync('src/shaders/jelly.wgsl', 'utf8');
    const constant = (name: string) => +source.match(new RegExp(`const ${name} = (\\d+)u`))![1]!;
    expect(constant('BELL')).toBe(constant('AROUND') * constant('RINGS'));
    expect(constant('TENTACLES')).toBeLessThan(constant('TRAILS'));
    expect((constant('BELL') + constant('TRAILS') * constant('LINKS')) * 6).toBe(JELLY_VERTICES);
  });

  it('in open water there are scores of them, the same ones every time', () => {
    const water = field();
    const jellies = placeJellies(VIEWPOINTS, water);
    const count = jellies.length / JELLY_FLOATS;
    expect(count).toBeGreaterThan(70);
    expect(count).toBeLessThan(140);
    expect(jellies.every(Number.isFinite)).toBe(true);
    for (let i = 0; i < jellies.length; i += JELLY_FLOATS) {
      const [x, y, z, radius, seed, drift, colour, beat] = jellies.subarray(i, i + JELLY_FLOATS) as unknown as number[];
      expect(radius).toBeGreaterThanOrEqual(0.1);
      expect(radius).toBeLessThanOrEqual(0.53);
      expect(seed! >= 0 && seed! < 1 && colour! >= 0 && colour! < 1).toBe(true);
      expect(beat).toBeGreaterThan(0.4);
      expect(openWater(water, x!, y!, z!, drift! + radius!, 0.3 * drift! + 1.2 * radius!)).toBe(true);
    }
    expect(Array.from(placeJellies(VIEWPOINTS, water))).toEqual(Array.from(jellies));
    // some of them ahead of the first viewpoint, for the moment of waking
    let ahead = 0;
    for (let i = 0; i < jellies.length; i += JELLY_FLOATS)
      if (Math.hypot(jellies[i]! - 13, jellies[i + 1]! + 17.5, jellies[i + 2]!) < 8) ahead++;
    expect(ahead).toBeGreaterThanOrEqual(8);
  });

  it('none is put in rock, or where its drifting would take it into rock', () => {
    expect(
      placeJellies(
        VIEWPOINTS,
        field(() => true),
      ).length,
    ).toBe(0);
    // rock everywhere west of x = 0
    const edge = brickX(0);
    const half = field((x) => x < edge);
    const jellies = placeJellies(VIEWPOINTS, half);
    expect(jellies.length).toBeGreaterThan(0);
    for (let i = 0; i < jellies.length; i += JELLY_FLOATS) {
      // its home, less its drift and its own size, stays on the water's side (this field steps from a metre
      // inside the rock to a metre outside within one voxel, so "a metre clear" is reached just past the step)
      expect(jellies[i]! - jellies[i + 5]! - jellies[i + 3]!).toBeGreaterThan(-0.1);
    }
  });

  it('open water ends at the edges of what the collision field covers', () => {
    const water = field();
    expect(openWater(water, 0, -20, 0, 1, 1)).toBe(true);
    expect(openWater(water, 149.5, -20, 0, 1, 1)).toBe(false);
    expect(openWater(water, 0, -2, 0, 1, 1)).toBe(false);
    expect(openWater(water, 0, -53.5, 0, 1, 1)).toBe(false);
  });
});
