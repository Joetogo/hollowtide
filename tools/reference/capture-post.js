// ============================================================================
// reference rig, part 2: appended after audio.js (and dev.js in the bench page), in the same function scope
// ============================================================================
// By now upstream has built the world, drawn its first frame and shown the menu. This part gives the harness a
// handle on it: frozen frames at a chosen pose and time, texture read-back, hashes, dumps and timings.
{
  const ref = window.__ref, bench = ref.mode === 'bench';
  ref.loadMs = performance.now();
  const ai = adapter.info || {};
  ref.info = {
    userAgent: navigator.userAgent, level: LV, canvasFormat: FMT, timestampQuery: hasTS, devicePixelRatio,
    adapter: { vendor: ai.vendor, architecture: ai.architecture, device: ai.device, description: ai.description, fallback: !!(ai.isFallbackAdapter ?? adapter.isFallbackAdapter) },
  };
  ref.meta = {
    grid: { NX, NY, NZ, VS, OX, OY, OZ, CELLS, CELLW },
    constants: { TANH, NEAR, EXPO, RAYS, PIXMAX, FLYT },
    poses: POSES.map((p) => [...p]), // after main.js has lifted them onto the seabed
    fly: Array.from(FLY), sun: [...SUN],
    meshes: meshes.map((m) => ({ firstVertex: m.v0, firstIndex: m.i0, vertexCount: m.nv, indexCount: m.ib.length })),
    solidRanges: Wd.solids.ranges,
    counts: { terrainVertices: T.nv, solids: nSolid, fish: nFish, mantas: nManta, bubbles: nBub, snow: nSnow, glints: nGl,
      leavesBig: Wd.big.n, leavesBigF: Wd.bigF.n, leavesSmall: Wd.small.n, chunks: Wd.chunks.map((c) => c.n), props: Wd.props.map((c) => c.n) },
  };

  if (!bench) {
    ref.data.meshVertices = allV; ref.data.meshIndices = allI; ref.data.collisionIndex = CI; ref.data.collisionBricks = CG;

    // every frame from here on is one the harness asks for, at full resolution and full draw distance
    frame = () => {};
    pix = PIXMAX; det = 1; resize();

    // ---- frozen frames
    const shot = () => { render(); return { png: canvas.toDataURL('image/png'), uniforms: Array.from(UB), width: W, height: H }; };
    ref.capture = (pose, time) => { lookAt(...POSES[pose]); F[TIME] = time; return shot(); };
    ref.captureFly = (flyTime, time) => { F[FLT] = flyTime; flyAt(); F[TIME] = time; return shot(); };

    // ---- pipelines by creation order in main.js (the last one is the one-off detail bake)
    ref.pipelineNames = ['mip8', 'mip16', 'bloomDown0', 'bloomDown', 'bloomUp', 'terrain', 'solid', 'leaf9', 'leaf5', 'leafSmall', 'leafFar', 'fish', 'manta',
      'surface', 'backdrop', 'bubbles', 'snow', 'glints', 'solidShadow', 'terrainShadow', 'leafShadow', 'water', 'shaftBlur', 'shafts', 'post', 'detailBake'];
    ref.setMask = (names) => { ref.mask.clear(); for (const n of names) { const i = ref.pipelineNames.indexOf(n); if (i < 0) throw new Error('no pipeline ' + n); ref.mask.add(i); } };

    // ---- textures: six static ones first, then the eleven size-dependent targets of the latest resize()
    const STATIC = ['shadow', 'shadowDummy', 'water', 'detail', 'volume', 'groundMap'];
    const TARGET = ['msaa', 'depth', 'scene', 'shafts', 'shaftsBlurred', 'bloom0', 'bloom1', 'bloom2', 'bloom3', 'bloom4', 'bloom5'];
    const BYTES = { rgba16float: 8, rgba8unorm: 4, depth32float: 4, rg8unorm: 2 };
    ref.texture = (name) => {
      const s = STATIC.indexOf(name), t = TARGET.indexOf(name);
      if (s < 0 && t < 0) throw new Error('no texture ' + name);
      return ref.textures[s >= 0 ? s : ref.textures.length - TARGET.length + t];
    };
    ref.readTexture = async (name, mip = 0) => {
      const { t, d } = ref.texture(name), bpp = BYTES[d.format];
      if (!bpp || (d.sampleCount || 1) > 1) throw new Error(`cannot read ${name} (${d.format}, ${d.sampleCount || 1} samples)`);
      const w = Math.max(1, d.size[0] >> mip), h = Math.max(1, d.size[1] >> mip), layers = d.dimension === '3d' ? Math.max(1, d.size[2] >> mip) : 1;
      const stride = Math.ceil((w * bpp) / 256) * 256;
      const b = device.createBuffer({ size: stride * h * layers, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const e = device.createCommandEncoder();
      e.copyTextureToBuffer({ texture: t, mipLevel: mip }, { buffer: b, bytesPerRow: stride, rowsPerImage: h }, [w, h, layers]);
      Q.submit([e.finish()]);
      await b.mapAsync(GPUMapMode.READ);
      const src = new Uint8Array(b.getMappedRange()), out = new Uint8Array(w * bpp * h * layers);
      for (let r = 0; r < h * layers; r++) out.set(src.subarray(r * stride, r * stride + w * bpp), r * w * bpp);
      b.unmap(); b.destroy();
      return { bytes: out, format: d.format, width: w, height: h, layers };
    };

    // ---- hashes and dumps
    const bytesOf = (v) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    ref.manifest = async () => {
      const out = {};
      for (const [k, v] of Object.entries(ref.data)) out[k] = { type: v.constructor.name, length: v.length, sha256: await ref.sha(bytesOf(v)) };
      for (const [k, p] of Object.entries(ref.digests)) out[k] = { ...out[k], type: 'Float32Array', length: NX * NY * NZ, sha256: await p };
      return out;
    };
    const put = async (file, bytes) => { const r = await fetch('/dump/' + file, { method: 'PUT', body: bytes }); if (!r.ok) throw new Error(`dump ${file}: ${r.status}`); };
    ref.dumpData = async (skip = []) => { for (const [k, v] of Object.entries(ref.data)) if (!skip.includes(k)) await put(k + '.bin', bytesOf(v)); return Object.keys(ref.data); };
    ref.dumpTexture = async (name, mip, file) => { const r = await ref.readTexture(name, mip); await put(file, r.bytes); return { format: r.format, width: r.width, height: r.height, layers: r.layers }; };
  } else {
    // ---- baseline timings: upstream's own loop keeps running, at a held resolution
    // resize() re-arms upstream's tuning timer, so the hold has to be set after it
    ref.hold = (pixels) => { pix = pixels || PIXMAX; det = 1; resize(); dynT = -Infinity; return [W, H]; };
    ref.release = () => { dynT = 0; };
    ref.dive = () => ui(false); // leaves the menu, which also removes its CSS blur from the canvas
    ref.pose = (i) => lookAt(...POSES[i]);
    ref.state = () => ({ width: W, height: H, pixels: pix, detail: det, gpuMs: F[GPU] });
    // upstream's loop re-queues itself by name, so swapping the name out ends it after the frame already queued
    const upstreamFrame = frame;
    ref.pause = () => { frame = () => {}; };
    ref.resume = () => { frame = upstreamFrame; requestAnimationFrame((t) => { F[LAST] = t; requestAnimationFrame(frame); }); };
    // Frames run one at a time (loop paused), each timed until the GPU has finished it: cpu = JavaScript and
    // command encoding, total = until the submitted work is done
    const timeFrames = async (n, place) => {
      const cpuMs = [], totalMs = [];
      for (let i = 0; i < n; i++) {
        place(i);
        const t0 = performance.now(); render(); const t1 = performance.now();
        await Q.onSubmittedWorkDone();
        cpuMs.push(t1 - t0); totalMs.push(performance.now() - t0);
      }
      return { cpuMs, totalMs };
    };
    // the same wait with nothing submitted: what the measurement itself adds to every frame
    ref.costEmpty = async (n) => { const ms = []; for (let i = 0; i < n; i++) { const t0 = performance.now(); Q.submit([]); await Q.onSubmittedWorkDone(); ms.push(performance.now() - t0); } return ms; };
    ref.costPose = (pose, n) => { lookAt(...POSES[pose]); return timeFrames(n, () => { F[TIME] += 1 / 60; }); };
    ref.costFly = (n) => timeFrames(n, (i) => { F[FLT] = ((i + 0.5) * FLYT) / n; flyAt(); F[TIME] = F[FLT]; });
    // upstream's scripted 60 s fly-through benchmark (dev.js, key B); resolves with its own report text
    ref.flyBench = () => new Promise((done) => {
      ui(false); dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB' }));
      const poll = setInterval(() => { if (/^Fly-through/.test(info.textContent)) { clearInterval(poll); done(info.textContent); } }, 250);
    });
  }
  ref.ready = true;
}
