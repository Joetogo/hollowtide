// ============================================================================
// reference rig, part 1: slotted in after world.js and before main.js, inside upstream's one function scope
// ============================================================================
// Records what main.js is about to compute and throw away, so the rebuild can be checked against it:
//   - SHA-256 of the density field as it comes off the GPU, and again after speck removal
//   - references to every generated buffer (terrain, instances, volume, ground map) for hashing and dumping
//   - every single-sampled texture gets COPY_SRC so it can be read back
//   - render pipelines are numbered in creation order, and __ref.mask can switch individual ones off
// None of this changes what upstream computes or draws (an empty mask draws everything). ?ref=bench leaves the GPU
// objects untouched so that timings are upstream's own; the passive stage and long-task timers run in every mode.
{
  const ref = (window.__ref = {
    mode: new URLSearchParams(location.search).get('ref') || 'capture', // capture | dump | bench
    digests: {}, // name -> Promise<hex>, for data that is gone by the time anyone asks
    data: {}, // name -> typed array, kept alive for hashing and dumping
    textures: [], // { t, d } in creation order
    pipelines: new Map(), // GPURenderPipeline -> creation index
    mask: new Set(), // creation indices whose draws are skipped
    stages: [], // [loading message, ms since navigation]
    longTasks: [], // [start, duration] of main-thread tasks over 50 ms
  });

  // loading stages as the user sees them, and how long the main thread was blocked
  const status = document.getElementById('s');
  new MutationObserver(() => ref.stages.push([status.textContent, performance.now()])).observe(status, { childList: true, characterData: true, subtree: true });
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) ref.longTasks.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
  } catch {}

  if (ref.mode !== 'bench' && typeof GPUDevice !== 'undefined') {
    const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
    // digest() copies its input when called, so the caller is free to change or drop the data afterwards
    ref.sha = (view) => (crypto.subtle ? crypto.subtle.digest('SHA-256', view).then(hex) : Promise.resolve('unavailable'));
    const dump = ref.mode === 'dump';

    // the density field straight off the GPU: main.js copies the mapped range, then edits the copy in place
    const rawBytes = NX * NY * NZ * 4, getMappedRange = GPUBuffer.prototype.getMappedRange;
    GPUBuffer.prototype.getMappedRange = function (...a) {
      const r = getMappedRange.apply(this, a);
      if (r.byteLength === rawBytes && !ref.digests.densityRaw) {
        ref.digests.densityRaw = ref.sha(r);
        if (dump) ref.data.densityRaw = new Float32Array(r.slice(0));
      }
      return r;
    };

    // world.js's two entry points are function declarations, so they can be wrapped the way dev.js wraps render()
    const upstreamBuildTerrain = buildTerrain;
    buildTerrain = function (D) {
      ref.digests.density = ref.sha(D); // after speck removal
      if (dump) ref.data.density = D;
      const T = upstreamBuildTerrain(D), d = ref.data;
      d.terrainVertices = new Uint8Array(T.vb); d.terrainIndices = T.ib; d.terrainStart = T.start; d.terrainLo = T.lo; d.terrainHi = T.hi;
      return T;
    };
    const upstreamMakeWorld = makeWorld;
    makeWorld = function (D, T, flyPts, POSES) {
      const w = upstreamMakeWorld(D, T, flyPts, POSES), d = ref.data;
      const cells = (name, c, bytes) => { d[name] = bytes; d[name + 'Start'] = c.start; d[name + 'Lo'] = c.lo; d[name + 'Hi'] = c.hi; };
      for (const k of ['big', 'bigF', 'small']) cells('leaves' + k[0].toUpperCase() + k.slice(1), w[k], new Uint8Array(w[k].buf));
      w.chunks.forEach((c, i) => cells('chunks' + i, c, c.data));
      w.props.forEach((c, i) => cells('props' + i, c, c.data));
      d.solids = w.solids.data; d.glints = w.glints; d.bubbles = w.bubbles; d.fish = w.fish; d.mantas = w.mantas; d.snow = w.snow;
      d.volume = w.volD; d.groundMap = w.gm;
      d.flyPoints = new Float64Array(flyPts.flat());
      return w;
    };

    const createTexture = GPUDevice.prototype.createTexture;
    GPUDevice.prototype.createTexture = function (desc) {
      const d = { ...desc };
      if ((d.sampleCount || 1) === 1) d.usage |= GPUTextureUsage.COPY_SRC;
      const t = createTexture.call(this, d);
      ref.textures.push({ t, d });
      return t;
    };

    const createRenderPipeline = GPUDevice.prototype.createRenderPipeline;
    GPUDevice.prototype.createRenderPipeline = function (desc) {
      const p = createRenderPipeline.call(this, desc);
      ref.pipelines.set(p, ref.pipelines.size);
      return p;
    };
    const pass = GPURenderPassEncoder.prototype, setPipeline = pass.setPipeline, draw = pass.draw, drawIndexed = pass.drawIndexed;
    const current = new WeakMap();
    pass.setPipeline = function (p) { current.set(this, ref.pipelines.get(p)); return setPipeline.call(this, p); };
    // while ref.counts is an object, every draw is tallied by pipeline: [draw calls, instances, vertices or indices]
    ref.counts = null;
    const tally = (pass, a) => { if (ref.counts) { const c = (ref.counts[current.get(pass)] ||= [0, 0, 0]); c[0]++; c[1] += a[1] ?? 1; c[2] += a[0] * (a[1] ?? 1); } };
    pass.draw = function (...a) { if (!ref.mask.has(current.get(this))) { tally(this, a); draw.apply(this, a); } };
    pass.drawIndexed = function (...a) { if (!ref.mask.has(current.get(this))) { tally(this, a); drawIndexed.apply(this, a); } };
  }
}
