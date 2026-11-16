// The stone whale tail: three chains of tapered capsules (the stock and the two flukes) blended into one smooth
// shape as a distance field, then meshed like the terrain.
import { sampler, surfaceNets } from '../../math/field';
import type { BuiltMesh } from '../../math/mesh';
import { clamp, mix } from '../../math/scalar';
import { hypot3 } from '../../math/hypot';

/** A chain of points x, y, z, radius; `squash` flattens the chain along z. */
type Chain = { points: readonly (readonly [number, number, number, number])[]; squash: number };

const CHAINS: Chain[] = [
  {
    points: [
      [0, -1.6, 3.7, 1.2],
      [0, 1.8, 2.35, 0.98],
      [0, 4.6, 1.0, 0.76],
      [0, 6.9, 0.1, 0.6],
    ],
    squash: 0.8,
  },
  {
    points: [
      [0, 6.6, 0.1, 0.72],
      [1.9, 7.9, 0, 0.98],
      [3.9, 8.8, -0.1, 0.9],
      [5.7, 9.8, -0.25, 0.64],
      [7.0, 11.2, -0.4, 0.38],
      [7.7, 12.8, -0.55, 0.2],
      [7.9, 14.1, -0.65, 0.1],
    ],
    squash: 0.18,
  },
  {
    points: [
      [0, 6.6, 0.1, 0.72],
      [-1.7, 8.3, 0.05, 0.96],
      [-3.3, 9.7, -0.05, 0.88],
      [-4.7, 11.2, -0.2, 0.64],
      [-5.6, 12.9, -0.4, 0.38],
      [-6.0, 14.6, -0.5, 0.2],
      [-5.9, 15.9, -0.6, 0.1],
    ],
    squash: 0.18,
  },
];

export function whaleFluke(): BuiltMesh {
  // capsules: ax, ay, az, radius a, bx, by, bz, radius b, squash
  const capsules: number[][] = [];
  for (const { points, squash } of CHAINS) {
    for (let i = 0; i < points.length - 1; i++) capsules.push([...points[i], ...points[i + 1], squash]);
  }
  // A ball around each capsule, in the space where its z is divided by its squash: centre x, y, z, and the
  // capsule's half length plus its larger radius. Nothing of the capsule lies outside it.
  const balls = capsules.map((c) => {
    const az = c[2] / c[8],
      bz = c[6] / c[8];
    return [
      (c[0] + c[4]) / 2,
      (c[1] + c[5]) / 2,
      (az + bz) / 2,
      hypot3(c[4] - c[0], c[5] - c[1], bz - az) / 2 + Math.max(c[3], c[7]),
    ];
  });
  const k = 0.45; // how far apart two surfaces still blend
  /** Distance to the shape, negative inside: the capsules merged with a smooth minimum. */
  const distance = (x: number, y: number, z: number) => {
    let d = 1e9;
    for (let n = 0; n < capsules.length; n++) {
      const c = capsules[n];
      const zs = c[8],
        pz = z / zs;
      // A capsule further away than the distance so far plus the blending range changes nothing: the blend
      // below is then zero and the minimum keeps d, bit for bit. The ball tells without measuring the capsule
      // (the 1e-6 is a margin a million times the rounding error of these sums). Most capsules go this way,
      // and this function runs 46 million times.
      const ball = balls[n];
      const reach = (d + k + 1e-6) / zs + ball[3];
      const ox = x - ball[0],
        oy = y - ball[1],
        oz = pz - ball[2];
      if (reach <= 0 || ox * ox + oy * oy + oz * oz >= reach * reach * (1 + 1e-9)) continue;
      const az = c[2] / zs,
        bz = c[6] / zs;
      const bax = c[4] - c[0],
        bay = c[5] - c[1],
        baz = bz - az;
      const pax = x - c[0],
        pay = y - c[1],
        paz = pz - az;
      const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
      const e = (hypot3(pax - bax * h, pay - bay * h, paz - baz * h) - mix(c[3], c[7], h)) * zs;
      const hh = Math.max(k - Math.abs(d - e), 0) / k;
      d = Math.min(d, e) - hh * hh * k * 0.25;
    }
    return d;
  };
  // sampled on a 9 cm grid around the shape
  const voxel = 0.09,
    ox = -7.6,
    oy = -2.6,
    oz = -2.2,
    nx = 186,
    ny = 216,
    nz = 76;
  const field = new Float32Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++)
        field[x + nx * (y + ny * z)] = -distance(ox + x * voxel, oy + y * voxel, oz + z * voxel);
    }
  }
  const net = surfaceNets(field, nx, ny, nz);
  const sample = sampler(field, nx, ny, nz);
  const vertices = new ArrayBuffer(net.vertexCount * 16);
  const floats = new Float32Array(vertices);
  const bytes = new Int8Array(vertices);
  for (let k = 0; k < net.vertexCount; k++) {
    const x = net.positions[k * 3],
      y = net.positions[k * 3 + 1],
      z = net.positions[k * 3 + 2];
    const e = 0.7;
    const ax = sample(x - e, y, z) - sample(x + e, y, z);
    const ay = sample(x, y - e, z) - sample(x, y + e, z);
    const az = sample(x, y, z - e) - sample(x, y, z + e);
    const length = hypot3(ax, ay, az) || 1;
    floats[k * 4] = ox + x * voxel;
    floats[k * 4 + 1] = oy + y * voxel;
    floats[k * 4 + 2] = oz + z * voxel;
    bytes[k * 16 + 12] = Math.round((ax / length) * 127);
    bytes[k * 16 + 13] = Math.round((ay / length) * 127);
    bytes[k * 16 + 14] = Math.round((az / length) * 127);
    bytes[k * 16 + 15] = 127;
  }
  return { vertices, indices: new Uint32Array(net.indices), vertexCount: net.vertexCount };
}
