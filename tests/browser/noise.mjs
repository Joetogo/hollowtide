// How much does the original vary between two loads of the same code? Compares two captures of it, frame by
// frame, and saves a picture of where they differ. The answer is the floor below which a difference between the
// rebuild and the original means nothing.
//   npm run ref:capture -- --level 2 --fly 0             (once)
//   npm run ref:capture -- --level 2 --fly 0 --tag b     (a second, separate load)
//   node tests/browser/noise.mjs 2
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { launch, need, root, serve, shotsDir } from './lib.mjs';

const level = process.argv[2] ?? '2';
const page = path.join(root, 'dist/index.harness.html');
need(page, 'run `npm run build:harness`');
need(path.join(shotsDir(level), 'pose1_t2.png'), `run \`npm run ref:capture -- --level ${level} --fly 0\``);
need(
  path.join(shotsDir(level + '-b'), 'pose1_t2.png'),
  `run \`npm run ref:capture -- --level ${level} --fly 0 --tag b\``,
);
const out = path.join(root, 'test-results/noise');
mkdirSync(out, { recursive: true });

const host = await serve(page);
const chrome = await launch();
try {
  await chrome.open(`${host.origin}/?level=${level}&world=none`, { pause: true });
  let worst = { differing: 0, over1: 0, max: 0 };
  for (const file of readdirSync(shotsDir(level))
    .filter((f) => f.endsWith('.png'))
    .sort()) {
    if (!existsSync(path.join(shotsDir(level + '-b'), file))) continue;
    const d = await chrome.page.evaluate(
      ([a, b]) => window.__abyssal.harness.compareImages(a, b, true),
      [`/reference/L${level}/shots/${file}`, `/reference/L${level}-b/shots/${file}`],
    );
    if (d.differing) {
      writeFileSync(
        path.join(out, `L${level}_${file}`),
        Buffer.from(d.heatmap.slice(d.heatmap.indexOf(',') + 1), 'base64'),
      );
    }
    console.log(
      `${file.padEnd(16)} ${String(d.differing).padStart(6)} pixels differ, ${String(d.over1).padStart(5)} by more than 1/255, largest ${d.max}/255`,
    );
    worst = {
      differing: Math.max(worst.differing, d.differing),
      over1: Math.max(worst.over1, d.over1),
      max: Math.max(worst.max, d.max),
    };
  }
  console.log(
    `\nworst frame: ${worst.differing} pixels differ, ${worst.over1} by more than 1/255, largest ${worst.max}/255`,
  );
  console.log(`pictures of the differences: ${path.relative(root, out)}/`);
} finally {
  await chrome.close();
  host.close();
}
