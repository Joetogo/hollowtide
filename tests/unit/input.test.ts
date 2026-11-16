import { describe, expect, it } from 'vitest';
import { createCamera } from '../../src/camera/camera';
import { viewFromHash, viewToHash } from '../../src/camera/share';
import { Random, seedBase } from '../../src/math/random';
import { stick } from '../../src/ui/input';

describe('a view as a link', () => {
  it('goes into the address and comes back out the same, to a tenth of a metre and a degree', () => {
    const camera = createCamera();
    Object.assign(camera, { x: 12.34, y: -30.26, z: -101.5, yaw: 2.5, pitch: -0.4 });
    const hash = viewToHash(camera);
    expect(hash).toBe('#at=12.3,-30.3,-101.5,143,-23');
    const [x, y, z, yaw, pitch] = viewFromHash(hash)!;
    expect([x, y, z]).toEqual([12.3, -30.3, -101.5]);
    expect(Math.abs(yaw - 2.5)).toBeLessThan(0.01);
    expect(Math.abs(pitch + 0.4)).toBeLessThan(0.01);
    // a turn to the left of straight ahead is written as its angle the other way round
    camera.yaw = -0.5;
    expect(viewToHash(camera)).toBe('#at=12.3,-30.3,-101.5,331,-23');
    camera.yaw = -1e-9;
    expect(viewToHash(camera)).toMatch(/,0,-23$/);
  });

  it('is not taken from an address that has none, or a broken one, or one outside the water', () => {
    for (const hash of [
      '',
      '#',
      '#at=',
      '#at=1,2,3',
      '#at=1,-20,3,10,10,10',
      '#at=a,-20,3,10,10',
      '#at=1,-20,3,10,1e3',
      '#at=1,-20,3,10,--1',
      '#at=1,-20,3,10,90', // straight up
      '#at=200,-20,3,10,0', // beyond the edge of the world
      '#at=1,-60,3,10,0', // under the seabed
      '#at=1,5,3,10,0', // in the air
      '#elsewhere=1,-20,3,10,0',
    ])
      expect(viewFromHash(hash), hash).toBeNull();
    expect(viewFromHash('#at=1,-20,3,10,0')).not.toBeNull();
  });
});

describe('a gamepad stick', () => {
  it('is at rest near its middle and still reaches all the way', () => {
    expect(stick(0)).toBe(0);
    expect(stick(0.1)).toBe(0);
    expect(stick(-0.15)).toBe(0);
    expect(stick(1)).toBeCloseTo(1, 12);
    expect(stick(-1)).toBeCloseTo(-1, 12);
    expect(stick(0.58)).toBeCloseTo(0.5, 12);
    // and never jumps: just outside the dead middle it is barely moving
    expect(stick(0.17)).toBeLessThan(0.02);
  });
});

describe('a world asked for by number', () => {
  const first = (random: Random, stream: number) => {
    random.reseed(stream);
    return [random.next(), random.next(), random.next()];
  };
  it('number 0 is the world as authored', () => {
    expect(first(new Random(seedBase(0)), 3)).toEqual(first(new Random(), 3));
  });
  it('any other number is another world, and always the same one', () => {
    const seen = new Set<number>();
    for (const seed of [1, 2, 7, 8, 1000, 123456789]) {
      const draws = first(new Random(seedBase(seed)), 3);
      expect(draws).toEqual(first(new Random(seedBase(seed)), 3));
      expect(draws).not.toEqual(first(new Random(), 3));
      seen.add(draws[0]!);
    }
    expect(seen.size).toBe(6);
  });
});
