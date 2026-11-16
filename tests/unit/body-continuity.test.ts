import { describe, expect, it } from 'vitest';
import { createBodyParts, createBodyState, poseBody } from '../../src/body/rig';
import { ARM_BONES, BONES } from '../../src/body/skeleton';

// Nothing about the arms may jump: every bone must carry a point of its own shape smoothly from one moment of
// the stroke to the next (a jump would show as the sleeve or a finger snapping round).
describe('the stroke, bone by bone', () => {
  const carried = (phase: number, swim: number, scullClock = 0) => {
    const parts = createBodyParts();
    poseBody({ ...createBodyState(), shown: 1, swim, phase, scullClock }, parts);
    // where each bone takes a point a few centimetres off its bind-pose axis
    const out: number[][] = [];
    const s = parts.skin;
    for (let b = 0; b < ARM_BONES * 2; b++) {
      const [x, y, z, w] = [s[b * 4]!, s[b * 4 + 1]!, s[b * 4 + 2]!, s[b * 4 + 3]!];
      const v = [0.03, 0.3 + (b % ARM_BONES) * 0.01, 0.02];
      const cx = y * v[2]! - z * v[1]! + w * v[0]!;
      const cy = z * v[0]! - x * v[2]! + w * v[1]!;
      const cz = x * v[1]! - y * v[0]! + w * v[2]!;
      const t = (BONES + b) * 4;
      out.push([
        v[0]! + 2 * (y * cz - z * cy) + s[t]!,
        v[1]! + 2 * (z * cx - x * cz) + s[t + 1]!,
        v[2]! + 2 * (x * cy - y * cx) + s[t + 2]!,
      ]);
    }
    return out;
  };
  const largestStep = (a: number[][], b: number[][]) =>
    Math.max(...a.map((p, i) => Math.hypot(p[0]! - b[i]![0]!, p[1]! - b[i]![1]!, p[2]! - b[i]![2]!)));

  it('has no jump anywhere in a stroke, the wrap included', () => {
    let worst = 0;
    let where = 0;
    let last = carried(0.9995, 1);
    for (let i = 0; i < 2000; i++) {
      const now = carried(i / 2000, 1);
      const step = largestStep(now, last);
      if (step > worst) [worst, where] = [step, i / 2000];
      last = now;
    }
    // a two-thousandth of a stroke is under a millisecond: nothing moves a centimetre in that
    expect(worst, `largest step at phase ${where}`).toBeLessThan(0.01);
  });

  it('has none between rest and stroke, or in the sculling', () => {
    let worst = 0;
    let last = carried(0.3, 0);
    for (let i = 1; i <= 500; i++) {
      const now = carried(0.3, i / 500);
      worst = Math.max(worst, largestStep(now, last));
      last = now;
    }
    last = carried(0, 0, 0);
    for (let i = 1; i <= 2000; i++) {
      const now = carried(0, 0, (i / 2000) * Math.PI * 4);
      worst = Math.max(worst, largestStep(now, last));
      last = now;
    }
    expect(worst).toBeLessThan(0.01);
  });
});
