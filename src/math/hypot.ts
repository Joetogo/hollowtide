// Math.hypot, written out. The generator takes tens of millions of lengths, and in V8 the built-in is a
// generic routine for any number of arguments that costs about nine times what the arithmetic does.
//
// These are that routine's arithmetic for two and three arguments, step for step: the largest magnitude is
// divided out, the squares are added with a running compensation for the rounding of each addition, and the
// root is scaled back. Same steps, same bits: tests/unit/hypot.test.ts compares them with Math.hypot over
// millions of values, and the generator's checksums are still the original's. (An engine with a different
// Math.hypot gets V8's result here, which only makes the world more alike across browsers.)
// Not for NaN or infinities, which the generator never has.

export function hypot2(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  const max = a > b ? a : b;
  if (max === 0) return 0;
  let n = a / max;
  let summand = n * n;
  const sum = summand;
  const compensation = sum - summand;
  n = b / max;
  summand = n * n - compensation;
  return Math.sqrt(sum + summand) * max;
}

export function hypot3(a: number, b: number, c: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  c = Math.abs(c);
  let max = a > b ? a : b;
  if (c > max) max = c;
  if (max === 0) return 0;
  let n = a / max;
  let summand = n * n;
  let sum = summand;
  let compensation = sum - summand;
  n = b / max;
  summand = n * n - compensation;
  const preliminary = sum + summand;
  compensation = preliminary - sum - summand;
  sum = preliminary;
  n = c / max;
  summand = n * n - compensation;
  return Math.sqrt(sum + summand) * max;
}
