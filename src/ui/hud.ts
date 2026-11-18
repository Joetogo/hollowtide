// The stats line (key H): frame rate, the worst frame, late frames, GPU time and the render size.

export interface Hud {
  readonly on: boolean;
  toggle(): void;
  /** The pace is about to change on purpose (the panel halves it): frames are not late against the old one. */
  rest(): void;
  /** Call once a frame with the time since the last one, in milliseconds. */
  frame(frameMs: number, gpuMs: number, width: number, height: number, deviceWidth: number): void;
}

export function createHud(line: HTMLElement): Hud {
  let on = false;
  let frames = 0,
    seconds = 0,
    worst = 0,
    best = 1e9,
    usual = 1e9,
    late = 0,
    lateTotal = 0;
  return {
    get on() {
      return on;
    },
    toggle() {
      on = !on;
      lateTotal = 0;
      usual = 1e9;
      line.textContent = '';
    },
    rest() {
      usual = 1e9;
    },
    frame(frameMs, gpuMs, width, height, deviceWidth) {
      if (!on) return;
      frames++;
      if (frameMs > worst) worst = frameMs;
      if (frameMs < best) best = frameMs;
      // late: half again as long as the shortest frame of the last half second
      if (frameMs > usual * 1.5) {
        late++;
        lateTotal++;
      }
      seconds += frameMs / 1000;
      if (seconds > 0.5) {
        line.textContent =
          `${(frames / seconds).toFixed(0)} fps  ·  worst frame ${worst.toFixed(1)} ms  ·  late frames ${late} (total ${lateTotal})` +
          `  ·  GPU ${gpuMs.toFixed(2)} ms  ·  ${width}x${height} (${((width * 100) / deviceWidth) | 0}%)`;
        seconds = 0;
        usual = best;
        frames = 0;
        worst = 0;
        best = 1e9;
        late = 0;
      }
    },
  };
}
