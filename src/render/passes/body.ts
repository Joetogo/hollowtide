// The swimmer's own arms and gear (src/body), drawn first in the scene pass: they are nearest, so everything
// behind them is skipped by the depth test. A few skinned meshes, moved by one small block of bones.
import type { BodyMeshes } from '../../body/meshes';
import type { BodyParts } from '../../body/rig';
import { BODY_VERTEX_BYTES } from '../../body/sculpt';
import { BONES } from '../../body/skeleton';
import type { Quality } from '../../config/quality';
import { DEPTH, HDR, type Gpu } from '../../gpu/context';
import { shaderModule } from '../../gpu/shader';
import bodySource from '../../shaders/body.wgsl';
import type { MeshRange } from '../../world/data';
import { SceneGroup, type Scene } from '../scene';

/** Body vertices: position; normal with the baked occlusion; two bones, the first one's share, the material. */
const BODY_VERTEX_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: BODY_VERTEX_BYTES,
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'snorm8x4' },
    { shaderLocation: 2, offset: 16, format: 'uint8x4' },
  ],
};

export interface BodyPass {
  /** The meshes to draw the parts with; until they are given, nothing is drawn. */
  setMeshes(meshes: BodyMeshes): void;
  /** Draws the parts into a scene pass the renderer has begun. */
  encode(pass: GPURenderPassEncoder, parts: BodyParts): void;
}

export async function createBodyPass(gpu: Gpu, scene: Scene, quality: Quality): Promise<BodyPass> {
  const { device, queue } = gpu;
  const module = shaderModule(device, 'body', [SceneGroup], bodySource);
  // the bones are a second bind group, declared in the shader itself: `BONES` rotations, then `BONES` offsets
  const bonesLayout = device.createBindGroupLayout({
    label: 'bones',
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
  });
  const bones = device.createBuffer({
    label: 'bones',
    size: BONES * 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bonesGroup = device.createBindGroup({
    layout: bonesLayout,
    entries: [{ binding: 0, resource: { buffer: bones } }],
  });
  const pipeline = await device.createRenderPipelineAsync({
    label: 'body',
    layout: device.createPipelineLayout({ bindGroupLayouts: [scene.layout, bonesLayout] }),
    vertex: { module, entryPoint: 'bodyVertex', buffers: [BODY_VERTEX_LAYOUT] },
    fragment: {
      module,
      entryPoint: 'bodyFragment',
      targets: [{ format: HDR }],
      constants: { LOW: quality.low ? 1 : 0, SHADOW_SIZE: scene.shadowSize },
    },
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'greater' },
    multisample: { count: quality.samples },
  });
  let vertices: GPUBuffer | null = null;
  let indices: GPUBuffer | null = null;
  let ranges: MeshRange[] = [];

  return {
    setMeshes(meshes) {
      vertices?.destroy();
      indices?.destroy();
      vertices = device.createBuffer({
        label: 'body vertices',
        size: meshes.vertices.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      indices = device.createBuffer({
        label: 'body indices',
        size: meshes.indices.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      });
      queue.writeBuffer(vertices, 0, meshes.vertices);
      queue.writeBuffer(indices, 0, meshes.indices);
      ranges = meshes.ranges;
    },
    encode(pass, parts) {
      if (!vertices || !indices || !parts.count) return;
      queue.writeBuffer(bones, 0, parts.skin);
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, scene.bindGroup);
      pass.setBindGroup(1, bonesGroup);
      pass.setVertexBuffer(0, vertices);
      pass.setIndexBuffer(indices, 'uint32');
      for (let i = 0; i < parts.count; i++) {
        const range = ranges[parts.mesh[i]!]!;
        pass.drawIndexed(range.indexCount, 1, range.firstIndex, range.firstVertex, 0);
      }
    },
  };
}
