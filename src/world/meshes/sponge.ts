// Sponges: three barrel and vase shapes turned on a lathe, and a cluster of tubes.
import { MeshBuilder, type Point } from '../../math/mesh';
import { fbm } from '../../math/noise';
import type { Random } from '../../math/random';
import { TAU } from '../../math/scalar';

/** A lathe profile from the foot up, over the rim and down the inside: radius, height, ambient occlusion. */
type Profile = readonly (readonly [number, number, number])[];

export const BARREL: Profile = [
  [0, 0, 0.5],
  [0.34, 0, 0.6],
  [0.5, 0.2, 0.85],
  [0.6, 0.6, 1],
  [0.55, 0.95, 1],
  [0.47, 1.08, 1],
  [0.38, 1.1, 0.9],
  [0.3, 1.0, 0.45],
  [0.26, 0.6, 0.15],
  [0, 0.35, 0.05],
];
export const VASE: Profile = [
  [0, 0, 0.5],
  [0.2, 0, 0.6],
  [0.26, 0.5, 0.85],
  [0.4, 1.25, 1],
  [0.4, 1.42, 1],
  [0.33, 1.48, 0.9],
  [0.26, 1.38, 0.4],
  [0.18, 0.8, 0.12],
  [0, 0.5, 0.05],
];
export const BOWL: Profile = [
  [0, 0, 0.5],
  [0.5, 0, 0.7],
  [0.72, 0.18, 1],
  [0.74, 0.38, 1],
  [0.62, 0.5, 0.9],
  [0.48, 0.42, 0.45],
  [0.4, 0.2, 0.15],
  [0, 0.14, 0.06],
];

/** Turns a profile around the y axis, with noise lumps and `ribs` shallow ribs around it. */
export function lathe(profile: Profile, segments: number, lump: number, ribs = 0): MeshBuilder {
  const mesh = new MeshBuilder();
  const rings: number[][] = [];
  for (const [r, h, ao] of profile) {
    const ring: number[] = [];
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * TAU;
      const radius =
        r *
        (1 +
          lump * (fbm(Math.cos(a) * 1.5 + h * 2, h * 3, Math.sin(a) * 1.5, 2) - 0.5) +
          0.07 * Math.cos(ribs * a + h * 1.5));
      ring.push(mesh.vertex(Math.cos(a) * radius, h, Math.sin(a) * radius, ao));
    }
    rings.push(ring);
  }
  for (let k = 0; k < rings.length - 1; k++) {
    for (let s = 0; s < segments; s++) {
      const s2 = (s + 1) % segments;
      mesh.quad(rings[k][s], rings[k + 1][s], rings[k + 1][s2], rings[k][s2]);
    }
  }
  return mesh;
}

/** Nine tubes leaning out from a common foot, each with a rim and a dark throat. Random stream 210. */
export function tubeSponge(random: Random): MeshBuilder {
  random.reseed(210);
  const mesh = new MeshBuilder();
  for (let i = 0; i < 9; i++) {
    const a = random.next() * TAU;
    const r0 = random.range(0, 0.28);
    const h = random.range(0.45, 1.1);
    const radius = random.range(0.07, 0.12);
    const lean = random.range(0.05, 0.3);
    const points: Point[] = [];
    for (let k = 0; k <= 4; k++) {
      points.push([Math.cos(a) * (r0 + ((lean * k) / 4) * h), (h * k) / 4, Math.sin(a) * (r0 + ((lean * k) / 4) * h)]);
    }
    mesh.tube(
      points,
      (k) => radius * (0.8 + (0.25 * k) / 4),
      12,
      false,
      (k) => 0.35 + (0.65 * k) / 4,
    );
    // the throat: the top ring closed over a point sunk inside the tube
    const top = points[4];
    const n = mesh.vertexCount;
    const centre = mesh.vertex(top[0], top[1] - radius * 1.2, top[2], 0.05);
    for (let s = 0; s < 12; s++) mesh.triangle(n - 12 + s, n - 12 + ((s + 1) % 12), centre);
  }
  return mesh;
}
