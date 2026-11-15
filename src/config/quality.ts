// Detail levels: the same world, built and drawn with less. What the generator thins out (leaves, glints,
// pebbles, coarser meshes on Low) is decided when the world is generated; this is what the renderer needs.

export type Level = 0 | 1 | 2;

export interface Quality {
  /** 0 High, 1 Medium, 2 Low. */
  readonly level: Level;
  /** Samples per pixel in the scene pass: 4, or 1 (no anti-aliasing) on Low. */
  readonly samples: 1 | 4;
  /** Shadow map size in texels. */
  readonly shadowSize: number;
  /** Water texture size in texels. */
  readonly waterSize: number;
  /** Steps of the light-shaft march per pixel. */
  readonly raySteps: number;
  /** Small rocks, sponges and corals cast shadows (about 35 million triangles in the bake): High only. */
  readonly detailShadows: boolean;
  /** Cheaper filtering: one shadow tap instead of nine, no anisotropic filtering. */
  readonly low: boolean;
}

export function quality(level: Level): Quality {
  const low = level > 1;
  return {
    level,
    samples: low ? 1 : 4,
    shadowSize: level ? 2048 : 4096,
    waterSize: low ? 256 : 512,
    raySteps: low ? 12 : 34,
    detailShadows: level === 0,
    low,
  };
}
