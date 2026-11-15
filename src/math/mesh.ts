// Building meshes in code. Every mesh in the world uses one vertex format: 16 bytes, a float32 position and four
// signed bytes holding the normal and one extra value per vertex (ambient occlusion, or whatever the shader that
// draws the mesh wants there).
import { clamp, TAU } from './scalar';

export type Point = readonly [number, number, number];

/** A finished mesh: packed vertices and 32-bit triangle indices. */
export interface BuiltMesh {
  vertices: ArrayBuffer;
  indices: Uint32Array;
  vertexCount: number;
}

type PerRing = number | ((ring: number) => number);
const at = (value: PerRing, ring: number) => (typeof value === 'function' ? value(ring) : value);

export class MeshBuilder {
  /** x, y, z per vertex */
  readonly positions: number[] = [];
  readonly indices: number[] = [];
  /** the extra value per vertex, -1..1 */
  readonly extra: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  /** Adds a vertex and returns its index. */
  vertex(x: number, y: number, z: number, extra = 1): number {
    this.positions.push(x, y, z);
    this.extra.push(extra);
    return this.positions.length / 3 - 1;
  }

  triangle(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.indices.push(a, b, c, a, c, d);
  }

  /**
   * A beam with a rectangular section along a polyline. Each face gets its own vertices, so the edges stay hard.
   * `up` gives the direction the section's height points in at each point (default: straight up).
   */
  sweep(
    points: readonly Point[],
    width: PerRing,
    height: PerRing,
    up?: (p: Point, k: number) => Point,
    caps = true,
  ): void {
    const rings: number[][] = [];
    for (let k = 0; k < points.length; k++) {
      const p = points[k]!;
      const a = points[Math.max(k - 1, 0)]!;
      const b = points[Math.min(k + 1, points.length - 1)]!;
      // tangent, then the section's sideways and upward axes
      let tx = b[0] - a[0],
        ty = b[1] - a[1],
        tz = b[2] - a[2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      const u0 = up ? up(p, k) : [0, 1, 0];
      let sx = u0[1]! * tz - u0[2]! * ty,
        sy = u0[2]! * tx - u0[0]! * tz,
        sz = u0[0]! * ty - u0[1]! * tx;
      const sl = Math.hypot(sx, sy, sz) || 1;
      sx /= sl;
      sy /= sl;
      sz /= sl;
      const ux = ty * sz - tz * sy,
        uy = tz * sx - tx * sz,
        uz = tx * sy - ty * sx;
      const w = at(width, k),
        h = at(height, k);
      const corners = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([e, f]): [number, number, number] => [
        p[0] + (sx * e! * w) / 2 + (ux * f! * h) / 2,
        p[1] + (sy * e! * w) / 2 + (uy * f! * h) / 2,
        p[2] + (sz * e! * w) / 2 + (uz * f! * h) / 2,
      ]);
      const ring: number[] = [];
      for (let s = 0; s < 4; s++) ring.push(this.vertex(...corners[s]!), this.vertex(...corners[(s + 1) % 4]!));
      rings.push(ring);
      if (caps && (k === 0 || k === points.length - 1)) {
        const q = corners.map((c) => this.vertex(...c));
        if (k === 0) this.quad(q[0]!, q[1]!, q[2]!, q[3]!);
        else this.quad(q[3]!, q[2]!, q[1]!, q[0]!);
      }
    }
    for (let k = 0; k < rings.length - 1; k++) {
      for (let s = 0; s < 4; s++) {
        const a = rings[k]![s * 2]!,
          b = rings[k]![s * 2 + 1]!,
          c = rings[k + 1]![s * 2 + 1]!,
          d = rings[k + 1]![s * 2]!;
        this.quad(a, d, c, b);
      }
    }
  }

