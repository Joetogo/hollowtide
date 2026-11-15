// Writes tests/unit/fixtures/reference-frames.json from a reference capture (npm run ref:capture): the original's
// frame uniform block at its six viewpoints and along its fly-through, for the unit tests to compare against.
// The file is small and committed, so those tests also run where there is no GPU.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { outDir, root, upstream } from './build-ref.mjs';

const manifest = JSON.parse(readFileSync(path.join(outDir, upstream.sha.slice(0, 7), 'L0/manifest.json'), 'utf8'));
const shots = Object.entries(manifest.shots);
const flyShots = shots.filter(([id]) => id.startsWith('fly'));
const out = {
  upstream: manifest.upstream,
  view: manifest.view,
  constants: manifest.meta.constants,
  sun: manifest.meta.sun,
  poses: manifest.meta.poses,
  frames: shots
    .filter(([id]) => id.startsWith('pose'))
    .map(([id, s]) => ({
      id,
      pose: +id[4] - 1,
      time: +id.split('_t')[1],
      width: s.width,
      height: s.height,
      uniforms: s.uniforms,
    })),
  // frame i of n is captured at (i + 0.5) / n of the 60 s flight, with the scene time equal to the flight time
  fly: flyShots.map(([id, s], i) => ({
    id,
    seconds: ((i + 0.5) * manifest.meta.constants.FLYT) / flyShots.length,
    width: s.width,
    height: s.height,
    uniforms: s.uniforms,
  })),
};
const file = path.join(root, 'tests/unit/fixtures/reference-frames.json');
writeFileSync(file, JSON.stringify(out) + '\n');
console.log(
  `${path.relative(root, file)}: ${out.frames.length} viewpoint frames, ${out.fly.length} fly-through frames`,
);
