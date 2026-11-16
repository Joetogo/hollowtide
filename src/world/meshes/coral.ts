// Corals: tubes that branch three levels deep. A fan coral keeps its branches nearly in one plane.
import type { Level } from '../../config/quality';
import { MeshBuilder, type Point } from '../../math/mesh';
import type { Random } from '../../math/random';
import { clamp } from '../../math/scalar';
import { hypot3 } from '../../math/hypot';

type Vec = [number, number, number];
const unit = (v: Vec): Vec => {
  const length = hypot3(v[0], v[1], v[2]) || 1;
  return v.map((c) => c / length) as Vec;
};

/**
 * @param fan 0 for a bushy coral, 1 for a fan; also picks the random stream (200 + fan)
 * @param low straight three-sided tubes instead of curved round ones: on Low detail, and for the far-away mesh
 */
export function coral(random: Random, level: Level, fan: 0 | 1, low = level > 1): MeshBuilder {
  random.reseed(200 + fan);
  const mesh = new MeshBuilder();
  const branch = (from: Vec, direction: Vec, r: number, length: number, depth: number) => {
    const points: Vec[] = [from];
    let q = from;
    let d = direction;
    // three segments, the direction wandering as it goes (mostly upwards)
    for (let i = 0; i < 3; i++) {
      d = unit([
        d[0] + random.range(-0.3, 0.3),
        d[1] + random.range(-0.1, 0.3),
        d[2] + (fan ? random.range(-0.05, 0.05) : random.range(-0.3, 0.3)),
      ]);
      q = [q[0] + (d[0] * length) / 3, q[1] + (d[1] * length) / 3, q[2] + (d[2] * length) / 3];
      points.push(q);
    }
    // a twig gets a tapered tip
    if (!depth) points.push([q[0] + d[0] * r * 1.6, q[1] + d[1] * r * 1.6, q[2] + d[2] * r * 1.6]);
    // the extra value brightens towards the tips
    if (low) {
      const few: Point[] = depth ? [points[0], points[3]] : [points[0], points[3], points[4]];
      mesh.tube(
        few,
        (k) => (k > 1 ? r * 0.36 : r * (1 - 0.22 * k)) * 1.25,
        3,
        true,
        (k) => clamp(1 - (depth + 1 - k) / 5, 0, 1),
      );
    } else {
      mesh.tube(
        points,
        (k) => (k > 3 ? r * 0.36 : r * (1 - (0.22 * k) / 3)),
        fan ? 5 : 6,
        true,
        (k) => clamp(1 - (depth + 1 - k / 3) / 5, 0, 1),
      );
    }
    if (depth > 0) {
      const children = 2 + (random.next() < 0.5 ? 1 : 0);
      for (let i = 0; i < children; i++) {
        branch(
          q,
          unit([
            d[0] + random.range(-0.8, 0.8),
            d[1] + random.range(-0.1, 0.5),
            d[2] + (fan ? random.range(-0.08, 0.08) : random.range(-0.8, 0.8)),
          ]),
          r * 0.78,
          length * 0.8,
          depth - 1,
        );
      }
    }
  };
  const trunks = fan ? 1 : 2 + ((random.next() * 2) | 0);
  for (let i = 0; i < trunks; i++) {
    branch(
      [random.range(-0.08, 0.08), 0, random.range(-0.08, 0.08)],
      unit([random.range(-0.5, 0.5), 1, fan ? 0 : random.range(-0.5, 0.5)]),
      fan ? 0.06 : 0.08,
      fan ? 0.5 : 0.45,
      3,
    );
  }
  return mesh;
}
