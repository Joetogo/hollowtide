// The scene pass: the whole world, drawn once into the multisampled HDR target. Opaque things first (terrain,
// rocks, set pieces, sponges, corals, animals, plants, the water surface, the backdrop), then what blends on top
// (bubbles, glints, drifting particles).
import type { Quality } from '../../config/quality';
import type { Tuning } from '../../config/tuning';
import { DEPTH, HDR, type Gpu } from '../../gpu/context';
import { shaderModule } from '../../gpu/shader';
import creaturesSource from '../../shaders/creatures.wgsl';
import leafSource from '../../shaders/leaf.wgsl';
import solidSource from '../../shaders/solid.wgsl';
import spritesSource from '../../shaders/sprites.wgsl';
import surfaceSource from '../../shaders/surface.wgsl';
import { MESH } from '../../world/data';
import { visibleRuns, type CullView } from '../cull';
import { SceneGroup, type Scene } from '../scene';
import {
  CREATURE_INSTANCE_LAYOUT,
  LEAF_INSTANCE_LAYOUT,
  MESH_VERTEX_LAYOUT,
  SNOW_INSTANCE_LAYOUT,
  SOLID_INSTANCE_LAYOUT,
  SPRITE_INSTANCE_LAYOUT,
  type CellBuffer,
  type InstanceBuffer,
  type WorldBuffers,
} from '../world';
import { BREATH_BUBBLES } from '../../body/breath';

/** How far each thing is drawn, in metres from the camera to the nearest edge of its cell (see also Tuning). */
const TERRAIN_DISTANCE = 240;
const SMALL_CHUNK_DISTANCE = 96;
const PEBBLE_DISTANCE = 30;
const LARGE_CHUNK_NEAR = 40; // large chunks switch to their coarser mesh here...
const LARGE_CHUNK_FAR = 150; // ...and end here
const PROP_DISTANCE = 110;
const CORAL_NEAR = 6; // corals switch to their coarser mesh almost at once

const PREMULTIPLIED: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
};
const ADDITIVE: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'one' },
  alpha: { srcFactor: 'one', dstFactor: 'one' },
};

interface PipelineOptions {
  buffers?: GPUVertexBufferLayout[];
  strip?: boolean;
  cullMode?: GPUCullMode;
  /** pipeline constants of the vertex stage */
  vertexConstants?: Record<string, number>;
  /** pipeline constants of the fragment stage */
  constants?: Record<string, number>;
  /** blended on top of the scene: tested against depth but not written to it */
  blend?: GPUBlendState;
}

/**
 * Harness builds only: names of draws to leave out, to compare frames and frame costs with and without them:
 * 'terrain', 'solids', 'chunks', 'props', 'mantas', 'fish', 'leaves' (or one band of them: 'leaves near', 'leaves
 * mid', 'leaves far', 'leaves small'), 'bubbles', 'breath', 'glints', 'snow', and what the renderer checks: 'shafts',
 * 'water' (the water texture is not redrawn) and 'bloom'. Always empty in the shipped file.
 */
export const skippedDraws = new Set<string>();
export const skipped = (name: string) => __HARNESS__ && skippedDraws.has(name);

export interface ScenePass {
  /** Draws into a pass the renderer has begun. */
  encode(pass: GPURenderPassEncoder, world: WorldBuffers, view: CullView): void;
  /** The swimmer's own bubbles (body/breath.ts: BREATH_BUBBLES of them, eight floats each), when they change. */
  setOwnBubbles(data: Float32Array): void;
  /**
   * Makes the shaders again, in the light now set (gpu/shader.ts). Resolves when they are ready with a function
   * that puts them to use: the renderer calls those of all its passes together, so that no frame is drawn half
   * in one light and half in another.
   */
  relight(): Promise<() => void>;
}

