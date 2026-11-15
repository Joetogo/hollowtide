// The world on the GPU: vertex, index and instance buffers made from the generator's typed arrays.
import type { Gpu } from '../gpu/context';
import type { CellInstances, CellTable, MeshRange, WorldData } from '../world/data';
import { LEAF_BYTES, SOLID_BYTES, VERTEX_BYTES } from '../world/data';
import { NX, NY, NZ } from '../world/grid';
import { GROUND_MAP_SIZE, type Scene } from './scene';

/** Mesh and terrain vertices: position, then normal xyz with one extra value (ambient occlusion and the like). */
export const MESH_VERTEX_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: VERTEX_BYTES,
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'snorm8x4' },
  ],
};
export const SOLID_INSTANCE_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: SOLID_BYTES,
  stepMode: 'instance',
  attributes: [
    { shaderLocation: 2, offset: 0, format: 'float32x4' },
    { shaderLocation: 3, offset: 16, format: 'float32x4' },
    { shaderLocation: 4, offset: 32, format: 'float32x4' },
  ],
};
export const LEAF_INSTANCE_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: LEAF_BYTES,
  stepMode: 'instance',
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x4' },
    { shaderLocation: 1, offset: 16, format: 'float32x4' },
    { shaderLocation: 2, offset: 32, format: 'unorm8x4' },
  ],
};

/** Fish and mantas: path centre + radius, then four motion values. */
export const CREATURE_INSTANCE_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: 32,
  stepMode: 'instance',
  attributes: [
    { shaderLocation: 2, offset: 0, format: 'float32x4' },
    { shaderLocation: 3, offset: 16, format: 'float32x4' },
  ],
};
/** Bubbles and glints: eight floats, with no mesh in front of them. */
export const SPRITE_INSTANCE_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: 32,
  stepMode: 'instance',
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x4' },
    { shaderLocation: 1, offset: 16, format: 'float32x4' },
  ],
};
export const SNOW_INSTANCE_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: 16,
  stepMode: 'instance',
  attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }],
};

/** An instance buffer drawn whole. */
export interface InstanceBuffer {
  buffer: GPUBuffer;
  count: number;
}

/** An instance buffer sorted by culling cell. */
export interface CellBuffer {
  buffer: GPUBuffer;
  count: number;
  cells: CellTable;
}

export interface WorldBuffers {
  terrainVertices: GPUBuffer;
  terrainIndices: GPUBuffer;
  terrainIndexCount: number;
  terrainCells: CellTable;
  meshVertices: GPUBuffer;
  meshIndices: GPUBuffer;
  meshes: MeshRange[];
  /** The uncull'd solids, followed by one identity instance. The terrain is drawn as that instance. */
  solids: GPUBuffer;
  solidRanges: [first: number, count: number][];
  identityInstance: number;
  chunks: CellBuffer[];
  props: CellBuffer[];
  leavesBig: CellBuffer;
  leavesBigFar: CellBuffer;
  leavesSmall: CellBuffer;
  fish: InstanceBuffer;
  mantas: InstanceBuffer;
  bubbles: InstanceBuffer;
  glints: InstanceBuffer;
  snow: InstanceBuffer;
  destroy(): void;
}

// position 0, scale 1; no rotation; material 0 (terrain), seed 0, no fade, no bob
const IDENTITY_INSTANCE = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0];

export function uploadWorld(gpu: Gpu, scene: Scene, data: WorldData): WorldBuffers {
  const { device, queue } = gpu;
  const buffers: GPUBuffer[] = [];
  const upload = (label: string, bytes: Uint8Array | Uint32Array | Float32Array, usage: number) => {
    const buffer = device.createBuffer({
      label,
      size: (bytes.byteLength + 3) & ~3,
      usage: usage | GPUBufferUsage.COPY_DST,
    });
    queue.writeBuffer(buffer, 0, bytes.buffer, bytes.byteOffset, bytes.byteLength);
    buffers.push(buffer);
    return buffer;
  };
  const VERTEX = GPUBufferUsage.VERTEX;
  const cellBuffer = (label: string, set: CellInstances<Uint8Array | Float32Array>, stride: number): CellBuffer => ({
    buffer: upload(label, set.instances, VERTEX),
    count: set.instances.byteLength / stride,
    cells: set.cells,
  });

  const instances = (label: string, floats: Float32Array, perInstance: number): InstanceBuffer => ({
    buffer: upload(label, floats, VERTEX),
    count: floats.length / perInstance,
  });

  const solidCount = data.solids.instances.length / 12;
  const solids = new Float32Array((solidCount + 1) * 12);
  solids.set(data.solids.instances);
  solids.set(IDENTITY_INSTANCE, solidCount * 12);

  queue.writeTexture({ texture: scene.volume }, data.volume, { bytesPerRow: NX, rowsPerImage: NY / 2 }, [
    NX / 2,
    NY / 2,
    NZ / 2,
  ]);
  queue.writeTexture({ texture: scene.groundMap }, data.groundMap, { bytesPerRow: GROUND_MAP_SIZE * 4 }, [
    GROUND_MAP_SIZE,
    GROUND_MAP_SIZE,
  ]);

  return {
    terrainVertices: upload('terrain vertices', data.terrain.vertices, VERTEX),
    terrainIndices: upload('terrain indices', data.terrain.indices, GPUBufferUsage.INDEX),
    terrainIndexCount: data.terrain.indices.length,
    terrainCells: data.terrain.cells,
    meshVertices: upload('mesh vertices', data.meshes.vertices, VERTEX),
    meshIndices: upload('mesh indices', data.meshes.indices, GPUBufferUsage.INDEX),
    meshes: data.meshes.ranges,
    solids: upload('solids', solids, VERTEX),
    solidRanges: data.solids.ranges,
    identityInstance: solidCount,
    chunks: data.chunks.map((c, i) => cellBuffer(`chunks ${i}`, c, SOLID_BYTES)),
    props: data.props.map((c, i) => cellBuffer(`props ${i}`, c, SOLID_BYTES)),
    leavesBig: cellBuffer('leaves', data.leaves.big, LEAF_BYTES),
    leavesBigFar: cellBuffer('far leaves', data.leaves.bigFar, LEAF_BYTES),
    leavesSmall: cellBuffer('small leaves', data.leaves.small, LEAF_BYTES),
    fish: instances('fish', data.fish, 8),
    mantas: instances('mantas', data.mantas, 8),
    bubbles: instances('bubbles', data.bubbles, 8),
    glints: instances('glints', data.glints, 8),
    snow: instances('snow', data.snow, 4),
    destroy: () => buffers.forEach((b) => b.destroy()),
  };
}
