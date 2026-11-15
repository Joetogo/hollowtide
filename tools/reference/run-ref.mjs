// Drives the reference page (see build-ref.mjs) in the installed Chrome and records what the rebuild is compared to.
//
//   node tools/reference/run-ref.mjs capture [--level 0] [--times 2,11,47] [--fly 30]
//       frozen frames at the six viewpoints (and along the fly path), plus the hash manifest
//   node tools/reference/run-ref.mjs verify  [--level 0]
//       a second, separate load must reproduce the captured frames and hashes byte for byte
//   node tools/reference/run-ref.mjs dump    [--level 0]
//       the generated data and a few textures, as fixtures for the renderer track
//   node tools/reference/run-ref.mjs bench   [--level 0]
//       baseline load time, memory and frame cost for this machine
//
// Everything lands in .cache/reference/<upstream sha>/L<level>/. One page at a time: this machine has 8 GB.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { buildReference, outDir, root, upstream } from './build-ref.mjs';

const [mode = 'capture', ...rest] = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = rest.indexOf('--' + name);
  return i < 0 ? fallback : rest[i + 1];
};
const level = +opt('level', 0);
const times = String(opt('times', '2,11,47')).split(',').map(Number);
const flyFrames = +opt('fly', 30);
const VIEW = { width: 1280, height: 720 };
const runDir = path.join(outDir, upstream.sha.slice(0, 7), 'L' + level);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 1) + '\n');
const rel = (p) => path.relative(root, p);

// ---------------------------------------------------------------- page host
// serves the two reference pages and takes dumps as PUT /dump/<file>
function serve(dumpDir) {
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && /^\/reference(-bench)?\.html$/.test(pathname)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(readFileSync(path.join(outDir, pathname.slice(1))));
    } else if (req.method === 'PUT' && dumpDir && /^\/dump\/[\w.-]+$/.test(pathname)) {
      req.pipe(createWriteStream(path.join(dumpDir, pathname.slice(6)))).on('finish', () => {
        res.writeHead(204);
        res.end();
      });
    } else {
      res.writeHead(pathname === '/favicon.ico' ? 204 : 404);
      res.end();
    }
  });
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () => ok({ server, origin: `http://127.0.0.1:${server.address().port}` })),
  );
}

// peak resident memory of the browser's renderer and GPU processes, sampled from outside
function watchMemory(profile) {
  const peak = { rendererMB: 0, gpuMB: 0, totalMB: 0 };
  const timer = setInterval(() => {
    let rows;
    try {
      rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,command='], { encoding: 'utf8', maxBuffer: 1 << 26 }).split(
        '\n',
      );
    } catch {
      return;
    }
    const procs = rows
      .map((r) => r.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/))
      .filter(Boolean)
      .map((m) => ({ pid: m[1], ppid: m[2], mb: m[3] / 1024, cmd: m[4] }));
    const main = procs.find((p) => p.cmd.includes(profile) && !p.cmd.includes('--type='));
    if (!main) return;
    let total = main.mb;
    for (const p of procs)
      if (p.ppid === main.pid) {
        total += p.mb;
        if (p.cmd.includes('--type=renderer')) peak.rendererMB = Math.max(peak.rendererMB, p.mb);
        if (p.cmd.includes('--type=gpu-process')) peak.gpuMB = Math.max(peak.gpuMB, p.mb);
      }
    peak.totalMB = Math.max(peak.totalMB, total);
  }, 250);
  return { peak, stop: () => clearInterval(timer) };
}