  /**
   * A round tube along a polyline. `extra` gives the vertices' extra value per ring; by default it rises from
   * 0.35 at the start to 1 at the end.
   */
  tube(
    points: readonly Point[],
    radius: PerRing,
    sides = 6,
    capEnd = true,
    extra: ((ring: number) => number) | null = null,
  ): void {
    const rings: number[][] = [];
    // the frame is carried along the tube from this starting guess, so it does not twist
    let ux = 0.31,
      uy = 0.9,
      uz = 0.3;
    for (let k = 0; k < points.length; k++) {
      const p = points[k]!;
      const a = points[Math.max(k - 1, 0)]!;
      const b = points[Math.min(k + 1, points.length - 1)]!;
      let tx = b[0] - a[0],
        ty = b[1] - a[1],
        tz = b[2] - a[2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      let sx = uy * tz - uz * ty,
        sy = uz * tx - ux * tz,
        sz = ux * ty - uy * tx;
      const sl = Math.hypot(sx, sy, sz) || 1;
      sx /= sl;
      sy /= sl;
      sz /= sl;
      ux = ty * sz - tz * sy;
      uy = tz * sx - tx * sz;
      uz = tx * sy - ty * sx;
      const r = at(radius, k);
      const ring: number[] = [];
      for (let s = 0; s < sides; s++) {
        const angle = (s / sides) * TAU;
        ring.push(
          this.vertex(
            p[0] + (sx * Math.cos(angle) + ux * Math.sin(angle)) * r,
            p[1] + (sy * Math.cos(angle) + uy * Math.sin(angle)) * r,
            p[2] + (sz * Math.cos(angle) + uz * Math.sin(angle)) * r,
            extra ? extra(k) : Math.min(1, 0.35 + (0.65 * k) / (points.length - 1)),
          ),
        );
      }
      rings.push(ring);
    }
    for (let k = 0; k < rings.length - 1; k++) {
      for (let s = 0; s < sides; s++) {
        const s2 = (s + 1) % sides;
        this.quad(rings[k]![s]!, rings[k]![s2]!, rings[k + 1]![s2]!, rings[k + 1]![s]!);
      }
    }
    if (capEnd) {
      const end = points[points.length - 1]!;
      const centre = this.vertex(end[0], end[1], end[2], extra ? extra(points.length - 1) : 1);
      const last = rings[rings.length - 1]!;
      for (let s = 0; s < sides; s++) this.triangle(last[s]!, last[(s + 1) % sides]!, centre);
    }
  }

  /** Packs the mesh. Normals are the area-weighted mean of the faces around each vertex. */
  build(): BuiltMesh {
    const n = this.vertexCount;
    const P = this.positions;
    const I = this.indices;
    const normals = new Float32Array(n * 3);
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t]! * 3,
        b = I[t + 1]! * 3,
        c = I[t + 2]! * 3;
      const ux = P[b]! - P[a]!,
        uy = P[b + 1]! - P[a + 1]!,
        uz = P[b + 2]! - P[a + 2]!;
      const vx = P[c]! - P[a]!,
        vy = P[c + 1]! - P[a + 1]!,
        vz = P[c + 2]! - P[a + 2]!;
      const nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
      for (const k of [a, b, c]) {
        normals[k]! += nx;
        normals[k + 1]! += ny;
        normals[k + 2]! += nz;
      }
    }
    const vertices = new ArrayBuffer(n * 16);
    const floats = new Float32Array(vertices);
    const bytes = new Int8Array(vertices);
    for (let k = 0; k < n; k++) {
      const nx = normals[k * 3]!,
        ny = normals[k * 3 + 1]!,
        nz = normals[k * 3 + 2]!;
      const length = Math.hypot(nx, ny, nz) || 1;
      floats[k * 4] = P[k * 3]!;
      floats[k * 4 + 1] = P[k * 3 + 1]!;
      floats[k * 4 + 2] = P[k * 3 + 2]!;
      bytes[k * 16 + 12] = Math.round((nx / length) * 127);
      bytes[k * 16 + 13] = Math.round((ny / length) * 127);
      bytes[k * 16 + 14] = Math.round((nz / length) * 127);
      bytes[k * 16 + 15] = Math.round(clamp(this.extra[k]!, -1, 1) * 127);
    }
    return { vertices, indices: new Uint32Array(I), vertexCount: n };
  }
}

/**
 * A sphere of near-equal triangles: an icosahedron subdivided `subdivisions` times, vertices shared.
 * `shape` moves each unit-sphere vertex to where it should be.
 */
export function icosphere(subdivisions: number, shape?: (x: number, y: number, z: number) => Point): MeshBuilder {
  const mesh = new MeshBuilder();
  const t = (1 + Math.sqrt(5)) / 2;
  const V: number[][] = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ].map((v) => {
    const length = Math.hypot(...v);
    return v.map((c) => c / length);
  });
  let F: number[][] = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  for (let s = 0; s < subdivisions; s++) {
    const midpoints = new Map<number, number>();
    const next: number[][] = [];
    const mid = (a: number, b: number) => {
      const key = a < b ? a * 65536 + b : b * 65536 + a;
      let r = midpoints.get(key);
      if (r === undefined) {
        const p = [0, 1, 2].map((k) => V[a]![k]! + V[b]![k]!);
        const length = Math.hypot(...p);
        V.push(p.map((c) => c / length));
        r = V.length - 1;
        midpoints.set(key, r);
      }
      return r;
    };
    for (const [a, b, c] of F as [number, number, number][]) {
      const ab = mid(a, b),
        bc = mid(b, c),
        ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    F = next;
  }
  for (const v of V) {
    const p = shape ? shape(v[0]!, v[1]!, v[2]!) : v;
    mesh.vertex(p[0]!, p[1]!, p[2]!);
  }
  for (const f of F) mesh.triangle(f[0]!, f[1]!, f[2]!);
  return mesh;
}
