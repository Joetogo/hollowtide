/** A .wgsl file imports as its source text, with `#include` lines already resolved (tools/wgsl.mjs). */
declare module '*.wgsl' {
  const source: string;
  export default source;
}

/** True in the dev server build, false in dist/index.html; dev-only code is dropped from the shipped file. */
declare const __DEV__: boolean;

/**
 * True only in the `--harness` build (dist/index.harness.html): the shipped code plus the hooks tests use to
 * drive it and compare it with the original (src/app/harness.ts).
 */
declare const __HARNESS__: boolean;
