import { describe, expect, it } from 'vitest';
import { createCamera, lookAt } from '../../src/camera/camera';
import { createCullView, updateCullView } from '../../src/render/cull';
import { TAN_HALF_FOV } from '../../src/render/frame';
import { ballInView } from '../../src/render/solids';

// Culling must never remove something that could be seen: a ball that is left out has to be wholly outside
// the view. Checked by brute force, with points on and inside the ball.
describe('ballInView', () => {
  let seed = 7;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
  const view = createCullView(createCamera());
  const visible = (x: number, y: number, z: number) => {
    const c = view.camera;
    const [dx, dy, dz] = [x - c.x, y - c.y, z - c.z];
    const forward = dx * c.fx + dy * c.fy + dz * c.fz;
    return (
      forward > 0 &&
      Math.abs(dx * c.rx + dz * c.rz) <= forward * TAN_HALF_FOV * view.aspect &&
      Math.abs(dx * c.ux + dy * c.uy + dz * c.uz) <= forward * TAN_HALF_FOV
    );
  };

  it('never leaves out a ball that reaches into the view, and does leave out most that do not', () => {
    let culled = 0;
    let wrong = 0;
    let outside = 0;
    for (let n = 0; n < 4000; n++) {
      if (n % 100 === 0) {
        const eye = [random() * 200 - 100, -random() * 50, random() * 200 - 100] as const;
        lookAt(view.camera, ...eye, eye[0] + random() - 0.5, eye[1] + random() - 0.5, eye[2] + random() - 0.5);
        updateCullView(view, 1280 + Math.floor(random() * 1280), 720, 1);
      }
      const radius = 0.2 + random() * random() * 12;
      const centre = [0, 1, 2].map((k) => [view.camera.x, view.camera.y, view.camera.z][k]! + (random() - 0.5) * 160);
      let seen = false;
      for (let p = 0; p < 150 && !seen; p++) {
        // a point in the ball: a random direction, at up to the radius
        const d = [random() - 0.5, random() - 0.5, random() - 0.5];
        const scale = (radius * (p % 3 ? 1 : random())) / Math.hypot(...d);
        seen = visible(centre[0]! + d[0]! * scale, centre[1]! + d[1]! * scale, centre[2]! + d[2]! * scale);
      }
      const kept = ballInView(view, centre[0]!, centre[1]!, centre[2]!, radius);
      if (!kept) culled++;
      if (!kept && seen) wrong++;
      if (!seen) outside++;
    }
    expect(wrong).toBe(0);
    expect(culled).toBeGreaterThan(outside * 0.85); // nearly everything outside is found to be outside
  });

  it('keeps a ball the camera is inside, and one straddling the edge of the view', () => {
    lookAt(view.camera, 0, -30, 0, 0, -30, -10);
    updateCullView(view, 1920, 1080, 1);
    expect(ballInView(view, 0, -30, 2, 5)).toBe(true); // centre behind the camera, but around it
    const edge = 20 * TAN_HALF_FOV * view.aspect; // the right edge of the view 20 m ahead
    expect(ballInView(view, edge + 1, -30, -20, 1.5)).toBe(true);
    expect(ballInView(view, edge + 4, -30, -20, 1.5)).toBe(false);
    expect(ballInView(view, 0, -30, 6, 5)).toBe(false); // wholly behind
  });
});