async function open({ page: file, ref, dpr = 1, dumpDir, memory }) {
  const profile = mkdtempSync(path.join(os.tmpdir(), 'abyssal-ref-'));
  const { server, origin } = await serve(dumpDir);
  const mem = memory ? watchMemory(profile) : null;
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless: false,
    viewport: VIEW,
    deviceScaleFactor: dpr,
    args: [
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      ...(ref === 'bench' ? ['--enable-webgpu-developer-features'] : []),
    ], // unquantised GPU timestamps
  });
  const close = async () => {
    mem?.stop();
    await context.close().catch(() => {});
    server.close();
    rmSync(profile, { recursive: true, force: true });
  };
  try {
    // the detail level is set once per tab: if upstream's crash fallback reloads a level lower, that must show
    await context.addInitScript((lv) => {
      try {
        if (!sessionStorage.getItem('refInit')) {
          sessionStorage.setItem('refInit', '1');
          localStorage.setItem('abyssal', String(lv));
          localStorage.removeItem('abyssalLoad');
        }
      } catch {
        // storage can be blocked; upstream then picks the level itself and the level check below reports it
      }
    }, level);
    const page = context.pages()[0] ?? (await context.newPage());
    page.on('console', (m) => {
      if (m.type() === 'error') console.error('  [page]', m.text());
    });
    let crashed = false;
    page.on('crash', () => {
      crashed = true;
    });
    await page.goto(`${origin}/${file}?ref=${ref}`);
    await page
      .waitForFunction(() => window.__ref && (window.__ref.ready || window.__ref.error), null, {
        timeout: 240_000,
        polling: 250,
      })
      .catch((e) => {
        throw new Error(crashed ? 'the tab crashed while loading' : e.message);
      });
    const state = await page.evaluate(() => ({
      error: window.__ref.error,
      info: window.__ref.info,
      meta: window.__ref.meta,
      loadMs: window.__ref.loadMs,
      stages: window.__ref.stages,
      longTasks: window.__ref.longTasks,
    }));
    if (state.error) throw new Error('reference failed to start: ' + state.error);
    if (state.info.level !== level)
      throw new Error(`asked for detail level ${level} but the page ended up on ${state.info.level}`);
    if (state.info.adapter.fallback) throw new Error('Chrome gave a software adapter; results would not be comparable');
    return { page, state, mem, close };
  } catch (e) {
    await close();
    throw e;
  }
}

// ---------------------------------------------------------------- capture
async function capture(dir) {
  mkdirSync(path.join(dir, 'shots'), { recursive: true });
  const s = await open({ page: 'reference.html', ref: 'capture' });
  try {
    const { page, state } = s,
      shots = {};
    console.log(
      `  ${state.info.adapter.vendor} ${state.info.adapter.architecture || ''} · loaded in ${(state.loadMs / 1000).toFixed(1)} s`,
    );
    const data = await page.evaluate(() => window.__ref.manifest());
    const save = (name, r) => {
      const png = Buffer.from(r.png.slice(r.png.indexOf(',') + 1), 'base64');
      writeFileSync(path.join(dir, 'shots', name + '.png'), png);
      shots[name] = { sha256: sha256(png), width: r.width, height: r.height, uniforms: r.uniforms };
    };
    for (let p = 0; p < 6; p++)
      for (const t of times)
        save(`pose${p + 1}_t${t}`, await page.evaluate(([p, t]) => window.__ref.capture(p, t), [p, t]));
    for (let i = 0; i < flyFrames; i++) {
      const ft = ((i + 0.5) * 60) / flyFrames;
      save(`fly${String(i).padStart(2, '0')}`, await page.evaluate((ft) => window.__ref.captureFly(ft, ft), ft));
    }
    const manifest = { upstream: upstream.sha, level, view: VIEW, info: state.info, meta: state.meta, data, shots };
    writeJson(path.join(dir, 'manifest.json'), manifest);
    return manifest;
  } finally {
    await s.close();
  }
}

function diffManifests(a, b) {
  const out = [];
  for (const kind of ['data', 'shots'])
    for (const k of new Set([...Object.keys(a[kind]), ...Object.keys(b[kind])])) {
      if (a[kind][k]?.sha256 !== b[kind][k]?.sha256) out.push(`${kind}.${k}`);
    }
  return out;
}

