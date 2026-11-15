// The scene pass: everything opaque, drawn once into the multisampled HDR target.
// So far: terrain, rocks, set pieces, sponges, corals, the water surface and the backdrop. Plants, animals and
// particles join in the next milestone.
import type { Quality } from '../../config/quality';
import { DEPTH, HDR, type Gpu } from '../../gpu/context';
import { shaderModule } from '../../gpu/shader';
import solidSource from '../../shaders/solid.wgsl';
import surfaceSource from '../../shaders/surface.wgsl';
import { MESH } from '../../world/data';
import { visibleRuns, type CullView } from '../cull';
import { SceneGroup, type Scene } from '../scene';
import { MESH_VERTEX_LAYOUT, SOLID_INSTANCE_LAYOUT, type CellBuffer, type WorldBuffers } from '../world';

/** How far each thing is drawn, in metres from the camera to the nearest edge of its cell. */
const TERRAIN_DISTANCE = 240;
const SMALL_CHUNK_DISTANCE = 96;
const PEBBLE_DISTANCE = 30;
const LARGE_CHUNK_NEAR = 40; // large chunks switch to their coarser mesh here...
const LARGE_CHUNK_FAR = 150; // ...and end here
const PROP_DISTANCE = 110;
const CORAL_NEAR = 6; // corals switch to their coarser mesh almost at once

export interface ScenePass {
  /** Draws into a pass the renderer has begun. */
  encode(pass: GPURenderPassEncoder, world: WorldBuffers, view: CullView): void;
}

export async function createScenePass(gpu: Gpu, scene: Scene, quality: Quality): Promise<ScenePass> {
  const { device } = gpu;
  const solidModule = shaderModule(device, 'solid', [SceneGroup], solidSource);
  const surfaceModule = shaderModule(device, 'surface', [SceneGroup], surfaceSource);
  const shadowConstants = { LOW: quality.level > 1 ? 1 : 0, SHADOW_SIZE: scene.shadowSize };

  const pipeline = (
    label: string,
    module: GPUShaderModule,
    vertex: string,
    fragment: string,
    options: {
      buffers?: GPUVertexBufferLayout[];
      strip?: boolean;
      cullMode?: GPUCullMode;
      constants?: Record<string, number>;
    },
  ) =>
    device.createRenderPipelineAsync({
      label,
      layout: scene.pipelineLayout,
      vertex: { module, entryPoint: vertex, buffers: options.buffers ?? [] },
      fragment: { module, entryPoint: fragment, targets: [{ format: HDR }], constants: options.constants },
      primitive: { topology: options.strip ? 'triangle-strip' : 'triangle-list', cullMode: options.cullMode ?? 'none' },
      // reversed depth: nearer is greater
      depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'greater' },
      multisample: { count: quality.samples },
    });
  const solidBuffers = [MESH_VERTEX_LAYOUT, SOLID_INSTANCE_LAYOUT];
  const [terrain, solid, surface, backdrop] = await Promise.all([
    pipeline('terrain', solidModule, 'solidVertex', 'solidFragment', {
      buffers: solidBuffers,
      cullMode: 'back',
      constants: shadowConstants,
    }),
    pipeline('solid', solidModule, 'solidVertex', 'solidFragment', {
      buffers: solidBuffers,
      constants: shadowConstants,
    }),
    pipeline('surface', surfaceModule, 'surfaceVertex', 'surfaceFragment', { strip: true }),
    pipeline('backdrop', surfaceModule, 'backdropVertex', 'backdropFragment', { strip: true }),
  ]);

  return {
    encode(pass, world, view) {
      const runs = view.runs;
      /** Draws the instances of one cell-sorted list that are in view and within the distance band. */
      const drawCells = (list: CellBuffer, mesh: number, minDistance: number, maxDistance: number) => {
        const range = world.meshes[mesh]!;
        const n = visibleRuns(view, list.cells, 3, minDistance, maxDistance);
        for (let i = 0; i < n; i++) {
          pass.drawIndexed(range.indexCount, runs[i * 2 + 1]!, range.firstIndex, range.firstVertex, runs[i * 2]!);
        }
      };
      pass.setBindGroup(0, scene.bindGroup);

      // the terrain: quads sorted by cell, drawn with the identity instance
      pass.setPipeline(terrain);
      pass.setVertexBuffer(0, world.terrainVertices);
      pass.setVertexBuffer(1, world.solids);
      pass.setIndexBuffer(world.terrainIndices, 'uint32');
      const n = visibleRuns(view, world.terrainCells, 1.5, 0, TERRAIN_DISTANCE, true);
      for (let i = 0; i < n; i++)
        pass.drawIndexed(runs[i * 2 + 1]! * 6, 1, runs[i * 2]! * 6, 0, world.identityInstance);

      // boulders and the two set pieces
      pass.setPipeline(solid);
      pass.setVertexBuffer(0, world.meshVertices);
      pass.setIndexBuffer(world.meshIndices, 'uint32');
      for (let mesh = 0; mesh < world.solidRanges.length; mesh++) {
        const [first, count] = world.solidRanges[mesh]!;
        if (!count) continue;
        const range = world.meshes[mesh]!;
        pass.drawIndexed(range.indexCount, count, range.firstIndex, range.firstVertex, first);
      }
      // rock chunks: 0-2 small, 3-5 large (with a coarser mesh further out), 6 pebbles
      for (let i = 0; i < world.chunks.length; i++) {
        const chunk = world.chunks[i]!;
        const large = i > 2 && i < 6;
        pass.setVertexBuffer(1, chunk.buffer);
        drawCells(chunk, MESH.chunk + i, 0, i > 5 ? PEBBLE_DISTANCE : large ? LARGE_CHUNK_NEAR : SMALL_CHUNK_DISTANCE);
        if (large) drawCells(chunk, MESH.chunkFar + i - 3, LARGE_CHUNK_NEAR, LARGE_CHUNK_FAR);
      }
      // sponges and corals: 3 and 4 are the corals, which have a coarser mesh
      for (let i = 0; i < world.props.length; i++) {
        const prop = world.props[i]!;
        const coral = i === 3 || i === 4;
        pass.setVertexBuffer(1, prop.buffer);
        drawCells(prop, MESH.sponge + i, 0, coral ? CORAL_NEAR : PROP_DISTANCE);
        if (coral) drawCells(prop, MESH.coralFar + i - 3, CORAL_NEAR, PROP_DISTANCE);
      }

      pass.setPipeline(surface);
      pass.draw(4);
      pass.setPipeline(backdrop);
      pass.draw(4);
    },
  };
}
