// The rebuild's own world generator against the original: the density field, and everything the worker makes
// from it, must have the same SHA-256 as what the original computed. Needs the reference manifest of each level:
// `npm run ref:dump -- --level N`.
//   node tests/browser/generator.mjs [levels, default 0,1,2]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { check, finish, fixturesDir, launch, need, root, serve } from './lib.mjs';

const page = path.join(root, 'dist/index.harness.html');
need(page, 'run `npm run build:harness`');
const levels = (process.argv[2] ?? '0,1,2').split(',').map(Number);
const NAMES = ['High', 'Medium', 'Low'];

const host = await serve(page);
const chrome = await launch();
try {
  const { error } = await chrome.open(host.origin + '/', { pause: true });
  check(!error, `starts${error ? ': ' + error : ''}`);
  for (const level of levels) {
    need(path.join(fixturesDir(level), 'index.json'), `run \`npm run ref:dump -- --level ${level}\``);
    const reference = JSON.parse(readFileSync(path.join(fixturesDir(level), 'index.json'), 'utf8')).data;
    const started = Date.now();
    const made = await chrome.page.evaluate((level) => window.__abyssal.harness.generate(level), level);
    const names = Object.keys(made);
    console.log(`${NAMES[level]}: ${names.length} outputs in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    for (const name of names) {
      const theirs = reference[name];
      const same = theirs && theirs.sha256 === made[name].sha256;
      check(
        same,
        `${NAMES[level]} ${name}: ${made[name].length} values` +
          (same
            ? ''
            : theirs
              ? ` differ from the original's ${theirs.length}`
              : ' (the original has nothing by this name)'),
      );
    }
    const missing = Object.keys(reference).filter((name) => !(name in made));
    if (missing.length)
      console.log(
        `       not generated yet: ${missing.length} of the original's ${Object.keys(reference).length} outputs`,
      );
  }
  const gpuErrors = await chrome.page.evaluate(() => window.__abyssal.harness.gpuErrors());
  check(gpuErrors.length === 0, `no shader or validation errors${gpuErrors.length ? ': ' + gpuErrors.join('; ') : ''}`);
  check(chrome.errors.length === 0, `no console errors${chrome.errors.length ? ': ' + chrome.errors.join('; ') : ''}`);
} finally {
  await chrome.close();
  host.close();
}
finish();
