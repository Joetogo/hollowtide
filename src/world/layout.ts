// The hand-authored layout of the world, carried over unchanged from the original (world.js and main.js).
// More tables (rock masses, arches, tunnels, biome discs, the camera path) join this file with the generator.

/** Centre of the purple grotto on the ground plane, in metres: [x, z]. */
export const GROTTO_CENTER: readonly [number, number] = [6, 84];

/**
 * The six preset viewpoints: eye x, height above the seabed, eye z, then the point looked at (x, y, z).
 * The generator dresses the scene around them and replaces the height with a world y once the seabed exists.
 */
export const VIEWPOINTS: readonly (readonly number[])[] = [
  [10, 1.3, 7, -9, -31, -10],
  [50, 1.3, 34, 58, -23, 8],
  [-26, 2.2, -100, 0, -9, -108],
  [-55, 1.5, -18, -60, -30, 8],
  [10, 1.2, -62, 6, -22, -90],
  [3, 1.6, 62, 1, -28, 100],
];
