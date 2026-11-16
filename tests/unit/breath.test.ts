import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BODY_TAN, BREATH_BUBBLES, createBreath, stepBreath, stepWash, type Breath } from '../../src/body/breath';
import { createCamera, lookAt } from '../../src/camera/camera';
import { Random } from '../../src/math/random';

const camera = createCamera();
lookAt(camera, 10, -20, 5, 10, -20, -5); // 20 m down, looking along -z
const live = (breath: Breath) => {
  const out: number[] = [];
  for (let i = 0; i < BREATH_BUBBLES; i++) if (breath.data[i * 8 + 3]! > 0) out.push(i);
  return out;
};
/** Runs the breathing for some seconds at 60 frames a second; returns how many breaths out began. */
function run(breath: Breath, from: number, seconds: number, effort = 0, breathing = true) {
  const random = new Random();
  random.reseed(9);
  let breaths = 0;
  for (let frame = 0; frame < seconds * 60; frame++) {
    stepBreath(breath, camera, from + frame / 60, 1 / 60, effort, breathing, () => random.next());
    if (breath.began) breaths++;
    breath.began = false;
  }
  return breaths;
}

describe('the swimmer breathes', () => {
  it('out every five or six seconds at rest, a run of bubbles each time, the first soon after the dive', () => {
    const breath = createBreath();
    expect(run(breath, 100, 2)).toBe(1);
    expect(breath.dirty).toBe(true);
    const first = live(breath).length;
    expect(first).toBeGreaterThan(8);
    expect(run(breath, 102, 20)).toBeGreaterThanOrEqual(3);
    expect(run(createBreath(), 100, 22)).toBeLessThanOrEqual(5);
    // about forty bubbles a breath
    expect(live(breath).length / 4).toBeGreaterThan(32);
    expect(live(breath).length / 4).toBeLessThan(44);
  });

  it('faster when working', () => {
    expect(run(createBreath(), 0, 40, 1)).toBeGreaterThan(run(createBreath(), 0, 40, 0) + 3);
  });

  it('each bubble starts by the cheeks, left and right in turn, and at that moment has just begun its climb', () => {
    const breath = createBreath();
    const at = new Map<number, number>();
    const random = new Random();
    for (let frame = 0; frame < 4 * 60; frame++) {
      const before = new Set(live(breath));
      const time = 50 + frame / 60;
      stepBreath(breath, camera, time, 1 / 60, 0, true, () => random.next());
      for (const i of live(breath)) if (!before.has(i)) at.set(i, time);
    }
    expect(at.size).toBeGreaterThan(15);
    let [left, right] = [0, 0];
    for (const [i, time] of at) {
      const [x, y, z, size, phase, speed, height, wobble] = breath.data.subarray(
        i * 8,
        i * 8 + 8,
      ) as unknown as number[];
      // a hand's width to either side, below the eyes, a hand's length ahead (the camera looks along -z)
      expect(Math.abs(x! - 10)).toBeGreaterThan(0.1);
      expect(Math.abs(x! - 10)).toBeLessThan(0.14);
      if (x! > 10) right++;
      else left++;
      expect(y! + 20).toBeLessThan(-0.1);
      expect(y! + 20).toBeGreaterThan(-0.14);
      expect(5 - z!).toBeGreaterThan(0.16);
      expect(5 - z!).toBeLessThan(0.22);
      expect(size! > 0.003 && size! < 0.02).toBe(true);
      expect(wobble).toBeGreaterThan(0);
      // the climb is to the surface, and where the shader has it along that climb at this moment is the start
      expect(height).toBeCloseTo(-y!, 5);
      const turns = (time * speed!) / height! + phase!;
      expect(turns - Math.floor(turns)).toBeLessThan(0.004);
      expect(breath.expires[i]).toBeGreaterThan(time + (height! / speed!) * 0.98);
      expect(breath.expires[i]).toBeLessThan(time + height! / speed!);
    }
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  });

  it('holding the breath lets none go; those already rising are cleared when they reach the surface', () => {
    const breath = createBreath();
    expect(run(breath, 0, 6, 0, false)).toBe(0);
    expect(live(breath)).toEqual([]);
    run(breath, 6, 3);
    const rising = live(breath).length;
    expect(rising).toBeGreaterThan(10);
    breath.dirty = false;
    // 20 m at a third of a metre a second or more: all are up within the minute
    run(breath, 9, 70, 0, false);
    expect(live(breath)).toEqual([]);
    expect(breath.dirty).toBe(true);
  });

  it('never more than there are places for: the oldest make way', () => {
    const breath = createBreath();
    run(breath, 0, 120, 1);
    expect(live(breath).length).toBeLessThanOrEqual(BREATH_BUBBLES);
    expect(breath.next).toBeLessThan(BREATH_BUBBLES);
  });
});

describe('the hands churn the water', () => {
  // right and left wrists in view space, half a metre ahead, fingers pointing ahead
  const hands = [
    { wrist: [0.3, -0.2, -0.5], fingers: [0, 0, -1] },
    { wrist: [-0.3, -0.2, -0.5], fingers: [0, 0, -1] },
  ];
  const wash = (pull: number, scull: number, seconds: number) => {
    const breath = createBreath();
    const random = new Random();
    for (let frame = 0; frame < seconds * 60; frame++)
      stepWash(breath, camera, 30 + frame / 60, 1 / 60, hands, pull, scull, 0.6, () => random.next());
    return breath;
  };

  it('the shader draws the body through the lens assumed here', () => {
    const source = readFileSync('src/shaders/body.wgsl', 'utf8');
    expect(+source.match(/const BODY_TAN = ([\d.]+);/)![1]!).toBe(BODY_TAN);
  });

  it('on a pull, some twenty small bubbles off each hand in less than half a second; at rest, none', () => {
    expect(live(wash(0, 0, 2))).toEqual([]);
    const breath = wash(1, 0, 0.4);
    const count = live(breath).length;
    expect(count).toBeGreaterThanOrEqual(34);
    expect(count).toBeLessThanOrEqual(38);
    expect(count % 2).toBe(0); // one off each hand at a time
    // while sculling, a few a second
    const idle = live(wash(0, 1, 2)).length;
    expect(idle).toBeGreaterThanOrEqual(10);
    expect(idle).toBeLessThanOrEqual(14);
  });

  it('each starts along a hand, where the hand is seen, and is gone again within a few metres', () => {
    const breath = wash(1, 0, 0.4);
    const lens = 0.6 / BODY_TAN;
    let [left, right] = [0, 0];
    for (const i of live(breath)) {
      const [x, y, z, size, , speed, height] = breath.data.subarray(i * 8, i * 8 + 8) as unknown as number[];
      // the camera is at (10, -20, 5) looking along -z: right is +x, up is +y, ahead is -z
      const across = (x! - 10) / lens;
      expect(Math.abs(Math.abs(across) - 0.3)).toBeLessThan(0.03);
      if (across > 0) right++;
      else left++;
      expect(Math.abs((y! + 20) / lens + 0.2)).toBeLessThan(0.03);
      // from the wrist (0.5 m ahead) to the fingertips
      expect(5 - z!).toBeGreaterThan(0.52);
      expect(5 - z!).toBeLessThan(0.68);
      expect(size! < 0.0065 && size! > 0.0015).toBe(true);
      expect(height).toBeLessThanOrEqual(2.8);
      expect(height! / speed!).toBeLessThan(15); // seconds
    }
    expect(left).toBe(right);
  });
});
