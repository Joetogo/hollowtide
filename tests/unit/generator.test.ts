import { describe, expect, it } from 'vitest';
import { clearancePoints, flyPoint, FLY_SECONDS } from '../../src/camera/path';
import { sampler, surfaceNets } from '../../src/math/field';
import { icosphere, MeshBuilder } from '../../src/math/mesh';
import { fbm, hash3, valueNoise } from '../../src/math/noise';
import { quatAxis, quatFromY, quatMul, quatRandom } from '../../src/math/quat';
import { Random } from '../../src/math/random';
import { smoothRamp } from '../../src/math/scalar';
import {
  ALL_ROCK,
  ALL_WATER,
  buildCollisionField,
  COLLISION_BRICKS,
  COLLISION_OFFSET,
} from '../../src/world/collision';
import { packShapes } from '../../src/world/density';
import { NX, NY, NZ } from '../../src/world/grid';
import { buildGroundMap, grottoAt, magentaAt } from '../../src/world/groundMap';
import { ARCHES, CLEARINGS, ROCK_MASSES, TUNNELS, VIEWPOINTS } from '../../src/world/layout';
import { buildMeshes } from '../../src/world/meshes';
import { removeSpecks } from '../../src/world/terrain';

// Whether the generator reproduces the original is checked in the browser, by checksum against the original
// (tests/browser/generator.mjs). These tests pin down the pieces on their own terms.

describe('Random', () => {
  it('gives each stream its own repeatable sequence in [0, 1)', () => {
    const a = new Random();
    const b = new Random();
    a.reseed(3);
    b.reseed(3);
    const first = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(first);
    expect(first.every((v) => v >= 0 && v < 1)).toBe(true);
    b.reseed(4);
    expect(b.next()).not.toBe(first[0]);
    a.reseed(3);
    expect(a.next()).toBe(first[0]);
  });

  it('keeps range() within its bounds', () => {
    const r = new Random();
    for (let i = 0; i < 1000; i++) {
      const v = r.range(-2, 5);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThan(5);
    }
  });
});

describe('noise', () => {
  it('stays in [0, 1) and is continuous', () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37 - 20,
        y = i * 0.11,
        z = -i * 0.23;
      for (const v of [hash3(i, -i, i * 7), valueNoise(x, y, z), fbm(x, y, z, 4)]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
      expect(Math.abs(valueNoise(x, y, z) - valueNoise(x + 1e-4, y, z))).toBeLessThan(1e-3);
    }
  });

  it('equals the lattice hash at whole numbers', () => {
    expect(valueNoise(3, -2, 7)).toBe(hash3(3, -2, 7));
  });
});

describe('quaternions', () => {
  const rotate = (q: number[], v: number[]) => {
    const [x, y, z, w] = q as [number, number, number, number];
    const [a, b, c] = v as [number, number, number];
    const tx = 2 * (y * c - z * b),
      ty = 2 * (z * a - x * c),
      tz = 2 * (x * b - y * a);
    return [a + w * tx + (y * tz - z * ty), b + w * ty + (z * tx - x * tz), c + w * tz + (x * ty - y * tx)];
  };
  const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 10));

  it('quatAxis turns about its axis', () => close(rotate(quatAxis(0, 3, 0, Math.PI / 2), [1, 0, 0]), [0, 0, -1]));
  it('quatMul applies the right-hand rotation first', () => {
    const q = quatMul(quatAxis(0, 1, 0, Math.PI / 2), quatAxis(1, 0, 0, Math.PI / 2));
    close(
      rotate(q, [0, 1, 0]),
      rotate(quatAxis(0, 1, 0, Math.PI / 2), rotate(quatAxis(1, 0, 0, Math.PI / 2), [0, 1, 0])),
    );
  });
  it('quatFromY takes +y to the given direction, also straight down', () => {
    close(rotate(quatFromY(0.6, 0.8, 0), [0, 1, 0]), [0.6, 0.8, 0]);
    close(rotate(quatFromY(0, -1, 0), [0, 1, 0]), [0, -1, 0]);
  });
  it('quatRandom is a unit quaternion and takes four draws', () => {
    const a = new Random();
    const b = new Random();
    const q = quatRandom(a);
    expect(Math.hypot(...q)).toBeCloseTo(1, 12);
    for (let i = 0; i < 4; i++) b.next();
    expect(a.next()).toBe(b.next());
  });
});

