// Dynamic resolution: holds the frame rate by trading away first pixels, then draw distance.
//
// Every second (every 0.4 s behind the menu) the controller looks at how long frames took and scales the load.
// With GPU timestamps it aims for 9.8 to 13.6 ms of GPU time (or, asked for a sharp picture rather than a smooth
// one, about twice that: thirty frames a second); without, it goes by the frame interval. Too slow:
// pixels go down to half the full count first, then the draw distance shrinks to 40 %, then the remaining pixels
// go. Faster: back the same way. Plain state and arithmetic, so it can be tested without a GPU.
//
// Not every GPU is short of pixels. On some (an integrated one drawing two million leaves) a frame takes nearly
// as long at a quarter of the pixels: what it is short of is geometry. The controller notices when a change of
// pixel count buys next to nothing, twice running, and from then on leaves the pixels at full and trades only
// the draw distance. And when the lowest settings are still far too slow, it says so (`stuck`), so that whoever
// drives it can stop aiming for a frame rate that is not to be had.
//
// The pixel count can also be taken out of its hands (`fixed`): then it is what was asked for, a share of the
// full count, and only the draw distance is traded.

/** The most pixels a frame is rendered at; a larger canvas is scaled up from that. */
export const MAX_PIXELS = 2560 * 1440;
export const MIN_DETAIL = 0.4;
/**
 * The GPU time a frame is steered towards, milliseconds. SMOOTH leaves room to spare at sixty frames a second;
 * SHARP settles for thirty, and spends the difference on pixels and draw distance.
 */
export const SMOOTH = 11.7;
export const SHARP = 25;

export interface DynRes {
  /** pixel budget for the render size */
  pixels: number;
  /** draw-distance scale, MIN_DETAIL..1 */
  detail: number;
  /** the fewest pixels it will go down to */
  readonly minPixels: number;
  /** the GPU time aimed for, ms: SMOOTH or SHARP (it may be changed at any time) */
  target: number;
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
  /** the pixel count and GPU time of the period before (0: none to compare with) */
  lastPixels: number;
  lastGpu: number;
  /** changes of pixel count in a row that bought next to nothing */
  flat: number;
  /** this GPU's time hardly follows its pixel count: pixels stay at full and only the draw distance is traded */
  geometryBound: boolean;
  /** the full pixel count that was found at (another screen is another question) */
  boundAt: number;
  /** measuring periods in a row at the lowest settings and still far too slow (see OUT_OF_REACH) */
  stuck: number;
  /** 0: the pixel count is the controller's to trade. Otherwise the share of the full count it is held at. */
  fixed: number;
}

/** After this many such periods the target is out of this machine's reach. */
export const OUT_OF_REACH = 4;

export function createDynRes(pixels: number, detail: number, mobile: boolean, target = SMOOTH): DynRes {
  return {
    pixels,
    detail,
    minPixels: mobile ? 25e4 : 5e5,
    target,
    frames: 0,
    elapsedMs: 0,
    gpuMs: 0,
    gpuSamples: 0,
    slowPeriods: 0,
    goodPeriods: 0,
    patience: 3,
    lastPixels: 0,
    lastGpu: 0,
    flat: 0,
    geometryBound: false,
    boundAt: 0,
    stuck: 0,
    fixed: 0,
  };
}

/** The pixel count a fixed share comes to for a canvas of `devicePixels`: never below the controller's floor. */
const heldAt = (state: DynRes, top: number): number => Math.max(top * state.fixed, Math.min(top, state.minPixels));

/**
 * Takes the pixel count out of the controller's hands, at a share of the full count (1: all of it), or with 0
 * gives it back. A fixed count is in use from the next frame; `devicePixels` is the canvas's full size.
 */
export function fixPixels(state: DynRes, share: number, devicePixels: number): void {
  state.fixed = share;
  if (!share) return;
  state.pixels = heldAt(state, Math.min(MAX_PIXELS, devicePixels));
  state.lastGpu = state.flat = 0;
  settle(state);
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
  // (the numbers are those of the smooth target, 11.7 ms; for another target they stretch with it)
  const r = state.target / SMOOTH;
  if (gpu) {
    // with GPU timing: keep it between 9.8 and 13.6 ms
    if (gpu > 13.6 * r || gpu < 9.8 * r) k = state.target / gpu;
  } else if (frame > 17.6 * r) {
    // without: slow for two periods in a row means fewer pixels, and twice as long before trying to go back up
    state.goodPeriods = 0;
    if (++state.slowPeriods > 1) {
      k = (15 * r) / frame;
      state.slowPeriods = 0;
      state.patience = Math.min(state.patience * 2, 60);
    }
  } else {
    // at the display's rate there is no telling if there is room, so try a little more now and then
    state.slowPeriods = 0;
    if (frame < 12.5 * r) k = (15 * r) / frame;
    else if (++state.goodPeriods > state.patience) {
      k = 1.17;
      state.goodPeriods = 0;
    }
  }
  k = k < 0.5 ? 0.5 : k > 1.7 ? 1.7 : k;
  const top = Math.min(MAX_PIXELS, devicePixels);
  const before = state.pixels + state.detail;
  state.frames = state.elapsedMs = state.gpuMs = state.gpuSamples = 0;

  // ---- what did the last change of pixel count buy? (Time that followed the pixels would have changed by the
  // same factor: a GPU whose time moved by less than the factor's 0.3rd power, twice running, is short of
  // something else.)
  if (state.geometryBound && Math.abs(top / state.boundAt - 1) > 0.2) state.geometryBound = false;
  if (gpu && state.lastGpu && Math.abs(Math.log(state.pixels / state.lastPixels)) > 0.14) {
    const bought = Math.log(gpu / state.lastGpu) / Math.log(state.pixels / state.lastPixels);
    state.flat = bought < 0.3 ? state.flat + 1 : 0;
    if (state.flat > 1 && !state.geometryBound) {
      state.geometryBound = true;
      state.boundAt = top;
    }
  }
  state.lastPixels = state.pixels;
  state.lastGpu = gpu;
  // where the pixel count is not to be traded, this is what it stays at: what was asked for, or all of it
  const held = state.fixed ? heldAt(state, top) : state.geometryBound ? top : 0;
  if (held && (state.fixed ? state.pixels !== held : state.pixels < held)) {
    // the pixels given up bought nothing (or the window is another size than the fixed count was worked out
    // for): have them back, and see what that costs before doing anything else
    state.pixels = held;
    state.lastGpu = 0;
    state.flat = 0;
    return true;
  }
  const floor = held || state.minPixels;
  const mid = held || Math.max(top / 2, state.minPixels);
  const most = held || top;

  // too slow: pixels down to `mid` first, then draw distance, then the remaining pixels; faster goes back the same way
  if (k < 1 ? state.pixels > mid || state.detail <= MIN_DETAIL : state.pixels < mid || state.detail >= 1) {
    const end = k < 1 ? (state.detail > MIN_DETAIL ? mid : floor) : state.detail < 1 ? mid : most;
    state.pixels *= k;
    if (k < 1 ? state.pixels < end : state.pixels > end) state.pixels = end;
  } else {
    state.detail *= Math.sqrt(k);
    state.detail = state.detail < MIN_DETAIL ? MIN_DETAIL : state.detail > 1 ? 1 : state.detail;
  }
  const changed = before !== state.pixels + state.detail;
  // nothing left to give up, and still slower than the target by a third or more
  const farTooSlow = gpu ? gpu > 13.6 * r * 1.3 : frame > 17.6 * r * 1.3;
  state.stuck = farTooSlow && !changed ? state.stuck + 1 : 0;
  return changed;
}
