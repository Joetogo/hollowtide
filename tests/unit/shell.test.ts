import { describe, expect, it } from 'vitest';
import { createCamera, lookAt } from '../../src/camera/camera';
import { createIntent, createSwimmer, FAST_SPEED, SPEED, stepSwimmer } from '../../src/camera/controls';
import {
  addFrame,
  addGpuTime,
  createDynRes,
  hold,
  MAX_PIXELS,
  MIN_DETAIL,
  settle,
  SHARP,
  SMOOTH,
} from '../../src/render/dynres';

// That swimming matches the original frame for frame is checked in the browser against the original itself
// (tests/browser/controls.mjs). These tests pin down the rules on their own terms.

describe('swimming', () => {
  const swim = (
    seconds: number,
    set: (intent: ReturnType<typeof createIntent>) => void,
    from = [0, -30, 0, 0, -30, -10],
  ) => {
    const camera = createCamera();
    const [x, y, z, tx, ty, tz] = from as [number, number, number, number, number, number];
    lookAt(camera, x, y, z, tx, ty, tz);
    const swimmer = createSwimmer();
    const intent = createIntent();
    set(intent);
    for (let i = 0; i < seconds * 60; i++) stepSwimmer(camera, swimmer, intent, null, 1 / 60);
    return { camera, swimmer };
  };

  it('eases up to speed along the view direction', () => {
    const { camera, swimmer } = swim(2, (i) => (i.forward = 1));
    expect(Math.hypot(swimmer.vx, swimmer.vy, swimmer.vz)).toBeCloseTo(SPEED, 2);
    expect(camera.x).toBeCloseTo(0, 6);
    expect(camera.z).toBeLessThan(-10); // looking towards -z
    expect(camera.z).toBeGreaterThan(-SPEED * 2);
  });

  it('goes faster with the fast key, and coasts to a stop without input', () => {
    const fast = swim(2, (i) => ((i.forward = 1), (i.fast = true)));
    expect(Math.hypot(fast.swimmer.vx, fast.swimmer.vz)).toBeCloseTo(FAST_SPEED, 1);
    const intent = createIntent();
    for (let i = 0; i < 180; i++) stepSwimmer(fast.camera, fast.swimmer, intent, null, 1 / 60);
    expect(Math.hypot(fast.swimmer.vx, fast.swimmer.vz)).toBeLessThan(0.001);
  });

  it('strafes level and rises straight up, whatever the pitch', () => {
    const { camera } = swim(1, (i) => ((i.right = 1), (i.up = 1)), [0, -30, 0, 0, -40, -10]); // looking down
    expect(camera.x).toBeGreaterThan(3);
    expect(camera.y).toBeGreaterThan(-27);
    expect(camera.z).toBeCloseTo(0, 6);
  });

  it('turns by the mouse movement, smoothed over a few frames, and stops at straight up', () => {
    const camera = createCamera();
    lookAt(camera, 0, -30, 0, 0, -30, -10);
    const swimmer = createSwimmer();
    const intent = createIntent();
    intent.lookX = 100;
    stepSwimmer(camera, swimmer, intent, null, 1 / 60);
    expect(intent.lookX).toBe(0); // consumed
    expect(camera.yaw).toBeGreaterThan(0);
    expect(camera.yaw).toBeLessThan(100 * 0.0022); // not all at once
    for (let i = 0; i < 60; i++) stepSwimmer(camera, swimmer, intent, null, 1 / 60);
    expect(camera.yaw).toBeCloseTo(100 * 0.0022, 6);
    intent.lookY = -5000;
    for (let i = 0; i < 60; i++) stepSwimmer(camera, swimmer, intent, null, 1 / 60);
    expect(camera.pitch).toBe(1.55);
  });

  it('keeps the swimmer inside the world', () => {
    const out = swim(30, (i) => ((i.forward = 1), (i.fast = true)));
    expect(Math.hypot(out.camera.x, out.camera.z)).toBeCloseTo(150, 6);
    const up = swim(30, (i) => (i.up = 1));
    expect(up.camera.y).toBe(-1.2);
    const down = swim(30, (i) => (i.up = -1));
    expect(down.camera.y).toBe(-52);
  });
});

