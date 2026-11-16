// The boulders, the ship and the whale tail are not sorted into culling cells: there are only some 1,400 of
// them, but at thousands of triangles each they were a sixth of everything drawn, wherever the camera looked.
// So each is tested against the view by a ball around it, every frame, and those that may be seen are copied to
// a small buffer in their original order. Leaving out what cannot be seen and keeping the order of the rest
// cannot change a pixel.
import type { Gpu } from '../gpu/context';
import { SOLID_BYTES, VERTEX_BYTES, type WorldData } from '../world/data';
import type { CullView } from './cull';
import { TAN_HALF_FOV } from './frame';
import { hypot3 } from '../math/hypot';

const FLOATS = SOLID_BYTES / 4;

/**
 * Whether any of a ball can be in view. Errs on the side of yes: the ball is tested against the four sides of
 * the view and the plane through the camera, never against the corners.
 */
export function ballInView(view: CullView, x: number, y: number, z: number, radius: number): boolean {
  const { camera } = view;
  const dx = x - camera.x;
  const dy = y - camera.y;
  const dz = z - camera.z;
  const forward = dx * camera.fx + dy * camera.fy + dz * camera.fz;
  if (forward < -radius) return false;
  const tanY = TAN_HALF_FOV * camera.wide;
  const tanX = tanY * view.aspect;
  // how far outside a side plane the centre is, measured across the view: the plane is tilted, so the ball
  // reaches further across than its radius
  if (Math.abs(dx * camera.rx + dz * camera.rz) - forward * tanX > radius * Math.sqrt(1 + tanX * tanX)) return false;
  return (
    Math.abs(dx * camera.ux + dy * camera.uy + dz * camera.uz) - forward * tanY <= radius * Math.sqrt(1 + tanY * tanY)
  );
}

export interface SolidCull {
  /** The instances that may be in view, grouped by mesh, each group in its original order. */
  buffer: GPUBuffer;
  /**
   * Tests every solid against the view and uploads those that may be seen.
   * @returns [first instance, count] for each mesh, in an array that is reused by the next call
   */
  update(view: CullView): Uint32Array;
  destroy(): void;
}

export function createSolidCull(gpu: Gpu, data: WorldData): SolidCull {
  const { instances, ranges } = data.solids;
  const count = instances.length / FLOATS;

  // a ball around each: the mesh's reach from its origin at the instance's scale, plus how far the instance
  // bobs up and down (floating boulders), plus a little so that rounding cannot cost a pixel
  const balls = new Float32Array(count * 4);
  ranges.forEach(([first, n], mesh) => {
    if (!n) return;
    const { firstVertex, vertexCount } = data.meshes.ranges[mesh]!;
    const vertices = data.meshes.vertices;
    const positions = new Float32Array(
      vertices.buffer,
      vertices.byteOffset + firstVertex * VERTEX_BYTES,
      vertexCount * (VERTEX_BYTES / 4),
    );
    let reach = 0;
    for (let v = 0; v < positions.length; v += VERTEX_BYTES / 4)
      reach = Math.max(reach, hypot3(positions[v]!, positions[v + 1]!, positions[v + 2]!));
    for (let i = first; i < first + n; i++) {
      const o = i * FLOATS;
      balls.set([instances[o]!, instances[o + 1]!, instances[o + 2]!], i * 4);
      balls[i * 4 + 3] = (instances[o + 3]! * reach + Math.abs(instances[o + 11]!)) * 1.001 + 0.01;
    }
  });

  const buffer = gpu.device.createBuffer({
    label: 'solids in view',
    size: Math.max(1, count) * SOLID_BYTES,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  const staging = new Float32Array(count * FLOATS);
  const visible = new Uint32Array(ranges.length * 2);

  return {
    buffer,
    update(view) {
      let kept = 0;
      for (let mesh = 0; mesh < ranges.length; mesh++) {
        const [first, n] = ranges[mesh]!;
        visible[mesh * 2] = kept;
        for (let i = first; i < first + n; i++) {
          const b = i * 4;
          if (!ballInView(view, balls[b]!, balls[b + 1]!, balls[b + 2]!, balls[b + 3]!)) continue;
          const from = i * FLOATS;
          const to = kept++ * FLOATS;
          for (let f = 0; f < FLOATS; f++) staging[to + f] = instances[from + f]!;
        }
        visible[mesh * 2 + 1] = kept - visible[mesh * 2]!;
      }
      if (kept) gpu.queue.writeBuffer(buffer, 0, staging, 0, kept * FLOATS);
      return visible;
    },
    destroy: () => buffer.destroy(),
  };
}
