import { describe, expect, it } from 'vitest';
import { createCamera, lookAt } from '../../src/camera/camera';
import { createIntent, createSwimmer, FAST_SPEED, SPEED, stepSwimmer } from '../../src/camera/controls';
import {
  addFrame,
  addGpuTime,
  createDynRes,
  fixPixels,
  hold,
  MAX_PIXELS,
  MIN_DETAIL,
  OUT_OF_REACH,
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

  /**
   * A machine: the GPU time of a frame for the pixels and the draw distance it is asked for. `follows` is how
   * closely the time follows the pixel count: 1 for a GPU short of pixels, near 0 for one short of geometry.
   */
  const machine =
    (fullMs: number, follows: number) =>
    (state: ReturnType<typeof createDynRes>): number =>
      fullMs * (state.pixels / MAX_PIXELS) ** follows * (0.35 + 0.65 * state.detail * state.detail);
  /** Lets the controller run a machine for some seconds; returns the GPU time it ends at. */
  const run = (state: ReturnType<typeof createDynRes>, gpuOf: ReturnType<typeof machine>, seconds: number) => {
    for (let i = 0; i < seconds; i++) period(state, Math.max(16.7, gpuOf(state)), gpuOf(state));
    return gpuOf(state);
  };

  it('too slow: gives up pixels first, then draw distance, then the remaining pixels', () => {
    // short of pixels, and far too slow whatever is given up
    const slow = machine(400, 1);
    const state = createDynRes(MAX_PIXELS, 1, false);
    expect(period(state, 33, slow(state))).toBe(true);
    expect(state.pixels).toBeCloseTo(MAX_PIXELS * 0.5, 0); // one step is capped at halving
    expect(state.detail).toBe(1);
    run(state, slow, 3); // pixels are at half: now the draw distance goes
    expect(state.pixels).toBe(MAX_PIXELS / 2);
    expect(state.detail).toBe(MIN_DETAIL);
    run(state, slow, 4);
    expect(state.pixels).toBe(state.minPixels);
    expect(state.geometryBound).toBe(false);
  });

  it('fast again: comes back the same way', () => {
    const fast = machine(9, 1);
    const state = createDynRes(5e5, MIN_DETAIL, false);
    run(state, fast, 1);
    expect(state.pixels).toBeGreaterThan(5e5); // pixels up to half first
    expect(state.detail).toBe(MIN_DETAIL);
    run(state, fast, 6);
    expect(state.pixels).toBe(MAX_PIXELS / 2);
    expect(state.detail).toBe(1);
    run(state, fast, 4);
    expect(state.pixels).toBe(MAX_PIXELS);
  });

  it('settles a machine that is short of pixels where its time is in the band', () => {
    const state = createDynRes(MAX_PIXELS, 1, false);
    const gpu = run(state, machine(30, 1), 20);
    expect(gpu).toBeGreaterThan(9.8);
    expect(gpu).toBeLessThan(13.6);
    expect(state.pixels).toBeLessThan(MAX_PIXELS / 2 + 1);
    expect(state.geometryBound).toBe(false);
    expect(state.stuck).toBe(0);
  });

  it('a GPU short of geometry keeps its pixels: only the draw distance is traded', () => {
    // a quarter of the pixels buys 7 % of the time; the draw distance buys the rest
    const bound = machine(20, 0.05);
    const state = createDynRes(MAX_PIXELS, 1, false);
    const gpu = run(state, bound, 20);
    expect(state.geometryBound).toBe(true);
    expect(state.pixels).toBe(MAX_PIXELS);
    expect(state.detail).toBeLessThan(0.8);
    expect(state.detail).toBeGreaterThan(MIN_DETAIL);
    expect(gpu).toBeGreaterThan(9.8);
    expect(gpu).toBeLessThan(13.6);
    expect(state.stuck).toBe(0);
    // on another screen it is asked again (here one with a quarter of the pixels)
    period(state, Math.max(16.7, bound(state)), bound(state));
    for (let i = 0; i < 70; i++) addFrame(state, 16.7, false, FULL / 4);
    expect(state.geometryBound).toBe(false);
  });

  it('says when the lowest settings are still far too slow, and stops saying it once they are not', () => {
    // 42 ms at full settings, 19 at the lowest: sixty frames a second is not to be had, thirty is
    const hopeless = machine(42, 0.05);
    const state = createDynRes(MAX_PIXELS, 1, false);
    // while there is still something to give up, it is not stuck
    let seconds = 0;
    while (state.pixels !== MAX_PIXELS || state.detail !== MIN_DETAIL || !state.geometryBound) {
      expect(state.stuck).toBe(0);
      run(state, hopeless, 1);
      expect(++seconds).toBeLessThan(15);
    }
    // from then on every second counts
    run(state, hopeless, OUT_OF_REACH);
    expect(state.stuck).toBeGreaterThanOrEqual(OUT_OF_REACH);
    // told to settle for thirty frames a second, it finds room again and gives back draw distance
    state.target = SHARP;
    const gpu = run(state, hopeless, 12);
    expect(state.stuck).toBe(0);
    expect(state.detail).toBeGreaterThan(MIN_DETAIL + 0.1);
    expect(state.pixels).toBe(MAX_PIXELS);
    expect(gpu).toBeLessThan(13.6 * (SHARP / SMOOTH));
    // a machine that is only a little slow at its lowest is not counted as stuck
    const nearly = createDynRes(5e5, MIN_DETAIL, false);
    for (let i = 0; i < 10; i++) period(nearly, 16.7, 15);
    expect(nearly.stuck).toBe(0);
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

  it('a pixel count that was asked for is kept: too slow or fast, only the draw distance is traded', () => {
    const state = createDynRes(1e6, 1, false);
    fixPixels(state, 1, FULL);
    expect(state.pixels).toBe(MAX_PIXELS); // at once, not a measuring period later
    for (let i = 0; i < 12; i++) period(state, 33, 30);
    expect(state.pixels).toBe(MAX_PIXELS);
    expect(state.detail).toBe(MIN_DETAIL);
    expect(state.stuck).toBeGreaterThan(0); // and it says when that is not enough
    for (let i = 0; i < 12; i++) period(state, 16.7, 4);
    expect([state.pixels, state.detail]).toEqual([MAX_PIXELS, 1]);
    // half of them: half the full count, whatever there is time for
    fixPixels(state, 0.5, FULL);
    expect(state.pixels).toBe(MAX_PIXELS / 2);
    for (let i = 0; i < 12; i++) period(state, 16.7, 2);
    expect([state.pixels, state.detail]).toEqual([MAX_PIXELS / 2, 1]);
    // in another window the same share of what that one has, from the next measuring period
    for (let i = 0; i < 80; i++) addFrame(state, 16.7, false, 1e6);
    expect(state.pixels).toBe(5e5);
    // and given back, the count is the controller's again
    fixPixels(state, 0, FULL);
    for (let i = 0; i < 12; i++) period(state, 16.7, 4);
    expect(state.pixels).toBe(MAX_PIXELS);
  });

  it('never goes below fewer pixels on a phone than its own floor', () => {
    const state = createDynRes(1280 * 720, 1, true);
    const slow = machine(600, 1);
    for (let i = 0; i < 20; i++) period(state, 50, slow(state));
    expect(state.pixels).toBe(25e4);
    expect(state.detail).toBe(MIN_DETAIL);
  });
});