describe('dynamic resolution', () => {
  const FULL = 2560 * 1440;
  /** Exactly one measuring period (a second of frames) with the given GPU time (0: none reported). */
  const period = (state: ReturnType<typeof createDynRes>, frameMs: number, gpuMs: number) => {
    let changed = false;
    for (let i = Math.floor(1000 / frameMs) + 1; i > 0; i--) {
      if (gpuMs) addGpuTime(state, gpuMs);
      changed = addFrame(state, frameMs, false, FULL) || changed;
    }
    return changed;
  };

  it('leaves things alone while the GPU time is in its band', () => {
    const state = createDynRes(MAX_PIXELS, 1, false);
    expect(period(state, 16.7, 11)).toBe(false);
    expect([state.pixels, state.detail]).toEqual([MAX_PIXELS, 1]);
  });

  it('too slow: gives up pixels first, then draw distance, then the remaining pixels', () => {
    const state = createDynRes(MAX_PIXELS, 1, false);
    expect(period(state, 33, 30)).toBe(true);
    expect(state.pixels).toBeCloseTo(MAX_PIXELS * 0.5, 0); // one step is capped at halving
    expect(state.detail).toBe(1);
    for (let i = 0; i < 3; i++) period(state, 33, 30); // pixels are at half: now the draw distance goes
    expect(state.pixels).toBe(MAX_PIXELS / 2);
    expect(state.detail).toBe(MIN_DETAIL);
    for (let i = 0; i < 4; i++) period(state, 33, 30);
    expect(state.pixels).toBe(state.minPixels);
  });

  it('fast again: comes back the same way', () => {
    const state = createDynRes(5e5, MIN_DETAIL, false);
    period(state, 16.7, 5);
    expect(state.pixels).toBeGreaterThan(5e5); // pixels up to half first
    expect(state.detail).toBe(MIN_DETAIL);
    for (let i = 0; i < 6; i++) period(state, 16.7, 5);
    expect(state.pixels).toBe(MAX_PIXELS / 2);
    expect(state.detail).toBe(1);
    for (let i = 0; i < 4; i++) period(state, 16.7, 5);
    expect(state.pixels).toBe(MAX_PIXELS);
  });

  it('without GPU times: acts on slow frame intervals only after two slow periods in a row', () => {
    const state = createDynRes(MAX_PIXELS, 1, false);
    expect(period(state, 25, 0)).toBe(false);
    expect(period(state, 25, 0)).toBe(true);
    expect(state.pixels).toBeCloseTo(MAX_PIXELS * (15 / 25), -3);
  });

  it('measures faster behind the menu, skips background frames, and can be held', () => {
    const state = createDynRes(MAX_PIXELS, 1, false);
    let frames = 0;
    addGpuTime(state, 30);
    while (!addFrame(state, 16.7, true, FULL)) {
      addGpuTime(state, 30);
      frames++;
    }
    expect(frames).toBeLessThan(30); // a 0.4 s period
    const before = state.pixels;
    expect(addFrame(state, 5000, false, FULL)).toBe(false); // the tab was in the background
    settle(state);
    expect(state.elapsedMs).toBe(-300);
    hold(state);
    for (let i = 0; i < 300; i++) period(state, 40, 40);
    expect(state.pixels).toBe(before);
  });

  it('asked for a sharp picture, settles for thirty frames a second and spends the rest on pixels', () => {
    // 22 ms of GPU time is far too slow for the smooth target and just right for the sharp one
    const smooth = createDynRes(MAX_PIXELS, 1, false);
    expect(period(smooth, 33, 22)).toBe(true);
    expect(smooth.pixels).toBeLessThan(MAX_PIXELS);
    const sharp = createDynRes(MAX_PIXELS, 1, false, SHARP);
    expect(period(sharp, 33, 22)).toBe(false);
    expect([sharp.pixels, sharp.detail]).toEqual([MAX_PIXELS, 1]);
    // switched over while running: what was given up for smoothness comes back
    const state = createDynRes(5e5, MIN_DETAIL, false);
    state.target = SHARP;
    for (let i = 0; i < 12; i++) period(state, 33, 12);
    expect(state.pixels).toBe(MAX_PIXELS);
    expect(state.detail).toBe(1);
    expect(SHARP).toBeGreaterThan(SMOOTH * 2);
  });

  it('never goes below fewer pixels on a phone than its own floor', () => {
    const state = createDynRes(1280 * 720, 1, true);
    for (let i = 0; i < 20; i++) period(state, 50, 50);
    expect(state.pixels).toBe(25e4);
    expect(state.detail).toBe(MIN_DETAIL);
  });
});
