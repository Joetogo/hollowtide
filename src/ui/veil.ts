// The veil: one canvas drawn over the scene, which is everything the opening shows that is not the world.
//
//   the descent   while the world is being made, a diver sinks through the water: daylight and its rays fade,
//                 the specks in the water stream past, a scale at the side counts the metres. How deep the
//                 diver has got is how far the loading has got.
//   black         when the world is ready the diver sinks out of sight and the picture goes black...
//   the reveal    ...and lifts on the home view.
//   the eyes      on the dive, the picture is seen through eyelids that flutter open.
//
// It is plain 2D drawing, a few milliseconds a frame, and it stops altogether once the eyes are open.

/** The depth the descent ends at, metres: where the swimmer wakes. */
export const WAKING_DEPTH = 41.4;
/** Seconds the eyes take to open. */
export const EYES_SECONDS = 2.7;

export interface Veil {
  /** How far the loading has got, 0..1. The diver follows, never faster than a descent should look. */
  progress(fraction: number): void;
  /** Loading is done: the diver sinks into the dark. Resolves when the picture is black. */
  sink(): Promise<void>;
  /** Lifts the black off whatever is behind the veil. */
  reveal(): void;
  /** Closes the eyes at once and opens them: a flutter, another, then wide. Resolves when they are open. */
  openEyes(): Promise<void>;
  /** Called with the depth shown, in metres, whenever it changes. */
  onDepth: (metres: number) => void;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (t: number) => {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
};
/** A cheap repeatable random number for a whole number. */
const noise = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// the water's colour at the top and the bottom of the picture, at the surface, half way down and at the bottom
const WATER = [
  [
    [122, 226, 240],
    [26, 150, 190],
  ],
  [
    [26, 128, 170],
    [8, 64, 94],
  ],
  [
    [8, 50, 74],
    [2, 16, 24],
  ],
] as const;
const waterAt = (depth: number, end: 0 | 1) => {
  const t = depth * 2;
  const a = WATER[t < 1 ? 0 : 1]![end]!;
  const b = WATER[t < 1 ? 1 : 2]![end]!;
  const f = t < 1 ? t : t - 1;
  return `rgb(${mix(a[0], b[0], f) | 0},${mix(a[1], b[1], f) | 0},${mix(a[2], b[2], f) | 0})`;
};

// how open the eyes are through the opening (seconds, openness): a flutter, a longer look, then wide
const EYES = [
  [0, 0],
  [0.3, 0],
  [0.6, 0.2],
  [0.85, 0.03],
  [1.3, 0.45],
  [1.55, 0.3],
  [EYES_SECONDS, 1.25],
] as const;

export function createVeil(canvas: HTMLCanvasElement): Veil {
  const context = canvas.getContext('2d')!;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let width = 0;
  let height = 0;
  let unit = 1; // one 720th of the picture's height: the drawing is laid out for 720 and scaled

  let mode: 'descent' | 'black' | 'reveal' | 'eyes' | 'off' = 'descent';
  let target = 0; // how far loading has got
  let shown = 0; // how far the diver has got
  let rate = 0; // how fast, per second
  let sunk = 0; // 0..1 through the sinking out of sight
  let since = 0; // seconds in the current mode
  let time = 0;
  let last = 0;
  let done: (() => void) | null = null;
  let lastDepth = -1;

  // specks in the water: where across, how far down (0..1, wraps), how near (0.3..1)
  const specks = Array.from({ length: 110 }, (_, i) => [noise(i), noise(i + 500), 0.25 + 0.75 * noise(i + 900)]);
  // bubbles off the diver: x, y, radius, age
  const bubbles: number[][] = [];
  let nextBubble = 0;

  const fit = () => {
    // (at most one and a half device pixels to a CSS pixel: this is soft-edged drawing, and fill is what it costs)
    const scale = Math.min(devicePixelRatio, 1.5);
    const w = Math.max(2, Math.round(canvas.clientWidth * scale));
    const h = Math.max(2, Math.round(canvas.clientHeight * scale));
    if (w !== width || h !== height) {
      canvas.width = width = w;
      canvas.height = height = h;
    }
    unit = height / 720;
  };

  /** The diver, sinking on their back with arms and legs trailing up: a silhouette of thick round strokes. */
  const diver = (x: number, y: number, turn: number, light: number) => {
    const u = 54 * unit;
    const sway = (phase: number, by: number) => Math.sin(time * 0.9 + phase) * by * (still ? 0 : 1);
    context.save();
    context.translate(x, y);
    context.rotate(turn);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    const limb = (points: number[], widths: number[]) => {
      for (let i = 0; i + 3 < points.length; i += 2) {
        context.lineWidth = widths[i / 2]! * u;
        context.beginPath();
        context.moveTo(points[i]! * u, points[i + 1]! * u);
        context.lineTo(points[i + 2]! * u, points[i + 3]! * u);
        context.stroke();
      }
    };
    const body = () => {
      // far arm and leg, the trunk, the head, then the near arm and leg
      limb([-0.62, 0.02, -0.36 + sway(1, 0.05), -0.52, -0.2 + sway(1.4, 0.09), -1.0 + sway(2, 0.05)], [0.16, 0.13]);
      limb([0.34, 0.04, 0.86 + sway(3, 0.05), -0.16, 1.44 + sway(3.5, 0.08), -0.44 + sway(4, 0.08)], [0.21, 0.16]);
      limb([0.3, 0.08, -0.56, 0.12, -0.84, 0.02], [0.46, 0.34]);
      context.beginPath();
      context.arc(-1.1 * u, -0.1 * u, 0.2 * u, 0, Math.PI * 2);
      context.fill();
      limb([-0.6, 0.06, -0.78 + sway(0, 0.05), -0.5, -0.54 + sway(0.6, 0.1), -1.04 + sway(1.1, 0.06)], [0.17, 0.14]);
      limb([0.3, 0.1, 0.72 + sway(2.5, 0.05), -0.36, 1.22 + sway(2.9, 0.09), -0.78 + sway(3.3, 0.09)], [0.22, 0.17]);
      // fins
      for (const [fx, fy, a] of [
        [1.22 + sway(2.9, 0.09), -0.78 + sway(3.3, 0.09), -0.75],
        [1.44 + sway(3.5, 0.08), -0.44 + sway(4, 0.08), -0.55],
      ] as const) {
        context.save();
        context.translate(fx * u, fy * u);
        context.rotate(a + sway(5, 0.12));
        context.beginPath();
        context.moveTo(-0.05 * u, -0.07 * u);
        context.lineTo(0.62 * u, -0.2 * u);
        context.lineTo(0.66 * u, 0.2 * u);
        context.lineTo(-0.05 * u, 0.07 * u);
        context.closePath();
        context.fill();
        context.restore();
      }
    };
    // a rim of the light from above, then the dark of the body over it
    context.strokeStyle = context.fillStyle = `rgba(190,240,250,${0.5 * light})`;
    context.translate(-1.5 * unit, -2.5 * unit);
    body();
    context.translate(1.5 * unit, 2.5 * unit);
    context.strokeStyle = context.fillStyle = '#04131b';
    body();
    context.restore();
  };

  const descent = (dt: number) => {
    // the diver follows the loading, eased, and no faster than a descent should look
    const before = shown;
    shown += Math.min((target - shown) * Math.min(1, dt * 5), dt / 1.9);
    if (still) shown = target;
    rate = dt > 0 ? mix(rate, (shown - before) / dt, Math.min(1, dt * 6)) : 0;
    const depth = shown;
    const light = Math.pow(1 - depth, 1.5) * (1 - sunk);

    // the water, lighter above than below
    const water = context.createLinearGradient(0, 0, 0, height);
    water.addColorStop(0, waterAt(depth, 0));
    water.addColorStop(1, waterAt(depth, 1));
    context.fillStyle = water;
    context.fillRect(0, 0, width, height);

    // daylight: a glow at the top and rays slanting down from it, both fading with depth
    context.globalCompositeOperation = 'lighter';
    const glow = context.createRadialGradient(width * 0.5, -height * 0.2, 0, width * 0.5, -height * 0.2, height * 1.1);
    glow.addColorStop(0, `rgba(200,250,255,${0.6 * light})`);
    glow.addColorStop(1, 'rgba(200,250,255,0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);
    for (let i = 0; i < 7; i++) {
      const x = width * (0.08 + 0.14 * i + 0.03 * Math.sin(time * 0.17 + i * 1.7) * (still ? 0 : 1));
      const half = width * (0.012 + 0.014 * noise(i + 40));
      const lean = width * 0.16;
      const ray = context.createLinearGradient(0, 0, 0, height * 0.95);
      ray.addColorStop(0, `rgba(210,250,255,${(0.16 + 0.1 * noise(i + 70)) * light})`);
      ray.addColorStop(1, 'rgba(210,250,255,0)');
      context.fillStyle = ray;
      context.beginPath();
      context.moveTo(x - half, 0);
      context.lineTo(x + half, 0);
      context.lineTo(x + lean + half * 4, height);
      context.lineTo(x + lean - half * 4, height);
      context.closePath();
      context.fill();
    }

    // specks in the water, drifting up past the diver as they sink: the nearer a speck, the larger and the
    // faster, and at speed each is drawn out a little, as a camera would catch it
    const speed = (26 + rate * WAKING_DEPTH * 46 + sunk * 520) * unit; // of the nearest specks, a second
    context.lineCap = 'round';
    for (const speck of specks) {
      if (!still) speck[1] = (speck[1]! - (speed * speck[2]! * dt) / height + 1) % 1;
      const x = (speck[0]! + 0.012 * Math.sin(time * 0.5 + speck[1]! * 9)) * width;
      const y = speck[1]! * height;
      context.strokeStyle = `rgba(205,242,250,${(0.1 + 0.3 * speck[2]! * speck[2]!) * (0.55 + 0.45 * (1 - depth))})`;
      context.lineWidth = (0.9 + 2.2 * speck[2]! * speck[2]!) * unit;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x, y + Math.max(0.5, speed * speck[2]! * 0.02));
      context.stroke();
    }
    context.globalCompositeOperation = 'source-over';

    // the scale at the side: a tick a metre, a figure every five, sliding up past a mark at the diver's level
    const metres = depth * WAKING_DEPTH;
    const perMetre = 46 * unit;
    const level = height * 0.5;
    context.fillStyle = context.strokeStyle = `rgba(220,248,255,${0.55 * (1 - sunk)})`;
    context.lineWidth = 1.5 * unit;
    context.font = `600 ${13 * unit}px system-ui, sans-serif`;
    context.textBaseline = 'middle';
    for (let m = Math.max(0, Math.ceil(metres - 9)); m <= metres + 9; m++) {
      const y = level + (m - metres) * perMetre;
      const long = m % 5 === 0;
      context.beginPath();
      context.moveTo(28 * unit, y);
      context.lineTo((long ? 50 : 38) * unit, y);
      context.stroke();
      if (long) context.fillText(String(m), 58 * unit, y);
    }
    context.beginPath();
    context.moveTo(18 * unit, level - 5 * unit);
    context.lineTo(26 * unit, level);
    context.lineTo(18 * unit, level + 5 * unit);
    context.closePath();
    context.fill();

    // the diver, a little lower in the picture the deeper they are, and their bubbles going the other way
    const x = width * 0.5 + Math.sin(time * 0.41) * 12 * unit * (still ? 0 : 1);
    const y =
      height * (0.4 + 0.1 * depth) + Math.sin(time * 0.8) * 5 * unit * (still ? 0 : 1) + sunk * sunk * height * 0.75;
    const turn = -0.28 + Math.sin(time * 0.33) * 0.07 * (still ? 0 : 1) + sunk * 0.25;
    if (!still && time > nextBubble) {
      nextBubble = time + 0.05 + 0.16 * Math.random();
      bubbles.push([
        x - 56 * unit + (Math.random() - 0.5) * 10 * unit,
        y - 2 * unit,
        (1.5 + 5 * Math.random()) * unit,
        0,
      ]);
    }
    context.strokeStyle = `rgba(225,250,255,${0.75 * (1 - sunk)})`;
    context.lineWidth = 1.2 * unit;
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i]!;
      b[3]! += dt;
      b[1]! -= (70 * unit + speed * 0.55 + b[2]! * 9) * dt;
      b[0]! += Math.sin(b[3]! * 7 + i) * 18 * unit * dt;
      if (b[1]! < -20 * unit) {
        bubbles.splice(i, 1);
        continue;
      }
      context.beginPath();
      context.arc(b[0]!, b[1]!, b[2]! * (1 + b[3]! * 0.25), 0, Math.PI * 2);
      context.stroke();
    }
    diver(x, y, turn, light);

