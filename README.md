# Abyssal Garden, rebuilt

A from-scratch rebuild of [Abyssal Garden](https://github.com/Noniv/abyssal-garden) by Noniv (Maksymilian Dendura):
a procedural WebGPU underwater world with no engine and no asset files. The original is the reference this project
is checked against, and the source of the scene's design, layout and shading. Both are MIT-licensed; see `LICENSE`.

The goal is the same scene in a codebase that is typed, modular and tested, and then to go further: faster loading,
better performance on laptops, new creatures and moods, photo mode and a guided tour. `PLAN.md` has the full plan
and the milestone list.

## Status

Done so far:

| Milestone | What exists | How it was checked |
|---|---|---|
| 0. Reference rig | The original, driven and measured on this machine | Two separate loads give byte-identical frames and hashes |
| 1. Scaffold | TypeScript modules, single-file build with its worker, WGSL files, generated uniform layouts, tests, CI | Starts from `file://` in Chrome and Safari; layouts agree with an independent WGSL parser |
| 2. Engine core | Device, camera, frame uniforms, render targets, bloom and composite passes, capture hooks | Frame uniforms equal the original's bit for bit (18 frames); bloom is bit-identical and the composited frame differs in 0 of 921,600 pixels at all six viewpoints |

| 3. Bakes | Rock detail texture, animated water texture, sun shadow map; the world-data contract and its GPU buffers | All three equal the original's value for value (4.2M, 1.0M and 16.8M values), the shadow map baked from the original's dumped world |

The scene pass is still empty, so the page itself shows almost nothing yet. Next is milestone 4: the rock and
terrain shader, fog, the water surface and the backdrop, drawn from the original's dumped world.

## Working on it

```bash
npm install
npm run dev            # http://127.0.0.1:5173, rebuilds and reloads on save
npm run check          # typecheck, lint, unit tests
npm run build          # dist/index.html: one self-contained file, size printed, 130 kB budget enforced
npm run test:browser   # Chrome: the built files start from file://, and the passes match the original
npm run test:safari    # Safari: the build starts from file:// (Safari is left open on the test page)
```

How it is put together:

- `src/main.ts` is one bundle with two roles: the page runs it as the main thread, and the main thread starts the
  world-generation worker from a Blob of the same script. That keeps the build to a single file that also runs
  from `file://`.
- `src/gpu/struct.ts` and `src/gpu/bindings.ts` define uniform structs and bind groups once and generate both the
  WGSL declarations and the typed offsets, so shaders and the code that feeds them cannot drift apart.
- `src/shaders/*.wgsl` are real files with `#include "…"`; `tools/wgsl.mjs` resolves the includes and minifies
  them for the shipped build.
- `src/app/harness.ts` holds the hooks the browser tests use (capture a frame, feed in a dumped scene of the
  original, compare). It is compiled into `dist/index.harness.html` and the dev server only, never into
  `dist/index.html`.

The browser tests that compare against the original need its fixtures: run `npm run ref:dump` once.

## The reference rig

The original runs beside the rebuild as an oracle. It is never edited: `tools/reference/` reads a pristine clone,
pinned to one commit in `upstream.json`, and concatenates its sources with two hook files into a local page.

```bash
git clone https://github.com/Noniv/abyssal-garden ../oss/abyssal-garden   # once; the path is in upstream.json
npm install
npm run ref:verify    # frozen frames + hashes, then a second load that must match byte for byte
npm run ref:dump      # the generated world and a few textures, as fixtures (about 460 MB, not committed)
npm run ref:bench     # load time, memory and frame cost on this machine
```

These drive the installed Google Chrome in a visible window (WebGPU needs the real GPU) and write to
`.cache/reference/<commit>/L<detail level>/`. Add `-- --level 1` or `-- --level 2` for Medium or Low.

## Baseline: the original on an Apple M3, 8 GB (High detail, Chrome 157)

| | |
|---|---|
| Load | 3.7 s, of which the main thread is blocked for 3.2 s (longest single task 1.7 s) |
| Peak memory while loading | 1.0 GB in the page's process, 1.6 GB for the browser in total |
| Frame cost at 2560×1440 | 28–47 ms at the six viewpoints; 39 ms on average along the fly-through (26 fps) |
| Frame cost at 1280×720 | 23–33 ms; 27 ms on average along the fly-through |
| Frame cost at 640×360 | 20–28 ms |
| Where its dynamic resolution ends up | 942×530 at 40 % draw distance, the lowest it can go |

Frame cost is measured by running frames one at a time and waiting for the GPU to finish each. A frame costs about
20 ms however few pixels it has, so on this machine the scene is bound by geometry, not by resolution, and lowering
the resolution cannot reach 60 fps. That is the main target for the performance work.

The reference world at High: 808k terrain vertices, 2.17M leaves and plants, 629k glints, 68k rocks and pebbles,
18k sponges and corals, 18k bubbles, 4,240 fish, 6 mantas.
