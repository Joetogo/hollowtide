// How far things are drawn, and how the small stuff is thinned out. Two sets of numbers:
//
//   faithful   the original's, to the letter. The tests that compare frames with the original draw with these.
//   tuned      what ships. A profile of the frame (tests/browser/profile.mjs) showed where the time goes on a
//              laptop GPU: ground cover out to 70 m, pebbles and rock chips nobody can make out, glints that
//              are all sent to the GPU wherever the camera looks. These numbers pull that in, each behind a fade
//              that already existed, so nothing pops.

export interface Tuning {
  readonly name: 'faithful' | 'tuned';
  /** how far ground cover (the small leaves) is drawn, metres */
  readonly smallLeafDistance: number;
  /** kelp and tall plants: where the fullest blades end, where the middle band ends, where the last ends */
  readonly leafNear: number;
  readonly leafMid: number;
  readonly leafFar: number;
  /** rock chips and pebbles shrink away at this share of the distance the generator gave them */
  readonly rockFade: number;
  /** a kelp blade's curl passes through zero smoothly (the original flicks it across: see shaders/leaf.wgsl) */
  readonly smoothBend: boolean;
  /** glints and bubbles are sorted into the culling cells, and only those that can be seen are drawn */
  readonly cullSprites: boolean;
  /** glints have faded out by this distance, metres (the shader drops them past 120 m in any case) */
  readonly glintDistance: number;
  /** jellyfish drift in the open water (the original has none) */
  readonly jellies: boolean;
  /** fish keep clear of the swimmer within this many metres, a school opening to let them through (0: they do not) */
  readonly fishPart: number;
}

export const FAITHFUL: Tuning = {
  name: 'faithful',
  smallLeafDistance: 70,
  leafNear: 24,
  leafMid: 58,
  leafFar: 150,
  rockFade: 1,
  smoothBend: false,
  cullSprites: false,
  glintDistance: 150,
  jellies: false,
  fishPart: 0,
};

export const TUNED: Tuning = {
  name: 'tuned',
  smallLeafDistance: 44,
  leafNear: 22,
  leafMid: 52,
  leafFar: 132,
  rockFade: 0.72,
  smoothBend: true,
  cullSprites: true,
  glintDistance: 96,
  jellies: true,
  fishPart: 3.6,
};