// ---------------------------------------------------------------- dump
// everything the rebuild's renderer does not draw until its leaves, animals, particles and shafts exist
const OPAQUE_ONLY = [
  'leaf9',
  'leaf5',
  'leafSmall',
  'leafFar',
  'fish',
  'manta',
  'bubbles',
  'snow',
  'glints',
  'shafts',
  'shaftBlur',
];
async function dump(dir) {
  mkdirSync(dir, { recursive: true });
  const s = await open({ page: 'reference.html', ref: 'dump', dumpDir: dir });
  try {
    const { page, state } = s;
    const data = await page.evaluate(() => window.__ref.manifest());
    await page.evaluate(() => window.__ref.dumpData());
    const textures = {};
    const tex = async (name, mip, file) => {
      textures[file] = await page.evaluate(([n, m, f]) => window.__ref.dumpTexture(n, m, f), [name, mip, file]);
    };
    await tex('detail', 0, 'tex_detail.bin');
    await tex('shadow', 0, 'tex_shadow.bin');
    // per viewpoint at the first capture time: the water texture and the three inputs of the composite pass
    const t = times[0],
      frames = {};
    for (let p = 0; p < 6; p++) {
      const r = await page.evaluate(([p, t]) => window.__ref.capture(p, t), [p, t]),
        id = `pose${p + 1}_t${t}`;
      frames[id] = { uniforms: r.uniforms, width: r.width, height: r.height };
      const png = (file, shot) =>
        writeFileSync(path.join(dir, file), Buffer.from(shot.png.slice(shot.png.indexOf(',') + 1), 'base64'));
      png(`frame_${id}.png`, r);
      for (const name of ['scene', 'shaftsBlurred', 'bloom0']) await tex(name, 0, `hdr_${id}_${name}.bin`);
      if (!p) await tex('water', 0, `tex_water_t${t}.bin`);
      // the same frame without light shafts: what the composite pass makes of the scene and its bloom alone
      // (both passes are masked: the blur divides by the shafts' depth channel, which is zero when they are not drawn)
      await page.evaluate(() => window.__ref.setMask(['shafts', 'shaftBlur']));
      // at every capture time, since plants and animals move
      for (const tt of times) {
        const shot = await page.evaluate(([p, t]) => window.__ref.capture(p, t), [p, tt]);
        png(`frame_pose${p + 1}_t${tt}_noShafts.png`, shot);
      }
      // the same frame with only the opaque world: terrain, rocks, set pieces, sponges, corals, surface, backdrop
      await page.evaluate((m) => window.__ref.setMask(m), OPAQUE_ONLY);
      png(`frame_${id}_opaque.png`, await page.evaluate(([p, t]) => window.__ref.capture(p, t), [p, t]));
      await tex('scene', 0, `hdr_${id}_opaqueScene.bin`);
      await page.evaluate(() => window.__ref.setMask([]));
    }
    writeJson(path.join(dir, 'index.json'), {
      upstream: upstream.sha,
      level,
      view: VIEW,
      info: state.info,
      meta: state.meta,
      data,
      textures,
      frames,
    });
    return { files: Object.keys(data).length + Object.keys(textures).length };
  } finally {
    await s.close();
  }
}

