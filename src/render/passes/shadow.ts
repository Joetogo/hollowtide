// The sun shadow map. Nothing that casts a shadow moves far, and the sun does not move at all, so the map is drawn
// once when the world arrives: terrain, rocks, set pieces, sponges, corals and the kelp as it stands at time 0.
import type { Quality } from '../../config/quality';
import type { Tuning } from '../../config/tuning';
import { DEPTH, type Gpu } from '../../gpu/context';
import { shaderModule } from '../../gpu/shader';
import leafSource from '../../shaders/leaf.wgsl';
import solidSource from '../../shaders/solid.wgsl';
import { MESH } from '../../world/data';
import { SceneGroup, type Scene } from '../scene';
import { LEAF_INSTANCE_LAYOUT, MESH_VERTEX_LAYOUT, SOLID_INSTANCE_LAYOUT, type WorldBuffers } from '../world';

export interface ShadowBake {
  bake(world: WorldBuffers): void;
}

export async function createShadowBake(gpu: Gpu, scene: Scene, quality: Quality, tuning: Tuning): Promise<ShadowBake> {
  const { device, queue } = gpu;
  const solidModule = shaderModule(device, 'solid', [SceneGroup], solidSource);
  const leafModule = shaderModule(device, 'leaf', [SceneGroup], leafSource);
  const depthStencil: GPUDepthStencilState = {
    format: DEPTH,
    depthWriteEnabled: true,
    depthCompare: 'less',
    depthBias: 2,
    depthBiasSlopeScale: 1.5,
  };
  // depth only: no fragment stage
  const solidPipeline = (cullMode: GPUCullMode) =>
    device.createRenderPipelineAsync({
      label: `shadow solid, cull ${cullMode}`,
      layout: scene.pipelineLayout,
      vertex: { module: solidModule, entryPoint: 'solidVertex', buffers: [MESH_VERTEX_LAYOUT, SOLID_INSTANCE_LAYOUT] },
      primitive: { topology: 'triangle-list', cullMode },
      depthStencil,
    });
  const [solid, terrain, leaf] = await Promise.all([
    solidPipeline('none'),
    solidPipeline('front'), // the terrain is closed, so its far side casts the same shadow with less acne
    device.createRenderPipelineAsync({
      label: 'shadow leaf',
      layout: scene.pipelineLayout,
      vertex: {
        module: leafModule,
        entryPoint: 'leafVertex',
        buffers: [LEAF_INSTANCE_LAYOUT],
        // (the blades cast the shadows of the shapes they are drawn with)
        constants: { ROWS: 3, SMOOTH_BEND: tuning.smoothBend ? 1 : 0 },
      },
      primitive: { topology: 'triangle-strip', cullMode: 'none' },
      depthStencil,
    }),
  ]);

  return {
    bake(world) {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: {
          view: scene.shadowMap.createView(),
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });
      const drawMesh = (mesh: number, count: number, first: number) => {
        const range = world.meshes[mesh]!;
        pass.drawIndexed(range.indexCount, count, range.firstIndex, range.firstVertex, first);
      };
      pass.setBindGroup(0, scene.shadowBindGroup);

      pass.setPipeline(terrain);
      pass.setVertexBuffer(0, world.terrainVertices);
      pass.setVertexBuffer(1, world.solids);
      pass.setIndexBuffer(world.terrainIndices, 'uint32');
      pass.drawIndexed(world.terrainIndexCount, 1, 0, 0, world.identityInstance);

      pass.setPipeline(solid);
      pass.setVertexBuffer(0, world.meshVertices);
      pass.setIndexBuffer(world.meshIndices, 'uint32');
      world.solidRanges.forEach(([first, count], mesh) => count && drawMesh(mesh, count, first));
      // small rocks, sponges and corals are about 35 million triangles: only on High
      if (quality.detailShadows) {
        world.chunks.forEach((chunk, i) => {
          pass.setVertexBuffer(1, chunk.buffer);
          drawMesh(MESH.chunk + i, chunk.count, 0);
        });
        world.props.forEach((prop, i) => {
          if (!prop.count) return;
          pass.setVertexBuffer(1, prop.buffer);
          drawMesh(MESH.sponge + i, prop.count, 0);
        });
      }

      pass.setPipeline(leaf);
      pass.setVertexBuffer(0, world.leavesBig.buffer);
      pass.draw(6, world.leavesBig.count);
      pass.end();
      queue.submit([encoder.finish()]);
    },
  };
}
