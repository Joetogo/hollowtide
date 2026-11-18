// Bundles src/ into one self-contained dist/index.html.
//   node tools/build.mjs          minified; fails if the file is over the size budget
//   node tools/build.mjs --dev    unminified, served on http://127.0.0.1:5173 with rebuild and reload on save
//   node tools/build.mjs --harness  dist/index.harness.html: the same minified build plus the hooks that tests
//                                 use to drive it and compare it with the original (src/app/harness.ts)
//
// The page holds a single classic inline script. It boots as the main thread, and the main thread starts the
// world-generation worker from a Blob of that same script (src/main.ts), so the one file also runs from file://.
import { build, context, transform } from 'esbuild';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { wgslPlugin } from './wgsl.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');
const harness = process.argv.includes('--harness');
// The original ships at 97 kB. This is larger for what it adds (the swimmer, the opening, new animals, moods).
// The build strips the shaders' whitespace and comments, ships the code they share once and gives their own
// names short ones (tools/wgsl.mjs).
// It was 200 until version 1.1, which ended 0.7 kB under it: what the page says for itself, the gamepad in the
// panel and the rest had used what room there was. 220 from there, for changing the light in place and what
// photo mode gained. The number is a brake, not a target: a rise is written down here with its reason.
const BUDGET_KB = 220;
const PORT = 5173;
const upstream = JSON.parse(readFileSync(path.join(root, 'tools/reference/upstream.json'), 'utf8'));
const fixtures = path.join(root, '.cache/reference', upstream.sha.slice(0, 7), 'L0/fixtures');
const NOTICE =
  '<!-- Hollowtide. MIT License. Copyright (c) 2026 Richman Tan. Portions copyright (c) 2026 Maksymilian Dendura ' +
  '(Abyssal Garden, https://github.com/Noniv/abyssal-garden), MIT License. -->';

const options = (prod) => ({
  absWorkingDir: root,
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: prod,
  write: false,
  legalComments: 'none',
  define: { __DEV__: String(!prod), __HARNESS__: String(harness) },
  plugins: [wgslPlugin({ minify: prod })],
  logLevel: 'warning',
});

/** The page's icon (src/page/icon.svg) as an address that holds the picture itself: nothing to fetch. */
function iconUri() {
  const svg = readFileSync(path.join(root, 'src/page/icon.svg'), 'utf8')
    .replace(/<!--[^]*?-->/g, '')
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim();
  // quotes become apostrophes (the address stands between quotes) and only what must be is escaped
  return (
    'data:image/svg+xml,' +
    svg.replace(/"/g, "'").replace(/%/g, '%25').replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E')
  );
}

/** Puts the bundle into the page template. */
async function page(js, prod) {
  let html = readFileSync(path.join(root, 'src/page/template.html'), 'utf8').replace('/*ICON*/', iconUri);
  // an inline script ends at the first "</script", and "<!--" changes how the rest is parsed
  const script = js
    .trim()
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\!--');
  if (prod) {
    const css = /<style>([^]*?)<\/style>/.exec(html);
    if (css) {
      const min = (await transform(css[1], { loader: 'css', minify: true })).code.trim();
      html = html.replace(css[1], () => min);
    }
    html = html.replace(/>\s+</g, '><');
  } else {
    html = html.replace(
      '</body>',
      `<script>new EventSource('/__reload').onmessage = () => location.reload();</script>\n</body>`,
    );
  }
  // function replacements: the bundle may contain "$&" and friends
  return html
    .replace(/<!doctype html>\s*/i, (m) => m.trim() + '\n' + NOTICE + '\n')
    .replace('/*SCRIPT*/', () => script);
}

if (!dev) {
  const result = await build(options(true));
  const html = await page(result.outputFiles[0].text, true);
  mkdirSync(path.join(root, 'dist'), { recursive: true });
  const name = harness ? 'dist/index.harness.html' : 'dist/index.html';
  writeFileSync(path.join(root, name), html);
  const kb = Buffer.byteLength(html) / 1024;
  const gz = gzipSync(Buffer.from(html), { level: 9 }).length / 1024;
  // the budget is for what ships: the test build carries its hooks on top and is never published
  const limit = harness ? 'for the tests, not shipped: no budget' : `budget ${BUDGET_KB} kB`;
  console.log(`${name}: ${kb.toFixed(1)} kB, ${gz.toFixed(1)} kB gzipped (${limit})`);
  if (kb > BUDGET_KB && !harness) {
    console.error(`over the ${BUDGET_KB} kB budget`);
    process.exitCode = 1;
  }
} else {
  let html = '<!doctype html><title>building…</title>';
  const clients = new Set();
  const ctx = await context({
    ...options(false),
    plugins: [
      ...options(false).plugins,
      {
        name: 'serve',
        setup(b) {
          b.onEnd(async (result) => {
            if (result.errors.length) return; // esbuild has printed them; keep serving the last good page
            html = await page(result.outputFiles[0].text, false);
            for (const res of clients) res.write('data: reload\n\n');
            console.log(`${new Date().toLocaleTimeString()} built, ${(Buffer.byteLength(html) / 1024).toFixed(1)} kB`);
          });
        },
      },
    ],
  });
  await ctx.watch();
  http
    .createServer((req, res) => {
      if (req.url === '/__reload') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
        clients.add(res);
        req.on('close', () => clients.delete(res));
      } else if (/^\/fixtures\/[\w.-]+$/.test(req.url) && existsSync(path.join(fixtures, req.url.slice(10)))) {
        // the original's dumped world (npm run ref:dump), for /?world=reference
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' });
        createReadStream(path.join(fixtures, req.url.slice(10))).pipe(res);
      } else if (req.url === '/' || req.url?.startsWith('/?')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(html);
      } else {
        res.writeHead(req.url === '/favicon.ico' ? 204 : 404);
        res.end();
      }
    })
    .listen(PORT, '127.0.0.1', () => console.log(`dev server on http://127.0.0.1:${PORT}`));
}
