import { describe, expect, it } from 'vitest';
import { MAX_PIXELS } from '../../src/render/dynres';
import { renderSize, COARSE_SHAFTS_ABOVE, shaftSize } from '../../src/render/targets';

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

describe('the size of the light shafts', () => {
  it('half the picture each way is exactly that, as it always was', () => {
    for (const [width, height] of [
      [1280, 720],
      [2560, 1440],
      [942, 530],
      [2, 2],
    ] as const)
      expect(shaftSize(width, height, 2)).toEqual([width / 2, height / 2]);
  });

  it('a third each way covers the picture, and its last texel still has a pixel of the picture under it', () => {
    for (const [width, height] of [
      [2560, 1440],
      [3840, 2160],
      [2562, 1442],
      [2048, 1152],
    ] as const) {
      const [w, h] = shaftSize(width, height, 3);
      expect(w * 3).toBeGreaterThanOrEqual(width);
      expect(h * 3).toBeGreaterThanOrEqual(height);
      // the march reads the picture's depth at three times its own place
      expect((w - 1) * 3).toBeLessThan(width);
      expect((h - 1) * 3).toBeLessThan(height);
    }
    expect(shaftSize(2560, 1440, 3)).toEqual([854, 480]);
  });

  it('is only made coarser above 1920 x 1080', () => {
    expect(COARSE_SHAFTS_ABOVE).toBe(1920 * 1080);
    expect(1280 * 720).toBeLessThan(COARSE_SHAFTS_ABOVE); // where the frames are held to the original's
  });
});
