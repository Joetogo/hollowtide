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

/**
 * The scripted camera path: 25 points of eye xyz and look-at xyz, flown in 60 s as a Catmull-Rom spline. The
 * generator keeps it clear of kelp; the tour and the benchmark fly along it. Stored as 32-bit floats, as the
 * original does: the path's exact shape depends on that rounding.
 */
export const FLY_PATH = new Float32Array([
  10, -42.2, 7, -9, -31, -10, 7.5, -41.8, 5.5, -10, -31, -12, 9, -40.5, 18, 17, -37, 42, 22, -39.2, 40, 48, -36, 45, 38,
  -39.2, 46, 57, -27, 18, 50, -40.4, 35, 58, -24, 8, 55, -39, 20, 60, -18, -10, 58, -34, -12, 40, -26, -60, 50, -30,
  -44, 10, -26, -80, 30, -30, -70, 4, -28, -90, 12, -38.5, -62, 6, -27, -90, -4, -36.5, -70, 0, -14, -100, -16, -37,
  -84, 0, -22, -108, -29, -38, -90, -44, -34, -60, -41, -38, -70, -56, -34, -40, -53, -38, -50, -60, -34, -20, -58, -38,
  -28, -60, -32, 0, -57, -38, -10, -60, -30, 16, -60, -38, 10, -50, -36, 40, -52, -37, 36, -20, -35, 44, -22, -38, 43,
  4, -38, 52, -6, -39.2, 44.5, 4, -37, 70, 3, -40.6, 53, 3, -35, 84, 3, -41.5, 62, 1, -30, 100, 4, -39, 76, 3, -22, 100,
]);
