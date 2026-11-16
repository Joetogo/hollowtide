// Entry for tools/profile-generator.mjs: the generator's stages run in Node on the original's dumped density
// field, each timed. Everything here is plain computation, so Node's CPU profiler can see into it.
import { readFileSync } from 'node:fs';
import { clearancePoints } from '../../src/camera/path';
import type { Level } from '../../src/config/quality';
import { Random } from '../../src/math/random';
import { buildCollisionField } from '../../src/world/collision';
import { buildGroundMap } from '../../src/world/groundMap';
import { VIEWPOINTS } from '../../src/world/layout';
import { buildMeshes } from '../../src/world/meshes';
import { scatter } from '../../src/world/scatter';
import { buildTerrain, removeSpecks } from '../../src/world/terrain';

const [file, levelText = '0'] = process.argv.slice(2);
const level = Number(levelText) as Level;
const bytes = readFileSync(file!);
const density = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4).slice();

const timings: [string, number][] = [];
function time<T>(name: string, run: () => T): T {
  const start = performance.now();
  const result = run();
  timings.push([name, performance.now() - start]);
  return result;
}

time('specks', () => removeSpecks(density));
time('collision', () => buildCollisionField(density));
const terrain = time('terrain', () => buildTerrain(density));
const flyPoints = time('fly path', () => clearancePoints(VIEWPOINTS));
time('ground map', () => buildGroundMap());
time('meshes', () => buildMeshes(new Random(), level));
let half = 0;
const start = performance.now();
time('scatter', () =>
  scatter(new Random(), level, density, terrain, flyPoints, VIEWPOINTS, () => (half = performance.now())),
);
timings.push(['  plants', half - start], ['  rocks', performance.now() - half]);

for (const [name, ms] of timings) console.log(`${name.padEnd(12)} ${ms.toFixed(0).padStart(6)} ms`);
