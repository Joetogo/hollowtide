# Hollowtide: rebuild Abyssal Garden from scratch, then go beyond it

(The plan as approved, when the project's working name was "the rebuild"; milestones 11 and 15 were added since.)

## Context

[Noniv/abyssal-garden](https://github.com/Noniv/abyssal-garden) is a procedural WebGPU underwater scene (kelp
forests, light shafts, a wreck, mantas) shipped as one 97 KB `index.html`: no engine, no assets, 2,320 lines of
dense JavaScript and WGSL. It is MIT-licensed (© 2026 Maksymilian Dendura) and four days old.

The decision was to **rebuild it from scratch** in a new codebase, using the original only as a reference, and to improve
it on all four fronts: architecture & tooling, loading & performance, new visuals & creatures, new features & UX.
The look is the point, so the rebuilt scene has to match the original before anything is added.

This is a multi-session build. Every milestone below ends with a runnable, committed build, so the work can stop or
change course at any of them.

## How the original works

| File | Lines | Holds |
|---|---|---|
| `main.js` | 643 | device setup, every pipeline, world-gen orchestration, camera path, resize, culling, render, collision, dynamic resolution, input, menu |
| `shaders.js` | 782 | all WGSL, as template strings glued with `+` |
| `world.js` | 557 | hand-authored layout tables, 14 scatter systems, mesh builders |
| `math.js` / `audio.js` / `quality.js` / `dev.js` | 214 / 71 / 14 / 39 | noise, RNG, mesh helpers / WebAudio synth / detail level / fly-through and benchmark |

`build.mjs` concatenates these in a fixed order into one async function. There are no imports: every name is a
shared global.

**Load** (synchronous on the main thread):
1. A compute shader fills a 512×80×512 density grid (0.75 m voxels, a 384×60×384 m world) from hand-authored
   tables (19 rock masses, 3 arches, 2 tunnels, 8 clearings) plus noise. All 84 MB are read back to the CPU.
2. CPU: remove floating specks → collision bricks (2 MB) → surface-nets terrain, sorted into a 16×16 grid of cells.
3. `makeWorld`: about 2M kelp leaves and plants, rocks, sponges, corals, 4,240 fish, 6 mantas, bubbles, snow, glints;
   bakes a skylight volume and a ground map. Around 300 MB of transient memory.
4. Mesh builders, then one-time bakes: rock detail texture and a static 4096² sun shadow map (~35M triangles).

**Frame**: animated water texture → one MSAA×4 HDR forward pass (reversed-Z) → half-res volumetric light shafts
(34-step raymarch) + blur → 6-level bloom → composite (ACES, S-curve, vignette, dither). All motion is closed-form
in the vertex shaders; the CPU only culls cells. Resolution and draw distance scale from GPU timestamp queries.

**What the rebuild fixes**

| Problem in the original | Answer in the rebuild |
|---|---|
| No modules; shared globals; build order matters | TypeScript ES modules with explicit imports |
| Uniforms written by magic index (`UB[52]`, `m[56]`) that must match WGSL by hand; the shafts pass numbers the same resources differently | Struct and bind groups defined once, generating both the WGSL and typed offsets |
| WGSL in template strings; detail level baked in with `${}`, so changing it reloads the page | `.wgsl` files with includes; detail as pipeline constants and draw ranges; switch in place |
| World generation blocks the main thread for seconds; ~300 MB spike | Generation in a Web Worker, typed arrays end to end, real progress |
| One 643-line file does everything | Small pass, camera, input and UI modules |
| No tests, types, lint or CI | Unit tests, shader-compile smoke test, golden images, benchmark, CI |
| Shader defects I confirmed in the source: leaf curvature drops its sign (blade pops), the fog integral divides by ~0 at some upward view angles, a GPU-dependent sine hash runs per fragment | Fixed after parity is locked, goldens re-approved |
| Boulders and ground rocks drawn unculled; 9 shadow taps per rock fragment at any distance | Cell-cull them; distance-adaptive shadow filtering |
| Fly-through tour is dev-only; other browsers get a "use Chrome" hint | Tour, photo mode, settings, gamepad; Safari checked |

## Approach

1. **Port first, improve second.** Stage I rebuilds every subsystem in the new architecture. Stage II changes
   behaviour.
2. **The original runs beside the rebuild as an oracle.** A from-scratch graphics rewrite usually fails through
   subtle wrongness nobody can pin down, so every stage is compared against the real thing.
   - A pristine clone of upstream, pinned at commit `a596354`, lives at `~/Project.Git/oss/abyssal-garden` and is
     never edited.
   - `tools/reference/` in the new repo concatenates upstream's sources itself (as upstream's build does) with two
     hook files, and writes a local `reference.html`. The hooks checksum and dump the density field and every
     buffer and texture, render one frozen frame for `?pose=N&time=T` at a fixed size, and can mask individual
     draw groups.
