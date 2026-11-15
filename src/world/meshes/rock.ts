// Rocks: a lumpy sphere with a few flat cuts. Boulders, rock chunks and pebbles are all this at different
// seeds and levels of subdivision.
import type { Level } from '../../config/quality';
import { icosphere, type MeshBuilder } from '../../math/mesh';
import { fbm } from '../../math/noise';
import { quatRandom } from '../../math/quat';
import type { Random } from '../../math/random';

/**
 * @param seed picks the rock's shape, and its random stream (100 + seed)
 * @param subdivisions 3: 1280 triangles, 2: 320, 1: 80; Low detail takes one off
 * @param detailed adds a finer layer of bumps (by default on the 1280-triangle rocks)
 */
export function rock(
  random: Random,
  level: Level,
  seed: number,
  subdivisions = 2,
  detailed = subdivisions > 2,
): MeshBuilder {
  if (level > 1 && subdivisions > 1) subdivisions--; // Low: a quarter of the triangles
  random.reseed(100 + seed);
  // four random cutting planes: unit normal and distance from the centre
  const planes: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const q = quatRandom(random);
    planes.push([q[0], q[1], q[2], random.range(0.8, 0.98)]);
    const length = Math.hypot(q[0], q[1], q[2]) || 1;
    planes[i][0] /= length;
    planes[i][1] /= length;
    planes[i][2] /= length;
  }
  return icosphere(subdivisions, (x, y, z) => {
    const r =
      1 +
      (fbm(x * 1.6 + seed, y * 1.6, z * 1.6, 2) - 0.5) * 0.9 +
      (detailed ? (fbm(x * 4 + seed, y * 4, z * 4, 2) - 0.5) * 0.25 : 0);
    let px = x * r;
    let py = y * r * 0.8;
    let pz = z * r;
    // whatever sticks out past a plane is pushed back onto it
    for (const p of planes) {
      const d = px * p[0] + py * p[1] + pz * p[2] - p[3];
      if (d > 0) {
        px -= p[0] * d;
        py -= p[1] * d;
        pz -= p[2] * d;
      }
    }
    return [px, py, pz];
  });
}