describe('surface nets', () => {
  // a sphere of radius 5 in a 16-voxel cube, positive inside
  const n = 16;
  const field = new Float32Array(n * n * n);
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) field[x + n * (y + n * z)] = 5 - Math.hypot(x - 7.5, y - 7.5, z - 7.5);
  const net = surfaceNets(field, n, n, n);

  it('puts every vertex on the surface', () => {
    expect(net.vertexCount).toBeGreaterThan(100);
    for (let k = 0; k < net.vertexCount; k++) {
      const r = Math.hypot(
        net.positions[k * 3]! - 7.5,
        net.positions[k * 3 + 1]! - 7.5,
        net.positions[k * 3 + 2]! - 7.5,
      );
      expect(Math.abs(r - 5)).toBeLessThan(0.25);
    }
  });

  it('makes a closed mesh facing outwards', () => {
    expect(net.indexCount % 6).toBe(0);
    // closed: every edge is used once in each direction
    const edges = new Map<string, number>();
    for (let t = 0; t < net.indexCount; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = net.indices[t + e]!,
          b = net.indices[t + ((e + 1) % 3)]!;
        edges.set(`${a}>${b}`, (edges.get(`${a}>${b}`) ?? 0) + 1);
      }
    }
    for (const [key, count] of edges) {
      const [a, b] = key.split('>');
      expect(count).toBe(1);
      expect(edges.get(`${b}>${a}`)).toBe(1);
    }
    // outwards: the first triangle's normal points away from the centre
    const p = (i: number) => [0, 1, 2].map((c) => net.positions[net.indices[i]! * 3 + c]! - 7.5);
    const [a, b, c] = [p(0), p(1), p(2)];
    const u = b.map((v, i) => v - a[i]!),
      v = c.map((w, i) => w - a[i]!);
    const normal = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    expect(normal[0]! * a[0]! + normal[1]! * a[1]! + normal[2]! * a[2]!).toBeGreaterThan(0);
  });

  it('samples the field between voxels', () => {
    const sample = sampler(field, n, n, n);
    expect(sample(7, 7, 7)).toBe(field[7 + n * (7 + n * 7)]);
    expect(sample(7.5, 7.5, 7.5)).toBeCloseTo(5 - Math.sqrt(0.75), 1);
    expect(sample(-3, 99, 7)).toBeCloseTo(sample(0, n - 1.001, 7), 6); // clamped to the grid
  });
});

describe('MeshBuilder', () => {
  it('packs 16 bytes per vertex with unit normals and the extra value', () => {
    const mesh = new MeshBuilder();
    const a = mesh.vertex(0, 0, 0, 0.5),
      b = mesh.vertex(1, 0, 0, -1),
      c = mesh.vertex(0, 0, -1, 2);
    mesh.triangle(a, b, c);
    const built = mesh.build();
    expect(built.vertexCount).toBe(3);
    expect(built.vertices.byteLength).toBe(48);
    expect(Array.from(new Float32Array(built.vertices, 16, 3))).toEqual([1, 0, 0]);
    const bytes = new Int8Array(built.vertices);
    expect(Array.from(bytes.subarray(12, 16))).toEqual([0, 127, 0, 64]); // normal +y, extra 0.5
    expect(bytes[31]).toBe(-127);
    expect(bytes[47]).toBe(127); // clamped
  });

  it('builds an icosphere with shared vertices', () => {
    for (const [subdivisions, vertices, triangles] of [
      [0, 12, 20],
      [1, 42, 80],
      [2, 162, 320],
      [3, 642, 1280],
    ] as const) {
      const mesh = icosphere(subdivisions);
      expect(mesh.vertexCount).toBe(vertices);
      expect(mesh.indices.length).toBe(triangles * 3);
      for (let k = 0; k < mesh.vertexCount; k++) {
        expect(Math.hypot(mesh.positions[k * 3]!, mesh.positions[k * 3 + 1]!, mesh.positions[k * 3 + 2]!)).toBeCloseTo(
          1,
          12,
        );
      }
    }
  });

  it('builds tubes and beams with valid indices', () => {
    const mesh = new MeshBuilder();
    mesh.tube(
      [
        [0, 0, 0],
        [0, 1, 0],
        [0.2, 2, 0],
      ],
      0.1,
      6,
    );
    mesh.sweep(
      [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0.5, 0],
      ],
      0.2,
      0.3,
    );
    expect(mesh.indices.length % 3).toBe(0);
    expect(Math.max(...mesh.indices)).toBeLessThan(mesh.vertexCount);
    expect(mesh.positions.every(Number.isFinite)).toBe(true);
  });
});

describe('the meshes', () => {
  it('are the 26 the renderer numbers, complete and well formed', { timeout: 60_000 }, () => {
    const high = buildMeshes(new Random(), 0);
    // vertices per mesh, as in the original at High: boulders, sponges, corals, tube sponge, whale tail, ship,
    // manta, fish, rock chunks and pebbles, far corals, far chunks
    expect(high.ranges.map((r) => r.vertexCount)).toEqual([
      642, 642, 642, 642, 180, 144, 144, 1492, 746, 549, 29358, 12192, 1693, 34, 162, 162, 162, 642, 642, 642, 42, 460,
      274, 162, 162, 162,
    ]);
    expect(high.vertices.length).toBe(844384);
    for (const range of high.ranges) {
      expect(range.indexCount % 3).toBe(0);
      const indices = high.indices.subarray(range.firstIndex, range.firstIndex + range.indexCount);
      expect(indices.reduce((most, i) => Math.max(most, i), 0)).toBeLessThan(range.vertexCount);
    }
    // Low: rocks one subdivision coarser, corals with three-sided branches
    const low = buildMeshes(new Random(), 2);
    expect(low.ranges[0]!.vertexCount).toBe(162);
    expect(low.ranges[7]!.vertexCount).toBeLessThan(1492);
  });
});