3. **Two parity tracks, so pixel comparisons mean something early.**
   - **Renderer track**: the new renderer is first fed the *dumped reference data*. Any pixel that differs from
     the reference frame is a renderer bug.
   - **Generator track**: the new generator is then checked by checksum against the same dumps. Once it matches,
     live data replaces the dumps.
4. **Three porting rules**, because the world is chaotic in its inputs (one flipped voxel changes the terrain
   vertex count, which reshuffles seven scatter systems):
   - *Order-free code* (flood fill, sorting, culling, a grid lookup for the camera-path scans): rewrite freely.
   - *Draw-order-bound code* (the 14 scatter systems, mesh builders): restructure and name everything, but never
     reorder, hoist or merge a random draw. Their shared state becomes an explicit context object.
   - *Float-fragile code* (the density kernel, noise, fragment shaders): identifiers and layout only until the
     parity gate.
5. **Structural improvements go in from day one** (modules, types, worker, generated uniform struct, WGSL files).
   They do not change pixels. Fixes that do change pixels wait until parity is locked.
6. **One self-contained HTML file stays the shipping format.** The build prints its size every time.
7. **Credit.** `LICENSE` keeps the original copyright line next to yours, the shipped file carries the MIT notice,
   the README says what this is rebuilt from, and the menu links to the original. The original author's Ko-fi
   link is not carried over.

## Target architecture

Stack: TypeScript (strict) with `@webgpu/types`; esbuild only, for bundling, the dev server and live reload;
ESLint + Prettier; Vitest for unit tests; Playwright driving the installed Chrome (no browser download) for
anything that needs a GPU.

```
~/Project.Git/hollowtide/
  src/
    main.ts              boot: main thread or worker, decided at start-up
    config/quality.ts    detail levels and persisted settings (JSON)
    gpu/                 context (device, loss handling), resources, struct, bindings, timing
    render/              targets, pipelines (async cache), cull, dynres, frame
      passes/            water, bakes, scene, shafts, bloom, post
    shaders/             *.wgsl, with common/*.wgsl includes
    world/               layout.ts (authored tables, moved unchanged), density, terrain, collision, volume
      scatter/           the 14 systems, run from one ordered list
      meshes/            rock, lathe, coral, tubes, fluke, ship, manta, fish
      generate.ts        worker entry: stages, progress, transfer protocol
    camera/              camera, controls (keyboard, mouse, touch, gamepad), path (spline, tour)
    audio/soundscape.ts  with its own random stream
    ui/                  menu, hud, settings, photo
    math/                rng, noise, quat, meshBuilder, surfaceNets
  tools/                 build.mjs, wgsl plugin, reference/ (rig + hooks), compare, bench
  tests/                 unit/ (Vitest), browser/ (Playwright)
```

Key mechanisms:
- **`gpu/struct.ts` and `gpu/bindings.ts`**: `struct('Frame', {…})` returns the WGSL text, the byte size and a
  typed offset table, following WGSL alignment rules. `group(…)` does the same for bind groups. WGSL files hold
  functions and `#include`s only; resource declarations are generated and prepended when a module is created, so
  no pass can disagree with another or with the CPU side.
- **Worker in a single file**: the bundle is one script that boots as the main thread or as the worker. The main
  thread starts the worker from a Blob of its own source, so there is no duplicated code and it runs from
  `file://`.
- **Division of labour**: the main thread keeps the only GPU device, camera, collision, UI and audio. It runs
  the density compute in slabs and transfers each slab out. The worker does speck removal, collision bricks,
  surface nets, scattering, meshes, the skylight volume and the ground map, and posts each result back as a
  transferable with real progress. Uploads are chunked so no task runs long.
- **Hot path**: per-frame state stays in preallocated typed arrays, as in the original.

## Milestones

