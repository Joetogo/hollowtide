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

/**
 * The same assembly as loadWgsl, kept in pieces: each file's own text, cut where its includes stand, in the order
 * the assembled source has them. A piece is named by its file and its place in it.
 * @returns {{ file: string, index: number, text: string }[]}
 */
export function wgslPieces(file) {
  const seen = new Set();
  const pieces = [];
  const read = (target, from) => {
    const abs = path.resolve(target);
    if (seen.has(abs)) return;
    seen.add(abs);
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      throw new Error(`${from}: cannot include ${abs}`);
    }
    let last = 0;
    let index = 0;
    for (const match of text.matchAll(INCLUDE)) {
      pieces.push({ file: abs, index: index++, text: text.slice(last, match.index) });
      read(path.resolve(path.dirname(abs), match[1]), abs);
      last = match.index + match[0].length;
    }
    pieces.push({ file: abs, index, text: text.slice(last) });
  };
  read(file, file);
  return pieces;
}

/**
 * esbuild plugin: `import source from './x.wgsl'` gives the assembled text, minified in production builds.
 * Most shaders start with the same includes, so the bundle holds each piece of each file once and a shader is
 * joined from its pieces when the page starts: spliced in whole, the shared part was in the file eight times over.
 */
export const wgslPlugin = ({ minify }) => ({
  name: 'wgsl',
  setup(build) {
    const PIECE = /^wgsl-piece:(.*)#(\d+)$/;
    const own = (text) => (minify ? minifyWgsl(text) : text);
    build.onLoad({ filter: /\.wgsl$/ }, (args) => {
      const pieces = wgslPieces(args.path).filter((piece) => own(piece.text).trim());
      const names = pieces.map((piece) => JSON.stringify(`wgsl-piece:${piece.file}#${piece.index}`));
      const contents =
        names.map((name, i) => `import p${i} from ${name};`).join('\n') +
        // a line break between pieces: the end of one and the start of the next must not run into one token
        `\nexport default ${names.map((_, i) => `p${i}`).join(' + "\\n" + ')};\n`;
      return { contents, loader: 'js', watchFiles: [...new Set(pieces.map((piece) => piece.file))] };
    });
    build.onResolve({ filter: PIECE }, (args) => ({
      path: args.path.slice('wgsl-piece:'.length),
      namespace: 'wgsl-piece',
    }));
    build.onLoad({ filter: /.*/, namespace: 'wgsl-piece' }, (args) => {
      const [, file, index] = PIECE.exec('wgsl-piece:' + args.path);
      const piece = wgslPieces(file).find((each) => each.file === file && each.index === +index);
      return { contents: own(piece.text), loader: 'text', watchFiles: [file] };
    });
  },
});