// ---------------------------------------------------------------- bench
const stats = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y),
    r = (x) => +x.toFixed(2);
  return {
    n: s.length,
    avg: r(s.reduce((x, y) => x + y, 0) / s.length),
    p50: r(s[s.length >> 1]),
    p99: r(s[Math.min(s.length - 1, Math.floor(s.length * 0.99))]),
    max: r(s[s.length - 1]),
  };
};
async function bench(dir) {
  mkdirSync(dir, { recursive: true });
  // a 1280x720 window at 2x is 2560x1440, the resolution upstream was tuned for
  const s = await open({ page: 'reference-bench.html', ref: 'bench', dpr: 2, memory: true });
  try {
    const { page, state, mem } = s;
    const stages = state.stages.map(([text, at], i, all) => ({
      text,
      ms: Math.round((all[i + 1]?.[1] ?? state.loadMs) - at),
    }));
    const long = state.longTasks.map((t) => t[1]);
    const out = {
      upstream: upstream.sha,
      level,
      date: new Date().toISOString(),
      info: state.info,
      load: {
        totalMs: Math.round(state.loadMs),
        stages,
        longestTaskMs: Math.round(Math.max(0, ...long)),
        blockedMs: Math.round(long.reduce((a, b) => a + b, 0)),
        peakMemory: { ...mem.peak },
      },
    };
    console.log(
      `  loaded in ${(state.loadMs / 1000).toFixed(1)} s, longest main-thread task ${out.load.longestTaskMs} ms`,
    );
    // where upstream's own dynamic resolution settles on this machine
    await page.evaluate(() => {
      window.__ref.dive();
      window.__ref.pose(0);
    });
    await page.waitForTimeout(20_000);
    out.settled = await page.evaluate(() => window.__ref.state());
    console.log(
      `  dynamic resolution settled at ${out.settled.width}x${out.settled.height}, draw distance ${out.settled.detail.toFixed(2)}`,
    );
    // Frame cost: frames run one at a time, each waited for until the GPU has finished it. Unlike the frame rate
    // or the GPU timestamps of a vsynced loop, this does not depend on the display and frames cannot queue up.
    // totalMs = submit to GPU done (the whole frame), cpuMs = the JavaScript and command encoding part of it.
    await page.evaluate(() => window.__ref.pause());
    await page.waitForTimeout(300);
    const cost = (r, skip) => ({ totalMs: stats(r.totalMs.slice(skip)), cpuMs: stats(r.cpuMs.slice(skip)) });
    out.cost = { overheadMs: stats(await page.evaluate(() => window.__ref.costEmpty(120))), poses: {}, fly: {} };
    console.log(
      `  measurement overhead (empty submit): p50 ${out.cost.overheadMs.p50}  avg ${out.cost.overheadMs.avg}  max ${out.cost.overheadMs.max} ms`,
    );
    for (const [label, pixels] of [
      ['2560x1440', 2560 * 1440],
      ['1280x720', 1280 * 720],
      ['640x360', 640 * 360],
    ]) {
      const size = await page.evaluate((px) => window.__ref.hold(px), pixels);
      out.cost.poses[label] = { size, poses: [] };
      for (let p = 0; p < 6; p++)
        out.cost.poses[label].poses.push(cost(await page.evaluate((p) => window.__ref.costPose(p, 70), p), 10));
      console.log(
        `  ${label}: frame cost per viewpoint ${out.cost.poses[label].poses.map((p) => p.totalMs.p50).join(' / ')} ms (CPU part ${out.cost.poses[label].poses.map((p) => p.cpuMs.p50).join(' / ')})`,
      );
      if (label === '640x360') continue;
      out.cost.fly[label] = cost(await page.evaluate(() => window.__ref.costFly(600)), 0);
      const f = out.cost.fly[label].totalMs;
      console.log(`  ${label}: fly-through frame cost avg ${f.avg}  p99 ${f.p99}  max ${f.max} ms`);
    }
    // upstream's own 60 s fly-through benchmark at 2560x1440, in its vsynced loop
    await page.evaluate(() => {
      window.__ref.hold(2560 * 1440);
      window.__ref.resume();
    });
    out.upstreamFlyThrough = await page.evaluate(() => window.__ref.flyBench());
    console.log('  upstream benchmark: ' + out.upstreamFlyThrough.replace(/\n/g, '\n    '));
    out.peakMemory = { ...mem.peak };
    writeJson(path.join(dir, 'baseline.json'), out);
    return out;
  } finally {
    await s.close();
  }
}

// ---------------------------------------------------------------- main
buildReference();
if (mode === 'capture') {
  console.log(`capturing reference (level ${level}) -> ${rel(runDir)}`);
  const m = await capture(runDir);
  console.log(`  ${Object.keys(m.shots).length} frames, ${Object.keys(m.data).length} data hashes`);
} else if (mode === 'verify') {
  const file = path.join(runDir, 'manifest.json');
  if (!existsSync(file)) {
    console.log(`no capture yet; capturing reference (level ${level}) -> ${rel(runDir)}`);
    await capture(runDir);
  }
  const first = JSON.parse(readFileSync(file, 'utf8')),
    tmp = mkdtempSync(path.join(os.tmpdir(), 'abyssal-verify-'));
  console.log('second load…');
  try {
    const second = await capture(tmp),
      bad = diffManifests(first, second);
    if (bad.length) {
      console.error(`NOT reproducible: ${bad.length} differ\n  ` + bad.join('\n  '));
      process.exitCode = 1;
    } else
      console.log(
        `reproducible: ${Object.keys(first.shots).length} frames and ${Object.keys(first.data).length} data hashes identical across two loads`,
      );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
} else if (mode === 'dump') {
  const dir = path.join(runDir, 'fixtures');
  console.log(`dumping fixtures (level ${level}) -> ${rel(dir)}`);
  const r = await dump(dir);
  console.log(`  ${r.files} files`);
} else if (mode === 'bench') {
  console.log(`baseline timings (level ${level}); leave the Chrome window visible and untouched for a few minutes`);
  await bench(runDir);
  console.log(`  -> ${rel(path.join(runDir, 'baseline.json'))}`);
} else {
  console.error('usage: run-ref.mjs capture|verify|dump|bench [--level 0|1|2] [--times 2,11,47] [--fly 30]');
  process.exitCode = 2;
}