| # | Scope | Exit test |
|---|---|---|
| 0 | **Reference rig.** Clone upstream; build `reference.html` with the capture hooks; dump fixtures (~350 MB, gitignored); record baselines on an Apple M3 | Two separate loads give byte-identical images for the six viewpoints; checksum manifest and baseline table saved |
| 1 | **Scaffold.** TS, single-file build, dev server, WGSL plugin, struct and bindings, worker stub, lint, unit tests, CI file, size report | The built file opens from `file://` in Chrome and Safari and round-trips a 16 MB transfer through the worker; struct offsets match an independent WGSL parser |
| 2 | **Engine core.** Device, async pipeline cache, render targets, camera, bloom and composite, capture API | Frame uniform bytes equal the reference's at each viewpoint; the post chain on a dumped HDR frame matches the reference image |
| 3 | **Bakes.** Rock detail texture, water texture, shadow map from dumped geometry | Texture dumps match; shadow depth within 1e-6 |
| 4 | **Opaque scene on dumped data.** Rock and terrain shader, fog, water surface, backdrop, cell culling and LOD | First pixel parity, against the reference with other draw groups masked |
| 5 | **Leaves and life on dumped data.** Kelp, plants, glints, fish, mantas, bubbles, snow | Parity with only the shafts masked, at three times |
| 6 | **Light shafts and blur; Medium and Low variants** | Full-frame parity: 6 viewpoints × 3 times × 3 levels, plus 30 fly-through frames |
| 7 | **Generator, part 1 (worker).** Density, speck removal, collision bricks, terrain, camera path, ground map, meshes | Checksums equal the reference for each |
| 8 | **Generator, part 2.** Scatter systems 1–14 in order, skylight volume, packing | Instance checksums equal at all three levels; live data reproduces milestone 6's frames |
| 9 | **Shell.** Loading UI, menu, mouse / keyboard / touch, collision, dynamic resolution, crash fallback, audio | A scripted-input camera trace equals the reference; no main-thread task over 50 ms during load; Safari smoke test. **Parity gate** |
| 10 | **Speed-ups that must not change a pixel.** Cull boulders, chunked shadow bake, provably-equivalent generator speed-ups, tiered leaf ordering | Goldens and checksums unchanged; timings beat the baseline |
| 11 | **In the water** (added 2026-11-16). The swimmer's own arms in first person, swimming in strokes; a hand-held jet scooter for fast travel | Goldens unchanged (the body is not drawn in captures); a scripted stroke test; frame cost within 0.3 ms |
| 12 | **Speed-ups and fixes that do change pixels**, in one re-baseline | the side-by-side review is approved; new goldens |
| 13 | **Features and UX** | Each setting applies as promised; goldens unchanged at defaults |
| 14 | **New visuals and creatures** | The default mood is pixel-identical to milestone 12's goldens |
| 15 | **Its own name** (added 2026-11-16; done the same day: the name is **Hollowtide**). Title, menu, package, storage keys, test hook and docs carry the name; the credit to the original stays | The old name appears only where the original is meant: the credit, the licence, the reference rig and the tests against it |

## Stage II detail

**Milestone 11: in the water** (built; the README's section "The swimmer" says how)
- The arms: a wetsuit sleeve and a gloved hand each, sculpted and skinned to a skeleton of 19 bones an arm
  (a forearm that twists, a wrist, jointed fingers), lit like everything else, with a dive computer on the left
  wrist. Drawn by a small pipeline of their own, so the world's shaders are untouched.
- Swimming in strokes: holding forward runs a breaststroke of eight key poses. Speed surges on the pull and
  fades through the glide instead of easing to a constant, and the view nods with each pull. Moving any other
  way is done by sculling.
- Jet propulsion: a hand-held scooter (two grips, a ringed propeller, a lamp). Holding the fast key brings it
  up: steady fast travel, both hands on the grips, a hum in the soundscape.
- The original's glide stays as a setting (`C`), which reduced motion selects by default. The scripted swim
  test keeps checking it against the original; the body has tests of its own.
- Still to do here: bubbles off the hands and a wash behind the propeller, legs and fins when looking down, a
  beam for the scooter's lamp, a wider view at speed.

**Milestone 12: performance and fixes** (measured on an Apple M3 / 8 GB first; a change stays only if the numbers move)
- Done so far: the tuned set of draw distances (`src/config/tuning.ts`), sprites culled by cell, the kelp blades'
  smooth bend, half rate behind the pause panel. Measured and dropped: the fog integral's divide by zero (it
  can only bite within a millionth of one viewing angle) and fewer shaft steps (worth under 1 %).
