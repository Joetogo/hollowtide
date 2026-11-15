// Opens the built single file from file:// in the installed Chrome and checks what it reports about itself.
// WebGPU needs the real GPU, so this runs in a visible window and is not part of CI.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const file = path.join(root, 'dist/index.html');
if (!existsSync(file)) {
  console.error('dist/index.html is missing: run `npm run build` first');
  process.exit(2);
}

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

const profile = mkdtempSync(path.join(os.tmpdir(), 'abyssal-test-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chrome',
  headless: false,
  viewport: { width: 640, height: 360 },
});
try {
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(pathToFileURL(file).href);
  await page.waitForFunction(() => window.__abyssal?.ready, null, { timeout: 30_000 });
  const { error, report } = await page.evaluate(() => window.__abyssal);

  check(!error, `starts from file://${error ? ': ' + error : ''}`);
  if (report) {
    const { worker, gpu } = report;
    check(
      worker.detached && worker.intact,
      `worker: ${worker.megabytes} MB transferred there and back intact (${worker.roundTripMs.toFixed(1)} ms)`,
    );
    check(gpu !== null, 'WebGPU adapter available');
    if (gpu) {
      check(
        gpu.errors.length === 0,
        `generated struct and bind group compile and validate${gpu.errors.length ? ': ' + gpu.errors.join('; ') : ''}`,
      );
      const off = Math.max(...gpu.pixel.map((v, i) => Math.abs(v - gpu.expected[i])));
      check(off <= 1, `uniforms reach the shader at the generated offsets: pixel ${gpu.pixel} vs ${gpu.expected}`);
    }
  }
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join('; ') : ''}`);
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}
process.exitCode = failures.length ? 1 : 0;