    // the dark closes in from the edges, and at the end from everywhere
    const edge = context.createRadialGradient(
      width / 2,
      height / 2,
      height * 0.3,
      width / 2,
      height / 2,
      height * 0.95,
    );
    edge.addColorStop(0, 'rgba(1,8,12,0)');
    edge.addColorStop(1, `rgba(1,8,12,${0.35 + 0.45 * depth})`);
    context.fillStyle = edge;
    context.fillRect(0, 0, width, height);
    if (sunk > 0) {
      context.fillStyle = `rgba(0,0,0,${smooth(sunk * 1.15)})`;
      context.fillRect(0, 0, width, height);
    }

    if (Math.abs(metres - lastDepth) >= 0.05) veil.onDepth((lastDepth = metres));
  };

  /** The picture as seen through eyelids `open` apart (0 shut, 1 wide open, more than 1 out of sight). */
  const eyes = (open: number) => {
    context.clearRect(0, 0, width, height);
    // everything but an eye-shaped opening is black; its soft edge is the shape's own shadow
    const lift = open * height * 0.78;
    context.fillStyle = '#000';
    context.shadowColor = '#000';
    context.shadowBlur = 70 * unit;
    context.beginPath();
    context.rect(-200, -200, width + 400, height + 400);
    context.moveTo(-width * 0.2, height / 2);
    context.quadraticCurveTo(width / 2, height / 2 - lift * 2, width * 1.2, height / 2);
    context.quadraticCurveTo(width / 2, height / 2 + lift * 2, -width * 0.2, height / 2);
    context.closePath();
    context.fill('evenodd');
    context.shadowBlur = 0;
    // and what is seen is dim at first
    context.fillStyle = `rgba(0,0,0,${0.55 * clamp01(1 - open * 1.4)})`;
    context.fillRect(0, 0, width, height);
  };

  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    time += dt;
    since += dt;
    fit();
    if (mode === 'descent') {
      if (done) sunk = Math.min(1, sunk + dt / (still ? 0.3 : 1.25));
      descent(dt);
      // black once the diver is gone, provided the scale has caught up with the loading
      if (done && sunk >= 1 && shown > 0.985) {
        mode = 'black';
        context.fillStyle = '#000';
        context.fillRect(0, 0, width, height);
        veil.onDepth((lastDepth = WAKING_DEPTH)); // arrived
        done();
        done = null;
      }
    } else if (mode === 'reveal') {
      const t = since / (still ? 0.4 : 1.6);
      context.clearRect(0, 0, width, height);
      context.fillStyle = `rgba(0,0,0,${1 - smooth(t)})`;
      context.fillRect(0, 0, width, height);
      if (t >= 1) {
        mode = 'off';
        canvas.style.display = 'none'; // nothing to draw: not even an empty layer over the scene
      }
    } else if (mode === 'eyes') {
      let open = 1.25;
      if (still) open = since / 0.5 >= 1 ? 1.25 : smooth(since / 0.5) * 1.25;
      else {
        for (let i = 0; i + 1 < EYES.length; i++) {
          const [t0, o0] = EYES[i]!;
          const [t1, o1] = EYES[i + 1]!;
          if (since >= t0 && since < t1) open = mix(o0, o1, smooth((since - t0) / (t1 - t0)));
        }
      }
      eyes(open);
      if (since >= (still ? 0.5 : EYES_SECONDS)) {
        mode = 'off';
        canvas.style.display = 'none';
        done?.();
        done = null;
      }
    }
    if (mode !== 'off' && mode !== 'black') requestAnimationFrame(frame);
  };
  const run = (next: typeof mode) => {
    const idle = mode === 'off' || mode === 'black';
    mode = next;
    since = 0;
    canvas.style.display = '';
    if (idle) {
      last = performance.now();
      requestAnimationFrame(frame);
    }
  };

  const veil: Veil = {
    onDepth: () => undefined,
    progress(fraction) {
      target = Math.max(target, clamp01(fraction));
    },
    sink() {
      target = 1;
      return new Promise((resolve) => (done = resolve));
    },
    reveal: () => run('reveal'),
    openEyes() {
      done?.();
      fit();
      eyes(0);
      run('eyes');
      return new Promise((resolve) => (done = resolve));
    },
  };
  last = performance.now();
  requestAnimationFrame(frame);
  return veil;
}
