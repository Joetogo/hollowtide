import { describe, expect, it } from 'vitest';
import { MAX_PIXELS } from '../../src/render/dynres';
import { renderSize } from '../../src/render/targets';

describe('renderSize', () => {
  it('renders at device pixels while they fit the budget', () => {
    expect(renderSize(1280, 720, 1, MAX_PIXELS)).toEqual([1280, 720]);
    expect(renderSize(1280, 720, 2, MAX_PIXELS)).toEqual([2560, 1440]);
  });

  it('scales both sides evenly to fit the budget', () => {
    const [w, h] = renderSize(1280, 832, 2, 500_000); // a 2560x1664 panel held to half a megapixel
    expect(w * h).toBeLessThanOrEqual(500_000 * 1.01);
    expect(w / h).toBeCloseTo(2560 / 1664, 1);
  });

  it('always gives even sizes of at least 2, which the half-size targets rely on', () => {
    for (const [cw, ch, dpr] of [
      [1279, 719, 1],
      [333, 777, 1.5],
      [1, 1, 1],
      [0, 0, 2],
    ] as const) {
      const [w, h] = renderSize(cw, ch, dpr, MAX_PIXELS);
      expect([w % 2, h % 2]).toEqual([0, 0]);
      expect(Math.min(w, h)).toBeGreaterThanOrEqual(2);
    }
  });
});
