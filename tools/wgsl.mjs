// WGSL as files: an include resolver and a minifier, shared by the build and the unit tests.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const INCLUDE = /^[ \t]*#include[ \t]+"([^"]+)"[ \t]*$/gm;

/**
 * Reads a .wgsl file and splices in every `#include "relative/path.wgsl"` line. A file is included once per root,
 * the first time it is asked for, so shared chunks can include their own dependencies freely.
 * @returns {{ code: string, files: string[] }} the assembled source and every file it was built from
 */
export function loadWgsl(file, { minify = false } = {}) {
  const seen = new Set();
  const read = (target, from) => {
    const abs = path.resolve(target);
    if (seen.has(abs)) return '';
    seen.add(abs);
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      throw new Error(`${from}: cannot include ${abs}`);
    }
    return text.replace(INCLUDE, (_, rel) => read(path.resolve(path.dirname(abs), rel), abs));
  };
  const code = read(file, file);
  return { code: minify ? minifyWgsl(code) : code, files: [...seen] };
}

const WORD = /[A-Za-z0-9_.]/;
const OPERATOR = /[-+*/%&|^<>=!~]/;

/**
 * Strips comments and all whitespace that is not needed to keep two tokens apart. It only ever decides whether a
 * run of whitespace becomes one space or nothing, so it cannot change a token: `a - -b` stays `a- -b`, never `a--b`.
 */
export function minifyWgsl(source) {
  const chunks = source
    .replace(/\/\*[^]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  let out = '';
  for (const chunk of chunks) {
    const a = out[out.length - 1];
    const b = chunk[0];
    const glue = a !== undefined && ((WORD.test(a) && WORD.test(b)) || (OPERATOR.test(a) && OPERATOR.test(b)));
    out += (glue ? ' ' : '') + chunk;
  }
  return out;
}

/** esbuild plugin: `import source from './x.wgsl'` gives the assembled text, minified in production builds. */
export const wgslPlugin = ({ minify }) => ({
  name: 'wgsl',
  setup(build) {
    build.onLoad({ filter: /\.wgsl$/ }, (args) => {
      const { code, files } = loadWgsl(args.path, { minify });
      return { contents: code, loader: 'text', watchFiles: files };
    });
  },
});
