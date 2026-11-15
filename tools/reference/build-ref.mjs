// Builds the reference page from the pristine upstream clone plus the capture hooks in this folder.
//
// The clone is never edited and nothing is run inside it: this script reads upstream's sources and concatenates
// them the way upstream's own build.mjs does (one async function, fixed file order), with two hook files slotted
// in. Output goes to .cache/reference/ in this repo:
//   reference.html        capture and dump runs (upstream's shipped file list + hooks)
//   reference-bench.html  baseline timings (adds upstream's dev.js for its scripted fly-through benchmark)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '../..');
export const upstream = JSON.parse(readFileSync(path.join(here, 'upstream.json'), 'utf8'));
export const cloneDir = path.resolve(root, process.env.ABYSSAL_REF ?? upstream.path);
export const outDir = path.join(root, '.cache/reference');

const git = (...args) => execFileSync('git', ['-C', cloneDir, ...args], { encoding: 'utf8' }).trim();

export function buildReference() {
  const sha = git('rev-parse', 'HEAD');
  if (sha !== upstream.sha)
    throw new Error(`reference clone is at ${sha}, expected ${upstream.sha} (see upstream.json)`);
  if (git('status', '--porcelain'))
    throw new Error(`reference clone at ${cloneDir} has local changes; it must stay pristine`);

  const src = (f) => readFileSync(path.join(cloneDir, 'source/src', f), 'utf8');
  const hook = (f) => readFileSync(path.join(here, f), 'utf8');
  const template = readFileSync(path.join(cloneDir, 'source/template.html'), 'utf8');
  // same wrapper as upstream's build.mjs, plus the error is kept where the harness can read it
  const wrap = (body) =>
    `(async()=>{${body}\n})().catch(e=>{console.error(e);document.body.className='l e';` +
    `document.getElementById('s').textContent=(e.cause?'':'Failed to start: ')+e.message;` +
    `(window.__ref||(window.__ref={})).error=String(e&&e.stack||e)});`;

  const page = (files) => template.replace('/*SCRIPT*/', () => wrap(files.join('\n')));
  // upstream order: quality, math, shaders, world, main, audio (+ dev)
  const head = [
    src('quality.js'),
    src('math.js'),
    src('shaders.js'),
    src('world.js'),
    hook('capture-pre.js'),
    src('main.js'),
    src('audio.js'),
  ];
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'reference.html'), page([...head, hook('capture-post.js')]));
  writeFileSync(path.join(outDir, 'reference-bench.html'), page([...head, src('dev.js'), hook('capture-post.js')]));
  return { sha, outDir };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { sha } = buildReference();
  console.log(`reference pages written to ${path.relative(root, outDir)}/ from upstream ${sha.slice(0, 7)}`);
}
