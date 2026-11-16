import { describe, expect, it } from 'vitest';
import { createCamera, lookAt } from '../../src/camera/camera';
import { aimLamp, createLampData, Lamp, LAMP_CONE, LAMP_POWER } from '../../src/render/lamp';

describe('the lamp', () => {
  it('is 32 bytes: where, how bright, which way, how wide', () => {
    expect(Lamp.size).toBe(32);
    expect([Lamp.at.pos, Lamp.at.power, Lamp.at.dir, Lamp.at.cone]).toEqual([0, 3, 4, 7]);
  });

  it('is off until it is switched on', () => {
    const data = createLampData();
    expect(data[Lamp.at.power]).toBe(0);
    expect(data[Lamp.at.cone]).toBeCloseTo(LAMP_CONE, 6);
    // and still has a direction, so that nothing divides by nothing in a shader that reads it anyway
    expect(Math.hypot(data[Lamp.at.dir]!, data[Lamp.at.dir + 1]!, data[Lamp.at.dir + 2]!)).toBe(1);
  });

  it('shines where the camera looks, from beside the head, or from the scooter low and ahead', () => {
    const camera = createCamera();
    lookAt(camera, 10, -20, 5, 10, -20, -5); // looking along -z
    const data = createLampData();
    aimLamp(data, camera, 1, 0);
    const [x, y, z, power, dx, dy, dz] = data;
    expect(power).toBeCloseTo(LAMP_POWER, 6);
    expect([dx, dy, dz].map((v) => Math.round(v! * 1e6) / 1e6)).toEqual([0, 0, -1]);
    // a hand's width to the right and a little below the eye: light from the eye itself would show no shape
    expect(x! - 10).toBeCloseTo(0.16, 5);
    expect(y! + 20).toBeCloseTo(-0.1, 5);
    expect(Math.abs(z! - 5)).toBeLessThan(0.2);

    aimLamp(data, camera, 0.5, 1);
    expect(data[Lamp.at.power]).toBeCloseTo(LAMP_POWER / 2, 6);
    expect(data[0]! - 10).toBeCloseTo(0, 5);
    expect(data[1]! + 20).toBeCloseTo(-0.3, 5);
    expect(5 - data[2]!).toBeCloseTo(0.9, 5);
  });
});