describe('specks', () => {
  it('turns rock that hangs free into water and keeps what is rooted or attached', () => {
    const density = new Float32Array(NX * NY * NZ).fill(-1);
    const at = (x: number, y: number, z: number) => x + NX * (y + NY * z);
    for (let y = 0; y < 10; y++) density[at(100, y, 100)] = 1; // a column standing on the bottom
    for (let x = 100; x < 106; x++) density[at(x, 9, 100)] = 1; // an overhang reaching out from its top
    density[at(105, 8, 100)] = 1; // rock hanging under the overhang's tip, above a gap
    density[at(200, 40, 200)] = 1; // a speck in open water
    density[at(201, 40, 200)] = 2; // ...two voxels of it
    removeSpecks(density);
    expect(density[at(100, 5, 100)]).toBe(1);
    expect(density[at(105, 9, 100)]).toBe(1);
    expect(density[at(105, 8, 100)]).toBe(1);
    expect(density[at(200, 40, 200)]).toBe(-1);
    expect(density[at(201, 40, 200)]).toBe(-2);
  });
});

describe('collision field', () => {
  it('stores only bricks the surface passes through', () => {
    // a flat seabed: rock below y = 20.5, the density being the depth in voxels
    const density = new Float32Array(NX * NY * NZ);
    for (let i = 0, z = 0; z < NZ; z++)
      for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++, i++) density[i] = 20.5 - y;
    const field = buildCollisionField(density);
    const brick = (bx: number, by: number, bz: number) => field.index[bx + COLLISION_BRICKS * (by + (NY / 4) * bz)];
    const centre = COLLISION_BRICKS / 2;
    expect(brick(centre, 2, centre)).toBe(ALL_ROCK);
    expect(brick(centre, 10, centre)).toBe(ALL_WATER);
    expect(brick(centre, 5, centre)).toBeGreaterThan(ALL_ROCK); // voxels 20..23: the surface
    expect(brick(0, 5, 0)).toBe(0); // a corner beyond the 156 m radius: never filled in
    // Stored distances are in 1/127 m, clamped at a metre. The density here falls by 1 per voxel; dividing by the
    // gradient (2 across two voxels, which are 1.5 m) turns it into metres: half a voxel is 0.375 m.
    const stored = field.bricks.subarray((brick(centre, 5, centre)! - 2) * 64, (brick(centre, 5, centre)! - 1) * 64);
    expect(stored[0]).toBe(Math.round(0.375 * 127)); // y = 20: half a voxel inside the rock
    expect(stored[4]).toBe(Math.round(-0.375 * 127)); // y = 21: half a voxel outside
    expect(stored[12]).toBe(-127); // y = 23
    expect(field.bricks.length % 64).toBe(0);
    expect(COLLISION_OFFSET + COLLISION_BRICKS * 4).toBeLessThanOrEqual(NX);
  });
});

describe('layout and maps', () => {
  it('packs the shapes eight floats each, in the order the shader walks them', () => {
    const shapes = packShapes();
    expect(shapes.length).toBe((ROCK_MASSES.length + ARCHES.length + TUNNELS.length + CLEARINGS.length) * 8);
    expect(Array.from(shapes.subarray(0, 8))).toEqual(ROCK_MASSES[0]!.map(Math.fround));
    const firstArch = ROCK_MASSES.length * 8;
    expect(shapes[firstArch + 7]).toBe(0); // padded
    expect(shapes[firstArch + 4]).toBeCloseTo(ARCHES[0]![4]!, 6);
  });

  it('puts the grotto and the magenta where the layout says', () => {
    expect(grottoAt(6, 84)).toBe(1);
    expect(grottoAt(6, 84 + 50)).toBe(0);
    expect(magentaAt(6, 84)).toBeGreaterThan(0.2); // the middle of a 30 m disc
    expect(smoothRamp(44, 26, 35)).toBeCloseTo(0.5, 6);
    const map = buildGroundMap();
    expect(map.length).toBe(512 * 512 * 4);
    const texel = (x: number, z: number) =>
      (Math.floor(((x + 192) / 384) * 512) + 512 * Math.floor(((z + 192) / 384) * 512)) * 4;
    expect(map[texel(6, 84) + 2]).toBe(255);
    expect(map[texel(-150, -150) + 2]).toBe(0);
  });

  it('keeps the flight path clear along its whole length and under every viewpoint', () => {
    const points = clearancePoints(VIEWPOINTS);
    expect(points.length).toBe((600 + VIEWPOINTS.length) * 3);
    const start = new Float64Array(6);
    flyPoint(0, start);
    expect(Array.from(points.subarray(0, 3))).toEqual(Array.from(start.subarray(0, 3)));
    expect(points[points.length - 2]).toBe(-40);
    const end = new Float64Array(6);
    flyPoint(FLY_SECONDS + 5, end);
    expect(end[0]).toBeCloseTo(4, 3); // the last authored point
  });
});
