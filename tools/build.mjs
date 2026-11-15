// Bundles src/ into one self-contained dist/index.html.
//   node tools/build.mjs          minified; fails if the file is over the size budget
//   node tools/build.mjs --dev    unminified, served on http://127.0.0.1:5173 with rebuild and reload on save
//   node tools/build.mjs --report dist/index.report.html: the same build, but it can send its start-up report to a
//                                 listener on 127.0.0.1 (for browsers that cannot be automated, see tests/browser)
//
// The page holds a single classic inline script. It boots as the main thread, and the main thread starts the
// world-generation worker from a Blob of that same script (src/main.ts), so the one file also runs from file://.
import { build, context, transform } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { wgslPlugin } from './wgsl.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');
const report = process.argv.includes('--report');
const BUDGET_KB = 130; // the original ships at 97 kB
const PORT = 5173;
const NOTICE =
  '<!-- Abyssal Garden, rebuilt. MIT License. Copyright (c) 2026 Maksymilian Dendura (the original Abyssal Garden, ' +
  'https://github.com/Noniv/abyssal-garden) and (c) 2026 Richman Tan (this rebuild). -->';

const options = (prod) => ({
  absWorkingDir: root,
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: prod,
  write: false,
  legalComments: 'none',
  define: { __DEV__: String(!prod), __REPORT__: String(report) },
  plugins: [wgslPlugin({ minify: prod })],
  logLevel: 'warning',
});

/** Puts the bundle into the page template. */
async function page(js, prod) {
  let html = readFileSync(path.join(root, 'src/page/template.html'), 'utf8');
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
  const name = report ? 'dist/index.report.html' : 'dist/index.html';
  writeFileSync(path.join(root, name), html);
  const kb = Buffer.byteLength(html) / 1024;
  const gz = gzipSync(Buffer.from(html), { level: 9 }).length / 1024;
  console.log(`${name}: ${kb.toFixed(1)} kB, ${gz.toFixed(1)} kB gzipped (budget ${BUDGET_KB} kB)`);
  if (kb > BUDGET_KB && !report) {
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
