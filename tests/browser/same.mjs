// Do two builds draw exactly the same frames? For changes that must not move a pixel: build the commit before
// the change somewhere else (a git worktree does it), then
//   node tests/browser/same.mjs <before.harness.html> [after, default dist/index.harness.html] [levels, default 0,1]
// Both generate their own world and draw the six viewpoints at three times and 30 frames of the fly-through;
// every frame's pixels must be equal. (Low is left out by default: there neither build repeats its own frames
// exactly on this GPU, see the README.)
import path from 'node:path';
import { check, finish, launch, need, root, serve } from './lib.mjs';

const args = process.argv.slice(2);
const before = path.resolve(args[0] ?? '');
const after = path.resolve(args[1] ?? path.join(root, 'dist/index.harness.html'));
need(before, 'give the harness build of the commit to compare with');
need(after, 'run `npm run build:harness`');
const levels = (args[2] ?? '0,1').split(',').map(Number);

async function frames(file, level) {
  const host = await serve(file);
  const chrome = await launch();
  try {
    const { error } = await chrome.open(`${host.origin}/?level=${level}`, { pause: true });
    if (error) throw new Error(error);
    return await chrome.page.evaluate(async () => {
      const h = window.__hollowtide.harness;
      const digest = async (png) => {
        // the PNG of a frame is its pixels and nothing else, so equal hashes are equal frames
        const bytes = new TextEncoder().encode(png);
        return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
          b.toString(16).padStart(2, '0'),
        )
          .join('')
          .slice(0, 16);
      };
      const out = {};
      for (const [i, pose] of h.viewpoints().entries())
        for (const time of [2, 11, 47])
          out[`viewpoint ${i + 1} at ${time} s`] = await digest(h.capture(pose, time).png);
      for (let i = 0; i < 30; i++)
        out[`fly-through at ${i * 2 + 1} s`] = await digest(h.capture(h.flyPose(i * 2 + 1), i * 2 + 1).png);
      return out;
    });
  } finally {
    await chrome.close();
    host.close();
  }
}

for (const level of levels) {
  const a = await frames(before, level);
  const b = await frames(after, level);
  const different = Object.keys(a).filter((k) => a[k] !== b[k]);
  check(
    different.length === 0,
    `level ${level}: ${Object.keys(a).length} frames are identical in both builds` +
      (different.length ? `, except ${different.length}: ${different.slice(0, 6).join('; ')}` : ''),
  );
}
finish();
