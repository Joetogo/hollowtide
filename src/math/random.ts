// The generator's random numbers: mulberry32, restarted for every system so that each has its own stream.
//
// The world is defined by the order in which the generator draws from this, so that order is part of the design:
// a draw must never be added, removed, reordered or made conditional without meaning to change the world.

const BASE_SEED = 20261110;

export class Random {
  private seed = BASE_SEED;

  /** Starts over on the stream numbered `stream`. */
  reseed(stream: number): void {
    this.seed = (BASE_SEED + Math.imul(stream, 7919)) | 0;
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
