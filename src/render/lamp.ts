// The swimmer's lamp: a cone of light every scene shader can add to what it draws (shaders/common/scene.wgsl:
// lampLight). It is the scooter's headlamp while the scooter is out, and a torch held by the head otherwise.
// With `power` 0, as it is unless it is switched on, the shaders skip it and draw what they always drew.
import type { Camera } from '../camera/camera';
import { struct } from '../gpu/struct';

export const Lamp = struct('Lamp', {
  pos: 'vec3f',
  power: 'f32', // 0: off
  dir: 'vec3f',
  cone: 'f32', // cosine of the angle from its axis at which the light has gone
});

/**
 * Full power: about four times the noon sun on something three metres away, and still more than half of the
 * noon sun at ten. (It was 2.2, falling off faster: bright at arm's length and all but gone on what one swims
 * towards, eight or ten metres off, which is where one points it.)
 */
export const LAMP_POWER = 2.6;
/** The light is gone 31 degrees off the axis. */
export const LAMP_CONE = Math.cos((31 * Math.PI) / 180);

export const createLampData = (): Float32Array => {
  const data = new Float32Array(Lamp.size / 4);
  data[Lamp.at.dir + 2] = -1;
  data[Lamp.at.cone] = LAMP_CONE;
  return data;
};

/**
 * Points the lamp where the camera looks (its basis must be up to date). `level` 0..1 is how far it is switched
 * on; `scooter` 0..1 how far the scooter is out: the light moves from beside the head to the scooter's nose,
 * low and ahead. Either way it is not at the eye: light from exactly where one looks from shows no shape.
 */
export function aimLamp(data: Float32Array, camera: Camera, level: number, scooter: number): void {
  const { pos, power, dir, cone } = Lamp.at;
  const right = 0.16 * (1 - scooter);
  const up = -0.1 - 0.2 * scooter;
  const ahead = 0.1 + 0.8 * scooter;
  data[pos] = camera.x + camera.rx * right + camera.ux * up + camera.fx * ahead;
  data[pos + 1] = camera.y + camera.uy * up + camera.fy * ahead;
  data[pos + 2] = camera.z + camera.rz * right + camera.uz * up + camera.fz * ahead;
  data[power] = LAMP_POWER * level;
  data[dir] = camera.fx;
  data[dir + 1] = camera.fy;
  data[dir + 2] = camera.fz;
  data[cone] = LAMP_CONE;
}
