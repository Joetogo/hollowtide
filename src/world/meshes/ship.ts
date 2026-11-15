// The sunken ship, bow towards +x: a keel with stem and stern posts, curved ribs, hull planking with breaches,
// a raised stern castle with its transom, what is left of the deck, two masts with yards, and a bowsprit.
// Built from box-section beams. Random stream 220.
import { MeshBuilder, type Point } from '../../math/mesh';
import type { Random } from '../../math/random';
import { clamp, mix, smoothRamp } from '../../math/scalar';

const { abs, cos, sin, pow, max, min, PI } = Math;

export function ship(random: Random): MeshBuilder {
  random.reseed(220);
  const mesh = new MeshBuilder();
  const HALF_LENGTH = 17;
  const BEAM = 5.6;
  const DEPTH = 7.6;
  // the hull's shape at station x: half-breadth, depth below the waterline, and the rise of the deck line
  const halfBreadth = (x: number) => BEAM * pow(max(1 - pow(abs(x / HALF_LENGTH), x < 0 ? 3.6 : 2.6), 0), 0.5);
  const depth = (x: number) => DEPTH * (1 - 0.36 * pow(abs(x / HALF_LENGTH), 2.5));
  const sheer = (x: number) => 0.5 + (x > 0 ? 3.0 : 3.8) * pow(abs(x / HALF_LENGTH), 2.2);
  /** A point on the hull at station x; `around` runs from -PI/2 (one rail) under the keel to PI/2 (the other). */
  const hull = (x: number, around: number, offset = 0): Point => {
    const b = halfBreadth(x) + offset,
      d = depth(x) + offset,
      s = sheer(x);
    return [x, s - (d + s) * pow(max(cos(around), 0), 0.66), b * Math.sign(around) * pow(abs(sin(around)), 0.8)];
  };
  const outwards = (p: Point): Point => {
    const length = Math.hypot(p[1] + 0.5, p[2] * 1.3) || 1;
    return [0, (p[1] + 0.5) / length, (p[2] * 1.3) / length];
  };
  const up = (): Point => [0, 1, 0];

  // keel, curving up into the stem and the stern post
  const keel: Point[] = [];
  for (let i = 0; i <= 44; i++) {
    const x = mix(-HALF_LENGTH - 1.0, HALF_LENGTH + 2.4, i / 44);
    const e = max(abs(x) / HALF_LENGTH - 0.78, 0) * 4.2;
    keel.push([x, -depth(clamp(x, -HALF_LENGTH, HALF_LENGTH)) - 0.3 + e * e * e * 4.2, 0]);
  }
  mesh.sweep(keel, 0.55, 0.95, up);

  // ribs every 0.8 m; one in ten is broken off short on either side
  for (let x = -HALF_LENGTH + 0.7; x < HALF_LENGTH - 0.3; x += 0.8) {
    const a0 = random.next() < 0.1 ? random.range(-0.9, -0.2) : -PI / 2;
    const a1 = random.next() < 0.1 ? random.range(0.2, 0.9) : PI / 2;
    const points: Point[] = [];
    for (let i = 0; i <= 16; i++) points.push(hull(x, mix(a0, a1, i / 16)));
    mesh.sweep(points, 0.24, 0.3, outwards);
  }

  // planking: 14 strakes, left out where one of four ragged breaches is
  const holeX = random.range(-6, 2);
  const holeSide = random.next() < 0.5 ? 1 : -1;
  // breaches: station, position around the hull, half-length, half-height
  const breaches = [
    [holeX, holeSide * 0.8, 3.2, 0.42],
    [7, -holeSide * 0.95, 2.4, 0.34],
    [12, holeSide * 0.5, 1.7, 0.28],
    [-11, -holeSide * 0.55, 2.1, 0.3],
  ];
  const breached = (x: number, around: number) => {
    for (const h of breaches) {
      const a = (x - h[0]) / h[2],
        b = (around - h[1]) / h[3];
      if (a * a + b * b < 1 + 0.45 * sin(x * 3.1 + around * 9)) return true;
    }
    return false;
  };
  const STRAKES = 14;
  const stations: number[] = [];
  for (let x = -HALF_LENGTH + 0.35; x <= HALF_LENGTH - 0.3; x += 0.85) stations.push(x);
  for (let j = 0; j < STRAKES; j++) {
    const p0 = mix(-1.5, 1.5, j / STRAKES),
      p1 = mix(-1.5, 1.5, (j + 1) / STRAKES);
    const side = p0 + p1 < 0 ? -1 : 1;
    const lower = side < 0 ? p1 : p0,
      upper = side < 0 ? p0 : p1;
    let previous: number[] | null = null;
    for (const x of stations) {
      // each plank overlaps the one below: an outer and an inner face
      const current = [
        mesh.vertex(...hull(x, lower, 0.27)),
        mesh.vertex(...hull(x, upper, 0.14)),
        mesh.vertex(...hull(x, lower, 0.1)),
        mesh.vertex(...hull(x, upper, 0.1)),
      ];
      if (previous && !breached(x - 0.42, (p0 + p1) / 2)) {
        if (side > 0) {
          mesh.quad(previous[0], previous[1], current[1], current[0]);
          mesh.quad(previous[2], current[2], current[3], previous[3]);
        } else {
          mesh.quad(previous[0], current[0], current[1], previous[1]);
          mesh.quad(previous[2], previous[3], current[3], current[2]);
        }
      }
      previous = current;
    }
  }

  for (const side of [-1, 1]) {
    // rail
    let points: Point[] = [];
    for (let x = -HALF_LENGTH + 0.6; x <= HALF_LENGTH - 0.6; x += 1) points.push(hull(x, (side * PI) / 2, 0.2));
    mesh.sweep(points, 0.3, 0.28, up);
    // stern castle bulwarks, three boards high
    for (let j = 0; j < 3; j++) {
      points = [];
      for (let x = -HALF_LENGTH + 0.4; x <= -HALF_LENGTH + 8.5 - j; x += 0.9) {
        points.push([x, sheer(x) + 0.55 + j * 0.86, side * (max(halfBreadth(x), 2.6) + 0.15)]);
      }
      mesh.sweep(points, 0.82, 0.09, () => [0, 0, side]);
    }
  }
  // transom: boards across the stern, one in ten missing
  for (let y = -3; y < sheer(-HALF_LENGTH) + 3; y += 0.86) {
    const w = max(1.2, 2.9 * smoothRamp(-4.5, 1.5, y));
    if (random.next() < 0.9)
      mesh.sweep(
        [
          [-HALF_LENGTH + 0.35, y, -w],
          [-HALF_LENGTH + 0.35, y, w],
        ],
        0.82,
        0.1,
        () => [1, 0, 0],
      );
  }
  // deck beams, irregularly spaced
  for (let x = -HALF_LENGTH + 2; x < HALF_LENGTH - 2; x += random.range(1.8, 3.2)) {
    mesh.sweep(
      [
        [x, sheer(x) - 0.25, -halfBreadth(x)],
        [x, sheer(x) - 0.2, 0],
        [x, sheer(x) - 0.25, halfBreadth(x)],
      ],
      0.26,
      0.26,
      up,
    );
  }
  // deck planks: runs of random length with gaps, 60 % of them still there
  for (let z = -3.9; z <= 3.9; z += 0.62) {
    let x = -HALF_LENGTH + random.range(1, 5);
    while (x < HALF_LENGTH - 4) {
      const x1 = min(x + random.range(3, 9), HALF_LENGTH - 3.5);
      if (random.next() < 0.6) {
        const points: Point[] = [];
        for (let xx = x; xx <= x1; xx += 1) if (halfBreadth(xx) > abs(z) + 0.3) points.push([xx, sheer(xx) - 0.05, z]);
        if (points.length > 1) mesh.sweep(points, 0.56, 0.07, up);
      }
      x = x1 + random.range(0.5, 3);
    }
  }
  // foremast with two yards, the broken main mast, the bowsprit
  const forward = (): Point => [1, 0, 0];
  mesh.sweep(
    [
      [7, -DEPTH + 0.6, 0],
      [7.1, 1, 0],
      [7.4, 8, 0.3],
      [7.8, 15, 0.8],
    ],
    (k) => 0.62 - k * 0.1,
    (k) => 0.62 - k * 0.1,
    forward,
  );
  mesh.sweep(
    [
      [7.5, 9.5, -5.2],
      [7.5, 9.6, 0.3],
      [7.5, 9.2, 5.6],
    ],
    0.26,
    0.26,
    up,
  );
  mesh.sweep(
    [
      [7.7, 13.2, -3.2],
      [7.7, 13.3, 3.6],
    ],
    0.2,
    0.2,
    up,
  );
  mesh.sweep(
    [
      [-3, -DEPTH + 0.6, 0],
      [-3.2, 1, 0.2],
      [-3.9, 6, 1.0],
      [-5.2, 9.5, 2.6],
    ],
    (k) => 0.74 - k * 0.1,
    (k) => 0.74 - k * 0.1,
    forward,
  );
  mesh.sweep(
    [
      [HALF_LENGTH + 1.4, 2.6, 0],
      [HALF_LENGTH + 8, 5.2, 0.2],
    ],
    0.34,
    0.34,
    up,
  );
  return mesh;
}
