// The world's two grids, in metres. Units: metres, y up, the water surface at y = 0.

/** The density grid the terrain is carved from: 512 x 80 x 512 voxels of 0.75 m, a box of 384 x 60 x 384 m. */
export const NX = 512;
export const NY = 80;
export const NZ = 512;
/** Voxel size in metres. */
export const VOXEL = 0.75;
/** World position of voxel (0, 0, 0). */
export const ORIGIN_X = -192;
export const ORIGIN_Y = -56;
export const ORIGIN_Z = -192;

/** The culling grid over the ground plane: 16 x 16 cells of 24 m. Everything scattered is sorted by cell. */
export const CELLS = 16;
export const CELL_SIZE = 24;
