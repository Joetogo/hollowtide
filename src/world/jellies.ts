// Where the jellyfish are. Not part of the generated world (the original has none, and the generator's output
// is held to the original's): placed when the page starts, in the open water the scripted flight passes through.
import { flyPoint } from '../camera/path';
import { Random } from '../math/random';
import { rockDistance, type CollisionField } from './collision';

/** Seconds along the flight at which a group drifts. */
const GROUPS = [4, 11, 17, 24, 30, 37, 44, 51, 57];
/** Floats a jelly. */
export const JELLY_FLOATS = 8;

/** Is there a metre of water (all the collision field can say) on every side of a box round a point? */
export function openWater(field: CollisionField, x: number, y: number, z: number, across: number, up: number): boolean {
  // the field covers the middle of the world, from the seabed to the surface
  if (Math.abs(x) + across > 150 || Math.abs(z) + across > 150 || y - up < -54 || y + up > -2.5) return false;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      for (let k = -1; k <= 1; k++) {
        if (rockDistance(field, x + i * across, y + j * up, z + k * across) > -0.85) return false;
      }
    }
  }
  return true;
}

/**
 * Eight floats a jelly: home x, y, z and the bell's radius; a seed, how far it drifts from home, a colour key,
 * how fast it beats. `viewpoints` are the six viewpoints (eye, then what it looks at): the first has a group
 * ahead of it, so that there is something alive in view on waking. A jelly is only put where it has open water
 * all round the loop it drifts on; one that cannot be found such a place is left out.
 */
export function placeJellies(viewpoints: readonly (readonly number[])[], field: CollisionField): Float32Array {
  const random = new Random();
  random.reseed(400); // a stream of their own
  const out: number[] = [];
  const group = (x: number, y: number, z: number, spread: number, count: number) => {
    for (let i = 0; i < count; i++) {
      // most are small; one in a while is the size of a wheel
      const size = 0.1 + 0.42 * random.next() ** 3;
      const drift = random.range(0.5, 1.8);
      const jelly = [random.next(), drift, random.next(), random.range(0.55, 0.9) * (0.75 + 0.1 / size)];
      for (let attempt = 0; attempt < 12; attempt++) {
        const angle = random.next() * Math.PI * 2;
        const away = spread * Math.sqrt(random.next());
        const [hx, hy, hz] = [
          x + Math.cos(angle) * away,
          y + random.range(-0.4, 0.4) * spread,
          z + Math.sin(angle) * away,
        ];
        // the bell, on its loop: `drift` to each side, a third of that and its own bobbing up and down
        if (!openWater(field, hx, hy, hz, drift + size, 0.3 * drift + 1.2 * size)) continue;
        out.push(hx, hy, hz, size, ...jelly);
        break;
      }
    }
  };
  const point = new Float64Array(6);
  for (const seconds of GROUPS) {
    flyPoint(seconds, point);
    // off to one side of the flight and a little above it
    const angle = random.next() * Math.PI * 2;
    const aside = random.range(2, 6);
    group(
      point[0]! + Math.cos(angle) * aside,
      point[1]! + random.range(1, 4),
      point[2]! + Math.sin(angle) * aside,
      random.range(4, 8),
      7 + Math.floor(random.next() * 8),
    );
  }
  const first = viewpoints[0];
  if (first) {
    // some way along the first viewpoint's line of sight, above it
    const [ex, ey, ez, tx, ty, tz] = first as [number, number, number, number, number, number];
    const length = Math.hypot(tx - ex, ty - ey, tz - ez) || 1;
    const ahead = 13 / length;
    group(ex + (tx - ex) * ahead, ey + (ty - ey) * ahead + 2.5, ez + (tz - ez) * ahead, 5, 10);
  }
  return new Float32Array(out);
}
