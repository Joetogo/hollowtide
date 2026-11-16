// The jellyfish: that they are there in the shipped tuning and not in the faithful one, that they only ever add
// light to the picture, and that drawing them costs next to nothing.
import path from 'node:path';
import { check, finish, launch, need, root, serve } from './lib.mjs';

const page = path.join(root, 'dist/index.harness.html');
need(page, 'run `npm run build:harness`');

const host = await serve(page);
for (const tuning of ['tuned', 'faithful']) {
  const chrome = await launch();
  try {
    const { error } = await chrome.open(host.origin + '/', { pause: true, tuning });
    check(!error, `${tuning}: starts${error ? ': ' + error : ''}`);
    // they are placed when the collision field arrives, a moment after the first frame
    await chrome.page.waitForFunction(() => window.__hollowtide.harness.collision, null, { timeout: 30_000 });
    const count = await chrome.page.evaluate(() => window.__hollowtide.harness.jellies().length / 8);
    if (tuning === 'faithful') {
      check(count === 0, 'faithful: no jellyfish (the original has none)');
      continue;
    }
    check(count > 60, `tuned: ${count} jellyfish in the water`);

    // ---- looking at the biggest of them, from each of four sides: drawn, and only ever adding light
    const seen = await chrome.page.evaluate(async () => {
      const h = window.__hollowtide.harness;
      const j = h.jellies();
      let big = 0;
      for (let i = 0; i < j.length; i += 8) if (j[i + 3] > j[big + 3]) big = i;
      const [x, y, z, r] = j.slice(big, big + 4);
      const decode = async (url) => {
        const bitmap = await createImageBitmap(await (await fetch(url)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d');
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const out = [];
      for (let side = 0; side < 4; side++) {
        const a = (side * Math.PI) / 2 + 0.5;
        const pose = [x + Math.cos(a) * r * 7, y - r * 0.5, z + Math.sin(a) * r * 7, x, y - r * 1.2, z];
        const withThem = await decode(h.capture(pose, 3 + side * 0.4).png);
        h.skipDraws('jellies');
        const without = await decode(h.capture(pose, 3 + side * 0.4).png);
        h.skipDraws();
        let brighter = 0;
        let darker = 0;
        for (let i = 0; i < withThem.length; i += 4) {
          const d = [0, 1, 2].map((c) => withThem[i + c] - without[i + c]);
          if (Math.min(...d) < -1) darker++;
          else if (Math.max(...d) > 2) brighter++;
        }
        out.push({ brighter: brighter / (withThem.length / 4), darker });
      }
      return { radius: r, sides: out, errors: h.gpuErrors() };
    });
    const most = Math.max(...seen.sides.map((s) => s.brighter));
    check(
      most > 0.004,
      `the biggest (${seen.radius.toFixed(2)} m across the bell's radius) lights up to ${(most * 100).toFixed(1)} % of the picture from 7 radii away`,
    );
    const darker = seen.sides.reduce((n, s) => n + s.darker, 0);
    check(darker === 0, `they only add light: ${darker} pixels darker with them than without, over four views`);
    check(seen.errors.length === 0, `no shader or validation errors${seen.errors.length ? ': ' + seen.errors[0] : ''}`);

    // ---- what they cost: frames with them against frames without, in short turns side by side (see body.mjs)
    const cost = await chrome.page.evaluate(async () => {
      const h = window.__hollowtide.harness;
      const pose = h.viewpoints()[0];
      const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
      const turn = async (withThem) => {
        h.skipDraws(...(withThem ? [] : ['jellies']));
        return median((await h.frameCost([pose], 9, 1280 * 720)).totalMs.slice(3));
      };
      const differences = [];
      const frames = [];
      for (let round = 0; round < 24; round++) {
        const first = await turn(round % 2 === 1);
        const second = await turn(round % 2 === 0);
        const [without, withThem] = round % 2 ? [second, first] : [first, second];
        differences.push(withThem - without);
        frames.push(without);
      }
      h.skipDraws();
      return { extra: median(differences), frame: median(frames) };
    });
    check(
      cost.extra < Math.max(2, cost.frame * 0.12),
      `drawing them costs ${cost.extra.toFixed(2)} ms of a ${cost.frame.toFixed(1)} ms frame`,
    );
  } finally {
    await chrome.close();
  }
}
host.close();
finish();
