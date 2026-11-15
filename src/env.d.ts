/** A .wgsl file imports as its source text, with `#include` lines already resolved (tools/wgsl.mjs). */
declare module '*.wgsl' {
  const source: string;
  export default source;
}

/** True in the dev server build, false in dist/index.html; dev-only code is dropped from the shipped file. */
declare const __DEV__: boolean;

/** True only in the `--report` build, which may send its start-up report to a listener on 127.0.0.1. */
declare const __REPORT__: boolean;
