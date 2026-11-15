// Scalar fields on a grid: a mesh of the zero surface (surface nets) and a trilinear sampler.
import { clamp, mix } from './scalar';

export interface NetMesh {
  /** vertex positions in grid units: x, y, z per vertex */
  positions: Float32Array;
  /** triangles; they come in pairs, one quad (6 indices) per crossed grid edge */
  indices: Uint32Array;
  vertexCount: number;
  indexCount: number;
}

/**
 * Surface nets: one vertex in every grid cell the surface passes through, placed at the mean of where the surface
 * crosses the cell's edges, and one quad for every grid edge that crosses it. `field` is positive inside,
 * stored x fastest, then y, then z. Triangles face outwards.
 */
export function surfaceNets(field: Float32Array, nx: number, ny: number, nz: number): NetMesh {
  let positions = new Float32Array(1 << 20);
  let vertexCount = 0;
  let indices = new Uint32Array(1 << 21);
  let ni = 0;
  const slab = nx * ny;
  // the vertex of each cell in the current and the previous z layer
  let current = new Int32Array(slab);
  let previous = new Int32Array(slab);
  for (let z = 0; z < nz - 1; z++) {
    for (let y = 0; y < ny - 1; y++) {
      let i0 = nx * (y + ny * z);
      for (let x = 0; x < nx - 1; x++, i0++) {
        const d0 = field[i0]!,
          d1 = field[i0 + 1]!,
          d2 = field[i0 + nx]!,
          d3 = field[i0 + nx + 1]!;
        const d4 = field[i0 + slab]!,
          d5 = field[i0 + slab + 1]!,
          d6 = field[i0 + slab + nx]!,
          d7 = field[i0 + slab + nx + 1]!;
        const s0 = d0 > 0,
          s1 = d1 > 0,
          s2 = d2 > 0,
          s3 = d3 > 0,
          s4 = d4 > 0,
          s5 = d5 > 0,
          s6 = d6 > 0,
          s7 = d7 > 0;
        // all eight corners on the same side: the surface does not pass through this cell
        if (s0 === s1 && s0 === s2 && s0 === s3 && s0 === s4 && s0 === s5 && s0 === s6 && s0 === s7) continue;
        // where the surface crosses each of the twelve edges, summed
        let sx = 0,
          sy = 0,
          sz = 0,
          n = 0,
          t;
        if (s0 !== s1) {
          t = d0 / (d0 - d1);
          sx += t;
          n++;
        }
        if (s2 !== s3) {
          t = d2 / (d2 - d3);
          sx += t;
          sy += 1;
          n++;
        }
        if (s4 !== s5) {
          t = d4 / (d4 - d5);
          sx += t;
          sz += 1;
          n++;
        }
        if (s6 !== s7) {
          t = d6 / (d6 - d7);
          sx += t;
          sy += 1;
          sz += 1;
          n++;
        }
        if (s0 !== s2) {
          t = d0 / (d0 - d2);
          sy += t;
          n++;
        }
        if (s1 !== s3) {
          t = d1 / (d1 - d3);
          sy += t;
          sx += 1;
          n++;
        }
        if (s4 !== s6) {
          t = d4 / (d4 - d6);
          sy += t;
          sz += 1;
          n++;
        }
        if (s5 !== s7) {
          t = d5 / (d5 - d7);
          sy += t;
          sx += 1;
          sz += 1;
          n++;
        }
        if (s0 !== s4) {
          t = d0 / (d0 - d4);
          sz += t;
          n++;
        }
        if (s1 !== s5) {
          t = d1 / (d1 - d5);
          sz += t;
          sx += 1;
          n++;
        }
        if (s2 !== s6) {
          t = d2 / (d2 - d6);
          sz += t;
          sy += 1;
          n++;
        }
        if (s3 !== s7) {
          t = d3 / (d3 - d7);
          sz += t;
          sx += 1;
          sy += 1;
          n++;
        }
        if (vertexCount * 3 + 3 > positions.length) {
          const grown = new Float32Array(positions.length * 2);
          grown.set(positions);
          positions = grown;
        }
        const v = vertexCount++;
        positions[v * 3] = x + sx / n;
        positions[v * 3 + 1] = y + sy / n;
        positions[v * 3 + 2] = z + sz / n;
        const cell = x + nx * y;
        current[cell] = v;
        if (ni + 18 > indices.length) {
          const grown = new Uint32Array(indices.length * 2);
          grown.set(indices);
          indices = grown;
        }
        // a quad around each of the three edges leaving corner 0 that the surface crosses, joining the four
        // cells that share the edge; wound so that it faces away from the inside
        let a, b, c, d;
        if (s1 !== s0 && y > 0 && z > 0) {
          a = v;
          b = current[cell - nx]!;
          c = previous[cell - nx]!;
          d = previous[cell]!;
          if (s0) {
            indices[ni++] = a;
            indices[ni++] = b;
            indices[ni++] = c;
            indices[ni++] = a;
            indices[ni++] = c;
            indices[ni++] = d;
          } else {
            indices[ni++] = a;
            indices[ni++] = c;
            indices[ni++] = b;
            indices[ni++] = a;
            indices[ni++] = d;
            indices[ni++] = c;
          }
        }
        if (s2 !== s0 && x > 0 && z > 0) {
          a = v;
          b = previous[cell]!;
          c = previous[cell - 1]!;
          d = current[cell - 1]!;
          if (s0) {
            indices[ni++] = a;
            indices[ni++] = b;
            indices[ni++] = c;
            indices[ni++] = a;
            indices[ni++] = c;
            indices[ni++] = d;
          } else {
            indices[ni++] = a;
            indices[ni++] = c;
            indices[ni++] = b;
            indices[ni++] = a;
            indices[ni++] = d;
            indices[ni++] = c;
          }
        }
        if (s4 !== s0 && x > 0 && y > 0) {
          a = v;
          b = current[cell - 1]!;
          c = current[cell - 1 - nx]!;
          d = current[cell - nx]!;
          if (s0) {
            indices[ni++] = a;
            indices[ni++] = b;
            indices[ni++] = c;
            indices[ni++] = a;
            indices[ni++] = c;
            indices[ni++] = d;
          } else {
            indices[ni++] = a;
            indices[ni++] = c;
            indices[ni++] = b;
            indices[ni++] = a;
            indices[ni++] = d;
            indices[ni++] = c;
          }
        }
      }
    }
    const swap = current;
    current = previous;
    previous = swap;
  }
  return {
    positions: positions.subarray(0, vertexCount * 3),
    indices: indices.subarray(0, ni),
    vertexCount,
    indexCount: ni,
  };
}

/** A sampler of `field` at fractional grid coordinates: trilinear, clamped to the grid. */
export function sampler(
  field: Float32Array,
  nx: number,
  ny: number,
  nz: number,
): (x: number, y: number, z: number) => number {
  const slab = nx * ny;
  return (x, y, z) => {
    x = clamp(x, 0, nx - 1.001);
    y = clamp(y, 0, ny - 1.001);
    z = clamp(z, 0, nz - 1.001);
    const ix = x | 0,
      iy = y | 0,
      iz = z | 0;
    const fx = x - ix,
      fy = y - iy,
      fz = z - iz;
    const i = ix + nx * (iy + ny * iz);
    const a = mix(mix(field[i]!, field[i + 1]!, fx), mix(field[i + nx]!, field[i + nx + 1]!, fx), fy);
    const b = mix(
      mix(field[i + slab]!, field[i + slab + 1]!, fx),
      mix(field[i + slab + nx]!, field[i + slab + nx + 1]!, fx),
      fy,
    );
    return mix(a, b, fz);
  };
}
