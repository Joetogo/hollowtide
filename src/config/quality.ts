// Detail levels. Only what the renderer needs so far; thinning, shadow size and the rest arrive with the passes
// that use them.

export interface Quality {
  /** 0 High, 1 Medium, 2 Low. */
  readonly level: 0 | 1 | 2;
  /** Samples per pixel in the scene pass: 4, or 1 (no anti-aliasing) on Low. */
  readonly samples: 1 | 4;
}

export function quality(level: 0 | 1 | 2): Quality {
  return { level, samples: level > 1 ? 1 : 4 };
}
