import { describe, expect, it } from 'vitest';
import { hypot2, hypot3 } from '../../src/math/hypot';

// The generator's output must not move by a bit, so these have to be Math.hypot exactly, not approximately.
// (This holds on V8, which is what Node and Chrome run; the checksums against the original are taken there.)
describe('hypot2 and hypot3', () => {
  it('give the same bits as Math.hypot', () => {
    let seed = 12345;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
    const scales = [1, 1e-3, 1e3, 1e-12, 1e12, 1e-160, 1e150, 400, 0.09];
    let different = 0;
    for (let i = 0; i < 2e6; i++) {
      const s = scales[i % scales.length]!;
      const t = scales[(i >> 3) % scales.length]!;
      const a = (random() - 0.5) * s;
      const b = (random() - 0.5) * t;
      const c = (random() - 0.5) * (i & 1 ? s : t);
      if (!Object.is(hypot2(a, b), Math.hypot(a, b))) different++;
      if (!Object.is(hypot3(a, b, c), Math.hypot(a, b, c))) different++;
    }
    expect(different).toBe(0);
  });

  it('agree on the edge cases the generator can reach', () => {
    for (const [a, b, c] of [
      [0, 0, 0],
      [3, 4, 0],
      [-0, 5, 0],
      [1e-320, 1e-320, 1e-320],
      [1, 1, 1],
      [0, 0, 7],
      [-5, 0, 0],
    ] as const) {
      expect(Object.is(hypot2(a, b), Math.hypot(a, b))).toBe(true);
      expect(Object.is(hypot3(a, b, c), Math.hypot(a, b, c))).toBe(true);
    }
  });
});
