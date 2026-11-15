import { describe, expect, it } from 'vitest';
import { createCamera, lookAt } from '../../src/camera/camera';
import { createFrameData, Frame, writeFrame } from '../../src/render/frame';
import reference from './fixtures/reference-frames.json';

// reference-frames.json holds the original's uniform block for its six viewpoints at three times, at 1280x720.
// It is exported from a reference capture: `npm run ref:capture`, then the frames of manifest.json.
describe('frame uniforms', () => {
  it('is the 240-byte block the shaders were written against', () => {
    expect(Frame.size).toBe(240);
    expect(reference.frames).toHaveLength(18);
  });

  for (const frame of reference.frames) {
    it(`matches the original bit for bit: ${frame.id}`, () => {
      const camera = createCamera();
      const [x, y, z, tx, ty, tz] = reference.poses[frame.pose] as [number, number, number, number, number, number];
      lookAt(camera, x, y, z, tx, ty, tz);
      const data = createFrameData();
      writeFrame(data, camera, frame.width, frame.height, frame.time, 1);
      const expected = new Float32Array(frame.uniforms);
      const differing = [...data.keys()].filter((i) => !Object.is(data[i], expected[i]));
      expect(differing.map((i) => `[${i}] ${data[i]} != ${expected[i]}`)).toEqual([]);
    });
  }
});
