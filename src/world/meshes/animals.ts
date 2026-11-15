// The two animals: a manta ray and a fish. Their motion is added by the vertex shader (shaders/creatures.wgsl).
import { MeshBuilder, type Point } from '../../math/mesh';
import { mix, TAU } from '../../math/scalar';

/**
 * A manta ray. The wingspan runs along x from -1 to 1 and the nose points along +z. The vertices' extra value is
 * their position along the span, which is what the wing beat travels along (0 for the tail, so it stays still).
 */
export function manta(): MeshBuilder {
  const mesh = new MeshBuilder();
  const SECTIONS = 72; // across the span
  const AROUND = 22; // around each section
  const rings: number[][] = [];
  for (let j = 0; j <= SECTIONS; j++) {
    const u = (j / SECTIONS) * 2 - 1;
    const span = Math.abs(u);
    // each section is a flattened loop from the leading edge (z) to the trailing edge, thickest at the body
    let leading =
      0.52 -
      0.74 * Math.pow(span, 1.35) +
      0.07 * Math.exp(-Math.pow((span - 0.13) / 0.05, 2)) -
      0.05 * Math.exp(-Math.pow(span / 0.05, 2)) -
      0.08 * Math.pow(span, 5);
    const trailing = -0.5 + 0.3 * Math.pow(span, 0.8) + 0.02 - 0.08 * Math.pow(span, 5);
    if (leading < trailing + 0.004) leading = trailing + 0.004;
    const thickness = 0.08 * Math.pow(1 - span, 1.15) + 0.004 + 0.12 * Math.exp(-Math.pow(u / 0.2, 2));
    const ring: number[] = [];
    for (let k = 0; k < AROUND; k++) {
      const a = (k / AROUND) * TAU;
      ring.push(
        mesh.vertex(
          u,
          thickness * Math.sin(a) * (0.62 + 0.38 * Math.cos(a)),
          mix(trailing, leading, 0.5 + 0.5 * Math.cos(a)),
          u,
        ),
      );
    }
    rings.push(ring);
  }
  for (let j = 0; j < SECTIONS; j++) {
    for (let k = 0; k < AROUND; k++) {
      const k2 = (k + 1) % AROUND;
      mesh.quad(rings[j][k], rings[j + 1][k], rings[j + 1][k2], rings[j][k2]);
    }
  }
  // the tail
  const tail: Point[] = [];
  for (let i = 0; i <= 8; i++) tail.push([0, 0, -0.42 - i * 0.19]);
  const tailStart = mesh.vertexCount;
  mesh.tube(tail, (k) => 0.016 * (1 - k / 9), 4, true);
  for (let k = tailStart; k < mesh.extra.length; k++) mesh.extra[k] = 0;
  // the two fins beside the mouth
  for (const side of [-1, 1]) {
    const finStart = mesh.vertexCount;
    mesh.tube(
      [
        [side * 0.12, -0.02, 0.48],
        [side * 0.135, -0.05, 0.6],
        [side * 0.115, -0.09, 0.69],
        [side * 0.085, -0.125, 0.74],
      ],
      (k) => 0.045 * (1 - k / 4.4),
      6,
      true,
    );
    for (let k = finStart; k < mesh.extra.length; k++) mesh.extra[k] = side * 0.1;
  }
  return mesh;
}

/** A fish: five rings from nose to tail root and a two-triangle tail fin. The nose points along +x. */
export function fish(): MeshBuilder {
  const mesh = new MeshBuilder();
  const X = [0.5, 0.3, 0.05, -0.22, -0.34];
  const HEIGHT = [0.01, 0.13, 0.17, 0.09, 0.035];
  const WIDTH = [0.01, 0.05, 0.065, 0.03, 0.012];
  const rings: number[][] = [];
  for (let i = 0; i < 5; i++) {
    const ring: number[] = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      ring.push(mesh.vertex(X[i], Math.sin(a) * HEIGHT[i], Math.cos(a) * WIDTH[i]));
    }
    rings.push(ring);
  }
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 6; k++) {
      const k2 = (k + 1) % 6;
      mesh.quad(rings[i][k], rings[i + 1][k], rings[i + 1][k2], rings[i][k2]);
    }
  }
  const a = mesh.vertex(-0.33, 0, 0),
    b = mesh.vertex(-0.56, 0.2, 0),
    c = mesh.vertex(-0.47, 0, 0),
    d = mesh.vertex(-0.56, -0.2, 0);
  mesh.triangle(a, b, c);
  mesh.triangle(a, c, d);
  return mesh;
}