export async function createScenePass(gpu: Gpu, scene: Scene, quality: Quality, tuning: Tuning): Promise<ScenePass> {
  // leaves: 9 rows of vertices up close, 5 mid-range, then every second leaf (made wider) with 3 rows
  const { leafNear: LEAF_NEAR, leafMid: LEAF_MID, leafFar: LEAF_FAR, smallLeafDistance: SMALL_LEAF_DISTANCE } = tuning;
  const rockFade = tuning.rockFade;
  const SMOOTH_BEND = tuning.smoothBend ? 1 : 0;
  const { device } = gpu;
  // (all of the pipelines, made from the shaders as they are in the light now set)
  const build = () => {
    const solidModule = shaderModule(device, 'solid', [SceneGroup], solidSource);
    const surfaceModule = shaderModule(device, 'surface', [SceneGroup], surfaceSource);
    const creaturesModule = shaderModule(device, 'creatures', [SceneGroup], creaturesSource);
    const leafModule = shaderModule(device, 'leaf', [SceneGroup], leafSource);
    const spritesModule = shaderModule(device, 'sprites', [SceneGroup], spritesSource);
    const shadowConstants = { LOW: quality.low ? 1 : 0, SHADOW_SIZE: scene.shadowSize };

    const pipeline = (
      label: string,
      module: GPUShaderModule,
      vertex: string,
      fragment: string,
      options: PipelineOptions,
    ) =>
      device.createRenderPipelineAsync({
        label,
        layout: scene.pipelineLayout,
        vertex: { module, entryPoint: vertex, buffers: options.buffers ?? [], constants: options.vertexConstants },
        fragment: {
          module,
          entryPoint: fragment,
          targets: [{ format: HDR, blend: options.blend }],
          constants: options.constants,
        },
        primitive: {
          topology: options.strip ? 'triangle-strip' : 'triangle-list',
          cullMode: options.cullMode ?? 'none',
        },
        // reversed depth: nearer is greater
        depthStencil: { format: DEPTH, depthWriteEnabled: !options.blend, depthCompare: 'greater' },
        multisample: { count: quality.samples },
      });
    const solidBuffers = [MESH_VERTEX_LAYOUT, SOLID_INSTANCE_LAYOUT];
    const creatureBuffers = [MESH_VERTEX_LAYOUT, CREATURE_INSTANCE_LAYOUT];
    const sprite = { buffers: [SPRITE_INSTANCE_LAYOUT], strip: true };
    const leaf = (label: string, vertexConstants: Record<string, number>) =>
      pipeline(label, leafModule, 'leafVertex', 'leafFragment', {
        buffers: [LEAF_INSTANCE_LAYOUT],
        strip: true,
        vertexConstants,
      });

    return Promise.all([
      pipeline('terrain', solidModule, 'solidVertex', 'solidFragment', {
        buffers: solidBuffers,
        cullMode: 'back',
        constants: shadowConstants,
      }),
      pipeline('solid', solidModule, 'solidVertex', 'solidFragment', {
        buffers: solidBuffers,
        vertexConstants: { ROCK_FADE: rockFade },
        constants: shadowConstants,
      }),
      pipeline('surface', surfaceModule, 'surfaceVertex', 'surfaceFragment', { strip: true }),
      pipeline('backdrop', surfaceModule, 'backdropVertex', 'backdropFragment', { strip: true }),
      pipeline('manta', creaturesModule, 'mantaVertex', 'mantaFragment', {
        buffers: creatureBuffers,
        constants: { SHADOW_SIZE: scene.shadowSize },
      }),
      pipeline('fish', creaturesModule, 'fishVertex', 'fishFragment', {
        buffers: creatureBuffers,
        vertexConstants: { PART: tuning.fishPart },
      }),
      leaf('leaf near', { ROWS: 9, FAR: LEAF_FAR, SMOOTH_BEND }),
      leaf('leaf mid', { ROWS: 5, FAR: LEAF_FAR, SMOOTH_BEND }),
      leaf('leaf far', { ROWS: 3, FAR: LEAF_FAR, SMOOTH_BEND }),
      leaf('leaf small', { ROWS: 3, FAR: SMALL_LEAF_DISTANCE, SMOOTH_BEND }),
      pipeline('bubbles', spritesModule, 'bubbleVertex', 'bubbleFragment', { ...sprite, blend: PREMULTIPLIED }),
      pipeline('glints', leafModule, 'glintVertex', 'glintFragment', {
        ...sprite,
        blend: ADDITIVE,
        vertexConstants: { GLINT_FAR: tuning.glintDistance },
      }),
      pipeline('snow', spritesModule, 'snowVertex', 'snowFragment', {
        buffers: [SNOW_INSTANCE_LAYOUT],
        strip: true,
        blend: ADDITIVE,
      }),
      pipeline('own bubbles', spritesModule, 'bubbleVertex', 'bubbleFragment', {
        ...sprite,
        blend: PREMULTIPLIED,
        vertexConstants: { OWN: 1 },
        constants: { OWN: 1 },
      }),
    ]);
  };
  let [
    terrain,
    solid,
    surface,
    backdrop,
    manta,
    fish,
    leafNear,
    leafMid,
    leafFar,
    leafSmall,
    bubbles,
    glints,
    snow,
    ownBubbles,
  ] = await build();

  const ownBuffer = device.createBuffer({
    label: 'own bubbles',
    size: BREATH_BUBBLES * 32,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  return {
    relight: async () => {
      const next = await build();
      return () =>
        void ([
          terrain,
          solid,
          surface,
          backdrop,
          manta,
          fish,
          leafNear,
          leafMid,
          leafFar,
          leafSmall,
          bubbles,
          glints,
          snow,
          ownBubbles,
        ] = next);
    },
    setOwnBubbles: (data) => gpu.queue.writeBuffer(ownBuffer, 0, data),
    encode(pass, world, view) {
      const runs = view.runs;
      /** Draws the instances of one cell-sorted list of meshes that are in view and within the distance band. */
      const drawCells = (list: CellBuffer, mesh: number, minDistance: number, maxDistance: number) => {
        const range = world.meshes[mesh]!;
        const n = visibleRuns(view, list.cells, 3, minDistance, maxDistance);
        for (let i = 0; i < n; i++) {
          pass.drawIndexed(range.indexCount, runs[i * 2 + 1]!, range.firstIndex, range.firstVertex, runs[i * 2]!);
        }
      };
      /** The same for leaves, which have no mesh: two vertices per row. */
      const drawLeaves = (list: CellBuffer, rows: number, margin: number, minDistance: number, maxDistance: number) => {
        const n = visibleRuns(view, list.cells, margin, minDistance, maxDistance);
        for (let i = 0; i < n; i++) pass.draw(rows * 2, runs[i * 2 + 1]!, 0, runs[i * 2]!);
      };
      pass.setBindGroup(0, scene.bindGroup);

      // the terrain: quads sorted by cell, drawn with the identity instance
      pass.setPipeline(terrain);
      pass.setVertexBuffer(0, world.terrainVertices);
      pass.setVertexBuffer(1, world.solids);
      pass.setIndexBuffer(world.terrainIndices, 'uint32');
      const n = skipped('terrain') ? 0 : visibleRuns(view, world.terrainCells, 1.5, 0, TERRAIN_DISTANCE, true);
      for (let i = 0; i < n; i++)
        pass.drawIndexed(runs[i * 2 + 1]! * 6, 1, runs[i * 2]! * 6, 0, world.identityInstance);

      // boulders and the two set pieces: those that may be in view (see ../solids.ts)
      pass.setPipeline(solid);
      pass.setVertexBuffer(0, world.meshVertices);
      pass.setIndexBuffer(world.meshIndices, 'uint32');
      if (!skipped('solids')) {
        const visible = world.solidCull.update(view);
        pass.setVertexBuffer(1, world.solidCull.buffer);
        for (let mesh = 0; mesh < world.solidRanges.length; mesh++) {
          const count = visible[mesh * 2 + 1]!;
          if (!count) continue;
          const range = world.meshes[mesh]!;
          pass.drawIndexed(range.indexCount, count, range.firstIndex, range.firstVertex, visible[mesh * 2]!);
        }
      }
      // rock chunks: 0-2 small, 3-5 large (with a coarser mesh further out), 6 pebbles
      for (let i = 0; i < world.chunks.length && !skipped('chunks'); i++) {
        const chunk = world.chunks[i]!;
        const large = i > 2 && i < 6;
        pass.setVertexBuffer(1, chunk.buffer);
        const far = (i > 5 ? PEBBLE_DISTANCE : large ? LARGE_CHUNK_FAR : SMALL_CHUNK_DISTANCE) * rockFade;
        drawCells(chunk, MESH.chunk + i, 0, large ? LARGE_CHUNK_NEAR : far);
        if (large) drawCells(chunk, MESH.chunkFar + i - 3, LARGE_CHUNK_NEAR, far);
      }
      // sponges and corals: 3 and 4 are the corals, which have a coarser mesh
      for (let i = 0; i < world.props.length && !skipped('props'); i++) {
        const prop = world.props[i]!;
        const coral = i === 3 || i === 4;
        pass.setVertexBuffer(1, prop.buffer);
        drawCells(prop, MESH.sponge + i, 0, coral ? CORAL_NEAR : PROP_DISTANCE);
        if (coral) drawCells(prop, MESH.coralFar + i - 3, CORAL_NEAR, PROP_DISTANCE);
      }

      // animals: the mesh buffers are still bound
      const mantaMesh = world.meshes[MESH.manta]!;
      if (!skipped('mantas')) {
        pass.setPipeline(manta);
        pass.setVertexBuffer(1, world.mantas.buffer);
        pass.drawIndexed(mantaMesh.indexCount, world.mantas.count, mantaMesh.firstIndex, mantaMesh.firstVertex, 0);
      }
      const fishMesh = world.meshes[MESH.fish]!;
      if (!skipped('fish')) {
        pass.setPipeline(fish);
        pass.setVertexBuffer(1, world.fish.buffer);
        pass.drawIndexed(fishMesh.indexCount, world.fish.count, fishMesh.firstIndex, fishMesh.firstVertex, 0);
      }

      // kelp and plants
      if (!skipped('leaves')) {
        pass.setPipeline(leafNear);
        pass.setVertexBuffer(0, world.leavesBig.buffer);
        if (!skipped('leaves near')) drawLeaves(world.leavesBig, 9, 5, 0, LEAF_NEAR);
        pass.setPipeline(leafMid);
        if (!skipped('leaves mid')) drawLeaves(world.leavesBig, 5, 5, LEAF_NEAR, LEAF_MID);
        pass.setPipeline(leafFar);
        pass.setVertexBuffer(0, world.leavesBigFar.buffer);
        if (!skipped('leaves far')) drawLeaves(world.leavesBigFar, 3, 5, LEAF_MID, LEAF_FAR);
        pass.setPipeline(leafSmall);
        pass.setVertexBuffer(0, world.leavesSmall.buffer);
        if (!skipped('leaves small')) drawLeaves(world.leavesSmall, 3, 1.5, 0, SMALL_LEAF_DISTANCE);
      }

      pass.setPipeline(surface);
      pass.draw(4);
      pass.setPipeline(backdrop);
      pass.draw(4);

      // blended, in this order: bubbles over the scene, then the additive glints and particles
      /** Sprites sorted into cells are drawn cell by cell, those that can be seen; unsorted ones all at once. */
      const drawSprites = (sprites: InstanceBuffer, margin: number, distance: number) => {
        if (!sprites.cells) return pass.draw(4, sprites.count);
        const n = visibleRuns(view, sprites.cells, margin, 0, distance, true);
        for (let i = 0; i < n; i++) pass.draw(4, runs[i * 2 + 1]!, 0, runs[i * 2]!);
      };
      if (!skipped('bubbles')) {
        pass.setPipeline(bubbles);
        pass.setVertexBuffer(0, world.bubbles.buffer);
        drawSprites(world.bubbles, 4, Infinity);
      }
      if (!skipped('breath')) {
        pass.setPipeline(ownBubbles);
        pass.setVertexBuffer(0, ownBuffer);
        pass.draw(4, BREATH_BUBBLES);
      }
      if (!skipped('glints')) {
        pass.setPipeline(glints);
        pass.setVertexBuffer(0, world.glints.buffer);
        drawSprites(world.glints, 2, tuning.glintDistance);
      }
      if (!skipped('snow')) {
        pass.setPipeline(snow);
        pass.setVertexBuffer(0, world.snow.buffer);
        pass.draw(4, world.snow.count);
      }
    },
  };
}
