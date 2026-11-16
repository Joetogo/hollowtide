// Sea turtles: one sculpted mesh, drawn once for each of a handful of instances (see shaders/turtle.wgsl).
import { BODY_VERTEX_BYTES } from '../../body/sculpt';
import type { Quality } from '../../config/quality';
import { DEPTH, HDR, type Gpu } from '../../gpu/context';
import { shaderModule } from '../../gpu/shader';
import type { TurtleMesh } from '../../life/turtle';
import turtleSource from '../../shaders/turtle.wgsl';
import { SceneGroup, type Scene } from '../scene';

const VERTEX_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: BODY_VERTEX_BYTES,
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'snorm8x4' },
    { shaderLocation: 2, offset: 16, format: 'uint8x4' },
  ],
};
const INSTANCE_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: 32,
  stepMode: 'instance',
  attributes: [
    { shaderLocation: 3, offset: 0, format: 'float32x4' },
    { shaderLocation: 4, offset: 16, format: 'float32x4' },
  ],
};

export interface Turtles {
  /** The mesh, and where each turtle swims: eight floats each (life/turtle.ts). */
  set(mesh: TurtleMesh, instances: Float32Array): void;
  /** Draws them into a scene pass the renderer has begun. */
  encode(pass: GPURenderPassEncoder): void;
}

export async function createTurtles(gpu: Gpu, scene: Scene, quality: Quality): Promise<Turtles> {
  const { device, queue } = gpu;
  const module = shaderModule(device, 'turtle', [SceneGroup], turtleSource);
  const pipeline = await device.createRenderPipelineAsync({
    label: 'turtles',
    layout: scene.pipelineLayout,
    vertex: { module, entryPoint: 'turtleVertex', buffers: [VERTEX_LAYOUT, INSTANCE_LAYOUT] },
    fragment: {
      module,
      entryPoint: 'turtleFragment',
      targets: [{ format: HDR }],
      constants: { SHADOW_SIZE: scene.shadowSize },
    },
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'greater' },
    multisample: { count: quality.samples },
  });
  let buffers: { vertices: GPUBuffer; indices: GPUBuffer; instances: GPUBuffer } | null = null;
  let indexCount = 0;
  let count = 0;
  const filled = (label: string, usage: number, data: Uint8Array | Uint32Array | Float32Array) => {
    const buffer = device.createBuffer({
      label,
      size: Math.max(32, data.byteLength),
      usage: usage | GPUBufferUsage.COPY_DST,
    });
    queue.writeBuffer(buffer, 0, data);
    return buffer;
  };
  return {
    set(mesh, instances) {
      if (buffers) for (const buffer of Object.values(buffers)) buffer.destroy();
      buffers = {
        vertices: filled('turtle vertices', GPUBufferUsage.VERTEX, mesh.vertices),
        indices: filled('turtle indices', GPUBufferUsage.INDEX, mesh.indices),
        instances: filled('turtles', GPUBufferUsage.VERTEX, instances),
      };
      indexCount = mesh.indices.length;
      count = instances.length / 8;
    },
    encode(pass) {
      if (!buffers || !count) return;
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, scene.bindGroup);
      pass.setVertexBuffer(0, buffers.vertices);
      pass.setVertexBuffer(1, buffers.instances);
      pass.setIndexBuffer(buffers.indices, 'uint32');
      pass.drawIndexed(indexCount, count);
    },
  };
}
