import { describe, expect, it } from 'vitest';
import { createCamera, lookAt } from '../../src/camera/camera';
import { flyPoint } from '../../src/camera/path';
import { createFrameData, Frame, writeFrame } from '../../src/render/frame';
import reference from './fixtures/reference-frames.json';

// reference-frames.json holds the original's uniform block at its six viewpoints (three times each) and at 30
// points of its fly-through, at 1280x720. It is exported from a reference capture: `npm run ref:capture`, then
// `node tools/reference/export-frames.mjs`.
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

  it('has the fly-through frames to compare against', () => {
    expect(reference.fly).toHaveLength(30);
  });

  for (const frame of reference.fly) {
    it(`follows the original's fly-through bit for bit: ${frame.id} at ${frame.seconds} s`, () => {
      const camera = createCamera();
      const p = new Float64Array(6);
      flyPoint(frame.seconds, p);
      lookAt(camera, p[0]!, p[1]!, p[2]!, p[3]!, p[4]!, p[5]!);
      const data = createFrameData();
      writeFrame(data, camera, frame.width, frame.height, frame.seconds, 1);
      const expected = new Float32Array(frame.uniforms);
      const differing = [...data.keys()].filter((i) => !Object.is(data[i], expected[i]));
      expect(differing.map((i) => `[${i}] ${data[i]} != ${expected[i]}`)).toEqual([]);
    });
  }
});
