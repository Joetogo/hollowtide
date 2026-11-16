// Safari smoke test, from file://.
// Safari can only be automated after the user switches on "Allow remote automation", so instead this builds the
// harness build (tools/build.mjs --harness), opens it with `open -a Safari`, and waits for the page to send its
// start-up report to a listener on 127.0.0.1. Safari is left open on the test page.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
execFileSync(process.execPath, [path.join(root, 'tools/build.mjs'), '--harness'], { stdio: 'inherit' });

const result = await new Promise((resolve, reject) => {
  const stages = [];
  const server = http.createServer((req, res) => {
    const params = new URL(req.url, 'http://127.0.0.1').searchParams;
    res.writeHead(204);
    res.end();
    if (params.has('stage')) stages.push(JSON.parse(params.get('stage')));
    if (params.has('result')) {
      server.close();
      resolve(JSON.parse(params.get('result')));
    }
  });
  server.listen(0, '127.0.0.1', () => {
    // `open` drops the query string of a file URL, so a small launcher page carries it instead
    const listener = `http://127.0.0.1:${server.address().port}/`;
    const launcher = path.join(root, 'dist/safari-launch.html');
    writeFileSync(
      launcher,
      `<!doctype html><script>location.replace('index.harness.html?report=' + encodeURIComponent('${listener}'))</script>`,
    );
    execFileSync('open', ['-a', 'Safari', pathToFileURL(launcher).href]);
  });
  setTimeout(() => {
    server.close();
    reject(new Error(`Safari did not report within 45 s (stages seen: ${stages.join(', ') || 'none'})`));
  }, 45_000).unref();
});

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};
console.log(result.userAgent);
check(!result.error, `starts from file://${result.error ? ': ' + result.error : ''}`);
if (result.report) {
  const { worker, adapter, size } = result.report;
  check(!!adapter, `WebGPU device and renderer created (${adapter}, ${size.join('x')})`);
  check(
    worker?.detached && worker?.intact,
    `worker: ${worker?.megabytes} MB transferred there and back intact (${worker?.roundTripMs.toFixed(1)} ms)`,
  );
}
check(
  (result.gpuErrors ?? ['none reported']).length === 0,
  `no shader or validation errors${result.gpuErrors?.length ? ': ' + result.gpuErrors.join('; ') : ''}`,
);
if (result.frame) {
  // viewpoint 1 is blue-green water, kelp and pale stone: in Chrome its mean colour is about 67, 141, 160
  const [r, g, b] = result.frame.mean;
  check(
    g > 60 && b > 70 && b > r && result.frame.dark < 0.2,
    `the first viewpoint has a picture in it: mean colour ${r}, ${g}, ${b}; ${(result.frame.dark * 100).toFixed(1)} % dark pixels`,
  );
}
console.log('Safari was left open on the test page.');
process.exitCode = failures.length ? 1 : 0;
