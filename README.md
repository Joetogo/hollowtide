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

| 4. Opaque scene | Rock and seabed shader, set pieces, sponges, corals, water surface, backdrop, cell culling and level of detail | Drawing the original's dumped world, all six viewpoints match its frames: at most 2 of 921,600 pixels differ, by 1/255 |

| 5. Plants and life | Kelp, plants and their glints, fish, manta rays, bubbles, drifting particles | With only the light shafts off on both sides, six viewpoints at three times each: at most 4 of 921,600 pixels differ, by 1/255 |

| 6. Light shafts, detail levels | Volumetric light shafts and their blur; Medium and Low variants; the scripted camera path | Whole frames against the original at High, Medium and Low: six viewpoints at three times each, plus 30 frames along the fly-through at High. At High and Medium at most 11 of 921,600 pixels differ, by 1/255 |

| 7. Generator, part 1 | In the worker: speck removal, collision bricks, terrain mesh, ground map, all 26 procedural meshes; on the GPU: the density field | Each output has the same SHA-256 as the original's, at all three detail levels (13 outputs, from 21 million voxels of density to the ship's planks) |

| 8. Generator, part 2 | The 14 scatter systems (kelp, plants, glints, sponges, corals, rocks, set pieces, bubbles, fish, mantas, particles), the skylight volume, packing; the page now builds its own world | All 84 outputs have the same SHA-256 as the original's at all three levels; frames drawn from the generated world pass the same comparison as milestone 6 |

| 9. Shell | Loading bar, menu, keyboard / mouse / touch, collision, dynamic resolution, detail levels and crash fallback, stats line, sound | A scripted swim of 536 frames (easing, turning, sprinting into rock and sliding along it) traces the original's path bit for bit; no main-thread task over 50 ms while loading; starts and draws in Safari 27 from `file://` |
| 10. Speed-ups that do not change a pixel | The world is built by two workers side by side and starts alongside shader compilation; the generator itself is about twice as fast; boulders outside the view are not drawn | 48 frames at High and 48 at Medium are bit-identical before and after (`tests/browser/same.mjs`); all 84 generator outputs still have the original's checksums; loading takes about 40 % less |

**Parity gate: passed.** The rebuild is the original, from scratch: `dist/index.html` builds the same world (all
84 generator outputs have the original's checksums), draws the same frames (at High and Medium at most 11 of
921,600 pixels differ, by 1/255; three of four spot-checked frames are byte-identical PNG files), and swims the
same way. What is left is the part that goes beyond the original: milestones 10 to 13.

```bash
npm run build && open dist/index.html     # or: npm run dev
```

Controls are the original's: `W A S D` swim, `Q` / `E` down / up, `Shift` faster, `1`–`6` viewpoints, `Esc` menu,
`M` mute, `H` stats. On a touchscreen: hold to swim forward, slide to steer, a second finger to go faster.

What already differs from the original, on an Apple M3 with 8 GB at High detail. `npm run bench` opens both
side by side and lets them take turns, a few dozen frames each: a laptop slows by half as it warms up, so timings
taken minutes apart cannot be compared.

| | Original | Rebuild |
|---|---|---|
| Main thread held while loading | 3.0 s (longest task 1.7 s) | none: no task over 50 ms (see the note) |
| Load time, both measured in one sitting on a warm machine | 6.1 s | 3.6 s |
| Peak memory while loading, page / whole browser | 1.1 GB / 1.9 GB | 0.5 GB / 1.2 GB |
| Loading bar | timed animation | real progress from the generator |
| Shipped file | 97 kB | 147 kB (its shaders keep readable names; renaming them at build time is on the list) |
| Frame at 2560×1440, six viewpoints | 45.7 / 35.4 / 26.9 / 38.5 / 35.9 / 35.7 ms | the same within 3 % |
| Frame at 640×360, six viewpoints | 26.2 / 19.1 / 19.6 / 20.3 / 21.2 / 19.2 ms | the same within 3 % |
| 60 s fly-through at 2560×1440, average | 37.8 ms | 37.1 ms |

Where the loading time went (milestone 10), each step checked against the original's checksums:

- The meshes and the ground map need nothing from the density field, so a second worker builds them while the
  first is busy with the terrain; both start alongside shader compilation instead of after it.
- Two things took half of the generator's time. One was the test "is this point near the camera's path", made
  for every plant and rock against all 606 points of the path: the points now sit in a grid, and the test looks
  at the few nearby. The other was `Math.hypot`, which in V8 is a general routine about nine times slower than
  the arithmetic it does: `src/math/hypot.ts` does the same arithmetic, to the bit.
- The collision field is worked out after the world has been handed over, as nothing on screen waits for it.
- `node tools/profile-generator.mjs --cpu` shows where the time goes now.

The frame costs are still the original's. Both submitted exactly the same geometry (35,034,683 vertices and
indices at the first viewpoint), and that geometry, not the pixel count, is what a frame costs on this GPU. The
rebuild now leaves out the boulders that are outside the view (they were 5.7 million of those indices, drawn
wherever the camera looked), which is worth a few per cent. `node tests/browser/profile.mjs` times a frame with
each part of the scene left out: no single part dominates (plants and glints about a third, rocks a sixth, the
fixed passes a sixth), so the larger gains need coarser meshes in the distance, which changes pixels and is a
later milestone.

Note on the long tasks: the shell test (1280×720) and eight of nine loads measured at 2560×1440 had none. One
load, on a hot machine with the original open in a second browser, had a single task of 455 ms; it did not
happen again in six attempts to reproduce it, three of them under the same conditions. The benchmark now records
when a long task starts and which loading message was up, so the next one can be placed.

For development the page can also draw a dump of the original's world instead of its own: `npm run ref:dump`
once, then `http://127.0.0.1:5173/?world=reference` (add `&level=1` or `2` for Medium or Low). `npm run shots`
saves frames to `test-results/shots/`.

Known issue, inherited from the original: at Low detail (no anti-aliasing), and now and then at Medium, the scene
is not exactly repeatable from one render to the next on this Apple GPU. A few hundred isolated pixels on the
plants change while the depth buffer stays identical. Two loads of the original differ by up to 722 pixels in a
frame (`tests/browser/noise.mjs` measures it), and the rebuild behaves the same way, so the Low comparison allows
0.2 % of pixels to differ. Ruled out so far: the blended draws, the fish, shadow sampling in vertex shaders, the
sine hash, and the timing of the shadow bake. Finding the cause is on the list for milestone 11.

## Working on it

```bash
npm install
npm run dev            # http://127.0.0.1:5173, rebuilds and reloads on save
npm run check          # typecheck, lint, unit tests
npm run build          # dist/index.html: one self-contained file, size printed, 130 kB budget enforced
npm run test:browser   # Chrome: 519 checks against the original (frames, checksums, swimming) and of the shell
npm run test:safari    # Safari: the build starts from file:// and draws (Safari is left open on the test page)
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
