// Small numeric helpers for the world generator.

export const TAU = Math.PI * 2;

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Smoothstep that also takes its edges in descending order (a > b): then it falls from 1 to 0. */
export const smoothRamp = (a: number, b: number, x: number): number => {
  x = clamp((x - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};
