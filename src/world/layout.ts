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

// ---- the rock: what the density field is built from (src/shaders/density.wgsl)

/** Designed rock masses, each a wall or pillar over a footprint segment: ax, az, bx, bz, radius, top y, overhang, waist. */
export const ROCK_MASSES: readonly (readonly number[])[] = [
  // west wall of the main canyon
  [-37, -42, -33, -22, 9, -7, 3.5, 2],
  [-29, -15, -33, 5, 12, -14, 3, 2],
  [-36, 11, -30, 27, 9, -5, 4, 2],
  // east wall
  [30, -45, 35, -27, 9, -9, 4, 2],
  [37, -20, 31, -3, 11, -16, 3, 2],
  [32, 5, 35, 9, 7, -8, 4, 2],
  [19, -15, 19, -15, 4.4, -6, 2, 1.5], // pillar with a window
  [6, -88, 6, -88, 10, -34, 0, 0], // mound in the kelp basin
  [0, -106, 0, -106, 8, 3, 2, 2], // pillar reaching the surface
  [44, 6, 47, -8, 7, -17, 3, 1], // ship supports
  [33, 29, 37, 12, 9, -19, -6.5, 0], // sloped sunlit wall beside the wreck
  [74, 14, 74, 14, 8, -15, 3, 1],
  // sponge canyon west wall
  [-84, -34, -80, -12, 10, -7, 6, 2],
  [-78, -6, -83, 12, 12, -13, 5, 2],
  [-82, 18, -79, 32, 9, -8, 6, 2],
  // grotto overhang cliff
  [-17, 62, -19, 78, 10, -6, 9, 3],
  [-21, 84, -18, 100, 11, -9, 8, 3],
  [22, 67, 24, 80, 7, -11, 6, 2], // grotto coral rock
  [-16, 122, 34, 122, 9, -27, 3, 2], // grotto far wall
];

/** Upright ring arches: centre x, y, z, yaw, ring radius, tube radius, vertical squash. */
export const ARCHES: readonly (readonly number[])[] = [
  [-23, -9.5, -16, 0.3, 4.2, 1.4, 1.2],
  [0, -45, -34, 1.57, 14, 2.7, 1.2],
  [-40, -45, 44, 1.57, 10, 2.2, 1.3],
];

/** Carved tunnels: start x, y, z, radius, end x, y, z. */
export const TUNNELS: readonly (readonly number[])[] = [
  [19, -21, -23, 2.5, 19, -21, -7],
  [9, -37, 108, 4.2, 9, -34, 136],
];

/** Regions kept free of the random plateaus: ax, az, bx, bz, radius, softness. */
export const CLEARINGS: readonly (readonly number[])[] = [
  [0, -45, 0, 35, 22, 10],
  [0, -86, 0, -86, 46, 12],
  [42, 24, 74, 6, 22, 10],
  [72, -26, 72, -26, 26, 10],
  [-60, -36, -60, 36, 13, 8],
  [-60, 42, -18, 46, 12, 8],
  [4, 58, 8, 100, 24, 10],
  [-34, -74, -56, -46, 11, 8],
];

/** Discs of magenta ground cover: x, z, radius. */
export const MAGENTA_PATCHES: readonly (readonly number[])[] = [
  [14, 6, 13],
  [-4, 20, 9],
  [6, 84, 30],
  [-58, 8, 10],
  [50, 30, 12],
  [8, -70, 10],
  [-12, -98, 9],
  [-36, 44, 9],
  [-46, -60, 9],
  [24, 42, 8],
  [-56, 26, 9],
  [-44, 38, 8],
  [-10, 44, 8],
  [12, 24, 8],
  [-50, -45, 8],
];
