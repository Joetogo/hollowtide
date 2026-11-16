// Dynamic resolution: holds the frame rate by trading away first pixels, then draw distance.
//
// Every second (every 0.4 s behind the menu) the controller looks at how long frames took and scales the load.
// With GPU timestamps it aims for 9.8 to 13.6 ms of GPU time; without, it goes by the frame interval. Too slow:
// pixels go down to half the full count first, then the draw distance shrinks to 40 %, then the remaining pixels
// go. Faster: back the same way. Plain state and arithmetic, so it can be tested without a GPU.

/** The most pixels a frame is rendered at; a larger canvas is scaled up from that. */
export const MAX_PIXELS = 2560 * 1440;
export const MIN_DETAIL = 0.4;

export interface DynRes {
  /** pixel budget for the render size */
  pixels: number;
  /** draw-distance scale, MIN_DETAIL..1 */
  detail: number;
  /** the fewest pixels it will go down to */
  readonly minPixels: number;
  // the measuring period so far: frames, their time, and the GPU times reported in it
  frames: number;
  elapsedMs: number;
  gpuMs: number;
  gpuSamples: number;
  // without GPU times: slow periods in a row, good periods in a row, and how many good ones to wait before
  // trying more
  slowPeriods: number;
  goodPeriods: number;
  patience: number;
}

export function createDynRes(pixels: number, detail: number, mobile: boolean): DynRes {
  return {
    pixels,
    detail,
    minPixels: mobile ? 25e4 : 5e5,
    frames: 0,
    elapsedMs: 0,
    gpuMs: 0,
    gpuSamples: 0,
    slowPeriods: 0,
    goodPeriods: 0,
    patience: 3,
  };
}

/** A GPU time for one frame has arrived (they come a few frames late). */
export function addGpuTime(state: DynRes, ms: number): void {
  if (state.elapsedMs > 0 && ms > 0 && ms < 1e3) {
    state.gpuMs += ms;
    state.gpuSamples++;
  }
}

/** The render size changed: measure nothing for the next 300 ms, while it settles. */
export function settle(state: DynRes): void {
  state.frames = state.gpuMs = state.gpuSamples = 0;
  state.elapsedMs = -300;
}

/** Holds the current settings: nothing is measured until settle() is called. */
export function hold(state: DynRes): void {
  state.elapsedMs = -Infinity;
}

/**
 * Counts one frame that took `frameMs`. At the end of a measuring period it may change `pixels` or `detail`;
 * returns true if it did. `devicePixels` is the canvas's full size in device pixels.
 */
export function addFrame(state: DynRes, frameMs: number, behindMenu: boolean, devicePixels: number): boolean {
  if (!(frameMs < 1e3)) return false; // the tab was in the background
  state.elapsedMs += frameMs;
  if (!(state.elapsedMs > 0)) return false;
  state.frames++;
  if (!(state.elapsedMs > (behindMenu ? 400 : 1000))) return false;

  const frame = state.elapsedMs / state.frames;
  const gpu = state.gpuSamples ? state.gpuMs / state.gpuSamples : 0;
  let k = 1; // how much load the next period should carry, relative to this one
  if (gpu) {
    // with GPU timing: keep it between 9.8 and 13.6 ms
    if (gpu > 13.6 || gpu < 9.8) k = 11.7 / gpu;
  } else if (frame > 17.6) {
    // without: slow for two periods in a row means fewer pixels, and twice as long before trying to go back up
    state.goodPeriods = 0;
    if (++state.slowPeriods > 1) {
      k = 15 / frame;
      state.slowPeriods = 0;
      state.patience = Math.min(state.patience * 2, 60);
    }
  } else {
    // at the display's rate there is no telling if there is room, so try a little more now and then
    state.slowPeriods = 0;
    if (frame < 12.5) k = 15 / frame;
    else if (++state.goodPeriods > state.patience) {
      k = 1.17;
      state.goodPeriods = 0;
    }
  }
  k = k < 0.5 ? 0.5 : k > 1.7 ? 1.7 : k;
  const top = Math.min(MAX_PIXELS, devicePixels);
  const mid = Math.max(top / 2, state.minPixels);
  const before = state.pixels + state.detail;
  // too slow: pixels down to `mid` first, then draw distance, then the remaining pixels; faster goes back the same way
  if (k < 1 ? state.pixels > mid || state.detail <= MIN_DETAIL : state.pixels < mid || state.detail >= 1) {
    const end = k < 1 ? (state.detail > MIN_DETAIL ? mid : state.minPixels) : state.detail < 1 ? mid : top;
    state.pixels *= k;
    if (k < 1 ? state.pixels < end : state.pixels > end) state.pixels = end;
  } else {
    state.detail *= Math.sqrt(k);
    state.detail = state.detail < MIN_DETAIL ? MIN_DETAIL : state.detail > 1 ? 1 : state.detail;
  }
  state.frames = state.elapsedMs = state.gpuMs = state.gpuSamples = 0;
  return before !== state.pixels + state.detail;
}
