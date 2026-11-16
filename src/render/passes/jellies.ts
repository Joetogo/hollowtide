// Jellyfish: drawn last in the scene pass, adding their light to it (see shaders/jelly.wgsl). One instance
// buffer and no mesh: the shader builds each jelly from the vertex index.
import type { Quality } from '../../config/quality';
import { DEPTH, HDR, type Gpu } from '../../gpu/context';
import { shaderModule } from '../../gpu/shader';
import jellySource from '../../shaders/jelly.wgsl';
import { SceneGroup, type Scene } from '../scene';
import { SPRITE_INSTANCE_LAYOUT } from '../world';

/** Vertices the shader makes of one jelly: 252 quads of bell, 12 trails of 8 quads, two triangles a quad. */
export const JELLY_VERTICES = (252 + 12 * 8) * 6;

export interface Jellies {
  /** Where the jellies are and what each is like: eight floats each (see src/world/jellies.ts). */
  set(instances: Float32Array): void;
  /** Draws them into a scene pass the renderer has begun, after everything else. */
  encode(pass: GPURenderPassEncoder): void;
}

export async function createJellies(gpu: Gpu, scene: Scene, quality: Quality): Promise<Jellies> {
  const { device, queue } = gpu;
  const module = shaderModule(device, 'jelly', [SceneGroup], jellySource);
  const pipeline = await device.createRenderPipelineAsync({
    label: 'jellies',
    layout: scene.pipelineLayout,
    vertex: { module, entryPoint: 'jellyVertex', buffers: [SPRITE_INSTANCE_LAYOUT] },
    fragment: {
      module,
      entryPoint: 'jellyFragment',
      // their light is added to what is there
      targets: [
        {
          format: HDR,
          blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } },
        },
      ],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    // tested against the scene's depth (reversed: nearer is greater) but not written to it
    depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: 'greater' },
    multisample: { count: quality.samples },
  });
  let buffer: GPUBuffer | null = null;
  let count = 0;
  return {
    set(instances) {
      buffer?.destroy();
      buffer = device.createBuffer({
        label: 'jellies',
        size: Math.max(32, instances.byteLength),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      queue.writeBuffer(buffer, 0, instances);
      count = instances.length / 8;
    },
    encode(pass) {
      if (!buffer || !count) return;
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, scene.bindGroup);
      pass.setVertexBuffer(0, buffer);
      pass.draw(JELLY_VERTICES, count);
    },
  };
}
