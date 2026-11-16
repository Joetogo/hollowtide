// The generator's random numbers: mulberry32, restarted for every system so that each has its own stream.
//
// The world is defined by the order in which the generator draws from this, so that order is part of the design:
// a draw must never be added, removed, reordered or made conditional without meaning to change the world.

const BASE_SEED = 20261110;

/**
 * Where the streams start for a world asked for by number: 0 is the world as authored, any other whole number
 * another world of the same kind.
 */
export const seedBase = (seed: number): number =>
  seed ? (BASE_SEED ^ Math.imul((seed | 0) + 0x7f4a7c15, 0x9e3779b1)) | 0 : BASE_SEED;

export class Random {
  private seed: number;

  /** `base`: where its streams start (seedBase), the authored world's by default. */
  constructor(private readonly base = BASE_SEED) {
    this.seed = base;
  }

  /** Starts over on the stream numbered `stream`. */
  reseed(stream: number): void {
    this.seed = (this.base + Math.imul(stream, 7919)) | 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.seed = (this.seed + 0x6d2b79f5) | 0;
    let t = Math.imul(this.seed ^ (this.seed >>> 15), 1 | this.seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
}
