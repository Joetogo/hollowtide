// Every mesh of the world except the terrain, built once and packed into one vertex and one index buffer.
// The order here is the mesh numbering the rest of the code uses (MESH in ../data.ts).
import type { Level } from '../../config/quality';
import type { BuiltMesh } from '../../math/mesh';
import type { Random } from '../../math/random';
import { VERTEX_BYTES, type MeshRange } from '../data';
import { fish, manta } from './animals';
import { coral } from './coral';
import { whaleFluke } from './fluke';
import { rock } from './rock';
import { ship } from './ship';
import { BARREL, BOWL, lathe, tubeSponge, VASE } from './sponge';

export interface Meshes {
  vertices: Uint8Array;
  indices: Uint32Array;
  ranges: MeshRange[];
}

export function buildMeshes(random: Random, level: Level): Meshes {
  const meshes: BuiltMesh[] = [
    // 0-3 boulders
    rock(random, level, 1, 3).build(),
    rock(random, level, 7, 3).build(),
    rock(random, level, 13, 3).build(),
    rock(random, level, 22, 3).build(),
    // 4-6 sponges
    lathe(BARREL, 18, 0.3, 9).build(),
    lathe(VASE, 16, 0.35, 8).build(),
    lathe(BOWL, 18, 0.25, 10).build(),
    // 7-8 corals, 9 tube sponge
    coral(random, level, 0).build(),
    coral(random, level, 1).build(),
    tubeSponge(random).build(),
    // 10-13 set pieces and animals
    whaleFluke(),
    ship(random).build(),
    manta().build(),
    fish().build(),
    // 14-16 small rock chunks, 17-19 large, 20 pebbles
    rock(random, level, 3).build(),
    rock(random, level, 11).build(),
    rock(random, level, 29).build(),
    rock(random, level, 5, 3).build(),
    rock(random, level, 17, 3).build(),
    rock(random, level, 41, 3).build(),
    rock(random, level, 9, 1).build(),
    // 21-22 corals for the distance
    coral(random, level, 0, true).build(),
    coral(random, level, 1, true).build(),
    // 23-25 large chunks for the distance: the same shapes, one subdivision coarser
    rock(random, level, 5, 2, true).build(),
    rock(random, level, 17, 2, true).build(),
    rock(random, level, 41, 2, true).build(),
  ];
  const ranges: MeshRange[] = [];
  let vertexCount = 0;
  let indexCount = 0;
  for (const mesh of meshes) {
    ranges.push({
      firstVertex: vertexCount,
      firstIndex: indexCount,
      vertexCount: mesh.vertexCount,
      indexCount: mesh.indices.length,
    });
    vertexCount += mesh.vertexCount;
    indexCount += mesh.indices.length;
  }
  const vertices = new Uint8Array(vertexCount * VERTEX_BYTES);
  const indices = new Uint32Array(indexCount);
  meshes.forEach((mesh, i) => {
    vertices.set(new Uint8Array(mesh.vertices), ranges[i].firstVertex * VERTEX_BYTES);
    indices.set(mesh.indices, ranges[i].firstIndex);
  });
  return { vertices, indices, ranges };
}
