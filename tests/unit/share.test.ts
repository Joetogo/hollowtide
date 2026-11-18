import { describe, expect, it } from 'vitest';
import { createCamera } from '../../src/camera/camera';
import { viewFromHash, viewToHash } from '../../src/camera/share';

const at = (x: number, y: number, z: number, yaw: number, pitch: number) =>
  Object.assign(createCamera(), { x, y, z, yaw, pitch });
const DEGREE = Math.PI / 180;

describe('a link to a view', () => {
  it('is five numbers at noon without the lamp, as it always was', () => {
    expect(viewToHash(at(50.94, -40.44, 33.46, 15 * DEGREE, 31 * DEGREE))).toBe('#at=50.9,-40.4,33.5,15,31');
    expect(viewToHash(at(1, -20, 2, -90 * DEGREE, 0), 'noon', false)).toBe('#at=1.0,-20.0,2.0,270,0');
  });

  it('says what the place was seen in: the light, and the lamp', () => {
    const camera = at(52.7, -35.8, 25.4, 17 * DEGREE, 35 * DEGREE);
    expect(viewToHash(camera, 'moon', true)).toBe('#at=52.7,-35.8,25.4,17,35,moon,lamp');
    expect(viewToHash(camera, 'dusk')).toBe('#at=52.7,-35.8,25.4,17,35,dusk');
    expect(viewToHash(camera, 'noon', true)).toBe('#at=52.7,-35.8,25.4,17,35,lamp');
  });

  it('is read back as it was written', () => {
    for (const [light, lamp] of [
      ['noon', false],
      ['dusk', false],
      ['moon', true],
      ['noon', true],
    ] as const) {
      const view = viewFromHash(viewToHash(at(52.7, -35.8, 25.4, 17 * DEGREE, -35 * DEGREE), light, lamp))!;
      expect(view.slice(0, 3)).toEqual([52.7, -35.8, 25.4]);
      expect(view[3]).toBeCloseTo(17 * DEGREE, 10);
      expect(view[4]).toBeCloseTo(-35 * DEGREE, 10);
      expect(view.slice(5)).toEqual([light, lamp]);
    }
  });

  it('is noon and no lamp when it says neither: a link from before it could', () => {
    expect(viewFromHash('#at=50.9,-40.4,33.5,15,31')!.slice(5)).toEqual(['noon', false]);
  });

  it('is not followed when it is not a view', () => {
    for (const hash of [
      '',
      '#at=',
      '#at=1,-20,2,3', // four numbers
      '#at=1,-20,2,3,4,5', // six
      '#at=1,-20,2,3,4,sun', // no such light
      '#at=1,-20,2,3,4,lamp,moon', // the light comes first
      '#at=1,-20,2,3,4,moon,dusk',
      '#at=1,-20,2,3,4,', // a comma left over
      '#at=1,-20,2,3,x',
      '#at=400,-20,2,3,4', // outside the world
      '#at=1,5,2,3,4', // above the water
      '#at=1,-20,2,3,95', // looking further up than straight up
      '#elsewhere',
    ]) {
      expect(viewFromHash(hash), hash).toBeNull();
    }
  });
});