- Distance-adaptive shadow filtering; fewer shaft steps with a wider blur; cheaper or lower-rate water texture.
- Dynamic resolution that no longer assumes pixel count is the bottleneck (to be measured on Apple GPUs).
- Half-rate rendering behind the menu; no fixed 2560×1440 cap.
- Defect fixes: leaf curvature (series fallback near zero), fog integral, sine hash, the collision brick cap.

**Milestone 13: features and UX**
- Done: settings in the pause panel (look speed, inverted look, field of view, volume, smooth or sharp picture,
  arms or classic), photo mode with a picture saved at up to 4K, the tour. Still to do from the list below:
  share-camera URL, gamepad, arrow-key look, drag-to-look, a visible mute button, `?seed=`, switching the
  detail level without a reload.
- Done ahead of the rest (2026-11-16): the opening. A diver sinks while the world loads, the
  picture goes black, the home view drifts through the world with "W A S D to dive", and the dive opens the
  swimmer's eyes on the seabed. See "The opening" in the README.
- Settings panel in three tiers: instant (field of view, sensitivity, invert Y, volume, exposure), pipeline
  rebuild in about a second (anti-aliasing, shaft quality), and data (detail level: lower instantly by drawing a
  prefix of each cell, raise by regenerating in the worker).
- Cinematic tour from the existing fly path, in the shipped build.
- Photo mode: pause time, hide the UI, export one 2× supersampled frame as PNG. A share-camera URL.
- Gamepad; arrow-key look; drag-to-look when pointer lock is refused; a visible mute button; reduced-motion support.
- `?seed=` reseeds the randomly placed systems. Terrain, set pieces and hand-placed kelp stay authored.

**Milestone 14: new visuals**
- Done: jellyfish (built in the vertex shader rather than from a lathe mesh; added light, drawn last); fish
  that part around the swimmer (one closed-form term in their vertex shader); turtles (sculpted like the
  swimmer's hands rather than built on the manta rig; rowed in the vertex shader). Still to do: mood presets.
- Mood presets (for example noon, deep dusk, moonlit glow) through about eight uniforms that scale sunlight,
  ambient, fog and exposure, plus one true glow term. The original's "emissive" is proportional to incoming light,
  so a dark mood needs that term. The sun direction stays fixed: moving it would break the caustics and the baked
  shadows.
- Bioluminescent jellyfish (lathe bell in the blended pass) and a sea turtle (built on the manta rig).
- Fish schools that part around the camera, stateless. Compute-shader flocking is a stretch goal.

## Verification

- `npm run check`: typecheck, lint, unit tests (RNG streams, struct layout, spline table, dynamic-resolution
  controller, cell culling, collision on a synthetic field, surface nets on a sphere, mesh builders).
- `npm run build`: writes `dist/index.html`, prints raw and gzipped size, fails over budget (130 KB to start;
  the original is 97 KB).
- `npm run test:browser`: every shader module compiles in real Chrome with no validation errors.
- `npm run compare`: runs the rebuild against the cached reference outputs, one page at a time, and writes the
  checksum table plus side-by-side and heat-map images for the six viewpoints.
- `npm run test:visual`: the rebuild's own golden images at frozen time and fixed size.
- `npm run bench`: the 60 s fly-through. Reports load time, longest main-thread task, peak memory, and average /
  99th-percentile / worst frame time and per-pass GPU time, against the milestone 0 baseline.
- By hand: open `dist/index.html` from `file://` in Chrome and Safari, swim the six viewpoints, switch detail level.
- At the parity gate: a reviewer who sees only image pairs and heat maps, never code, lists visible
  differences.

## Not yet known (settled in milestones 0 and 1)

- Whether the original's High level loads reliably in 8 GB. Milestone 0 measures it; if not, Medium is the
  comparison level on this machine.
- Whether headless Chrome gets the real GPU on macOS. The harness runs headed until that is proven.
- Whether Safari starts a Blob worker from `file://`. If not, the Safari build is served over localhost.
- Exact checksum equality holds only on one machine and one Chrome version. If the re-typed density kernel does
  not reproduce the field bit for bit, generator parity falls back to statistics and review. Renderer parity is
  unaffected, because it is tested on dumped data. Goldens are re-baselined when Chrome updates.

## Critical files

- Upstream, read-only: `source/src/world.js` (generator draw order and shared state), `source/src/shaders.js`
  (density kernel and all shading), `source/src/main.js` (bakes, frame order, camera path, collision).
- New: `tools/reference/build-ref.mjs` with `capture-pre.js` and `capture-post.js` (the rig),
  `src/gpu/struct.ts`, `src/world/generate.ts`, `tools/build.mjs`.
