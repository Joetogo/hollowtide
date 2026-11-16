// WGSL as files: an include resolver and a minifier, shared by the build and the unit tests.
import { readdirSync, readFileSync } from 'node:fs';
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

// ---------------------------------------------------------------- shorter names
//
// Production builds give the shaders' own names short ones: functions, parameters, locals, struct types and
// their members. What the rest of the program knows a shader by is left alone: entry points, `override`
// constants, the mood constants (rewritten by name when a mood is chosen), and every name in the declarations
// that TypeScript writes in front of a shader (uniform structs, their fields, the bindings).

/** WGSL's own words: never renamed, even where a shader uses one for a variable, and never handed out. */
const WGSL_WORDS = new Set(
  `alias break case const const_assert continue continuing default diagnostic discard else enable false fn for if
  let loop override requires return struct switch true var while do in of as or
  bool f16 f32 i32 u32 vec2 vec3 vec4 vec2f vec3f vec4f vec2i vec3i vec4i vec2u vec3u vec4u vec2h vec3h vec4h
  mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4 mat4x2 mat4x3 mat4x4 mat2x2f mat2x3f mat2x4f mat3x2f mat3x3f mat3x4f
  mat4x2f mat4x3f mat4x4f array atomic ptr sampler sampler_comparison texture_1d texture_2d texture_2d_array
  texture_3d texture_cube texture_cube_array texture_multisampled_2d texture_depth_2d texture_depth_2d_array
  texture_depth_cube texture_depth_cube_array texture_depth_multisampled_2d texture_storage_2d texture_external
  function private workgroup uniform storage read write read_write
  abs acos acosh all any arrayLength asin asinh atan atan2 atanh bitcast ceil clamp cos cosh countLeadingZeros
  countOneBits countTrailingZeros cross degrees determinant distance dot dpdx dpdxCoarse dpdxFine dpdy dpdyCoarse
  dpdyFine exp exp2 extractBits faceForward firstLeadingBit firstTrailingBit floor fma fract frexp fwidth
  fwidthCoarse fwidthFine insertBits inverseSqrt ldexp length log log2 max min mix modf normalize pack2x16float
  pack2x16snorm pack2x16unorm pack4x8snorm pack4x8unorm pow quantizeToF16 radians reflect refract reverseBits
  round saturate select sign sin sinh smoothstep sqrt step storageBarrier tan tanh textureDimensions
  textureGather textureGatherCompare textureLoad textureNumLayers textureNumLevels textureNumSamples
  textureSample textureSampleBaseClampToEdge textureSampleBias textureSampleCompare textureSampleCompareLevel
  textureSampleGrad textureSampleLevel textureStore transpose trunc unpack2x16float unpack2x16snorm
  unpack2x16unorm unpack4x8snorm unpack4x8unorm workgroupBarrier
  vertex fragment compute location builtin group binding interpolate invariant must_use size align id
  workgroup_size position vertex_index instance_index front_facing frag_depth sample_index sample_mask
  local_invocation_id local_invocation_index global_invocation_id num_workgroups
  perspective linear flat center centroid sample first either`.split(/\s+/),
);
const IDENTIFIER = /(?<![A-Za-z0-9_])[A-Za-z_][A-Za-z0-9_]*/g;
/** `.xy`, `.rgb` and the like: a name that could be one is neither renamed nor handed out. */
const SWIZZLE = /^(?:[xyzw]{1,4}|[rgba]{1,4})$/;
/** What stands inside these attributes are words of the language, not names. */
const ATTRIBUTE_WORDS = /@(?:builtin|interpolate|diagnostic)\([^)]*\)/g;

/**
 * Every name in the declarations TypeScript writes: the first argument of each `struct('Name', {…})` and the
 * keys of each `struct` and `group(n, {…})` under `directory`. (A test holds this against the real declarations.)
 */
export function headerNames(directory) {
  const names = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.ts')) {
        const text = readFileSync(file, 'utf8');
        for (const call of text.matchAll(/\b(?:struct\(\s*'(\w+)'|group\(\s*\d+)\s*,\s*\{/g)) {
          if (call[1]) names.add(call[1]);
          // the object literal, to its closing brace
          let depth = 1;
          let end = call.index + call[0].length;
          while (depth && end < text.length) {
            if (text[end] === '{') depth++;
            else if (text[end] === '}') depth--;
            end++;
          }
          const body = text.slice(call.index + call[0].length, end - 1).replace(/\/\/[^\n]*|'[^']*'/g, ' ');
          for (const key of body.matchAll(/([A-Za-z_]\w*)\s*:/g)) names.add(key[1]);
        }
      }
    }
  };
  walk(directory);
  return names;
}

/**
 * The short name for each name that can have one, given all the (minified) shader text there is and the names
 * to keep. The names that save the most get the shortest.
 * @returns {Map<string, string>}
 */
export function wgslRenames(texts, keep) {
  const used = new Set([...keep, ...WGSL_WORDS]);
  const count = new Map();
  const declared = new Set();
  const fixed = new Set();
  for (const text of texts) {
    const bare = text.replace(ATTRIBUTE_WORDS, (words) => ' '.repeat(words.length));
    for (const [name] of bare.matchAll(IDENTIFIER)) {
      used.add(name);
      count.set(name, (count.get(name) ?? 0) + 1);
    }
    for (const m of bare.matchAll(/\b(?:fn|let|const|struct|alias)\s+([A-Za-z_]\w*)/g)) declared.add(m[1]);
    for (const m of bare.matchAll(/\bvar(?:<[^>]*>)?\s+([A-Za-z_]\w*)/g)) declared.add(m[1]);
    // parameters, struct members, and anything else declared with its type
    for (const m of bare.matchAll(/([A-Za-z_]\w*)\s*:/g)) declared.add(m[1]);
    // what the program asks for by name
    for (const m of bare.matchAll(/\boverride\s+([A-Za-z_]\w*)/g)) fixed.add(m[1]);
    for (const m of text.matchAll(/@(?:vertex|fragment|compute)\s*(?:@\w+(?:\([^)]*\))?\s*)*fn\s+([A-Za-z_]\w*)/g)) {
      fixed.add(m[1]);
    }
  }
  const renameable = [...declared]
    .filter(
      (name) =>
        name.length > 3 &&
        !keep.has(name) &&
        !fixed.has(name) &&
        !WGSL_WORDS.has(name) &&
        !SWIZZLE.test(name) &&
        !name.startsWith('MOOD_'),
    )
    .sort((a, b) => count.get(b) * (b.length - 2) - count.get(a) * (a.length - 2) || (a < b ? -1 : 1));
  const FIRST = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const REST = FIRST + '0123456789';
  const fresh = (function* () {
    for (const a of FIRST) for (const b of REST) yield a + b;
    for (const a of FIRST) for (const b of REST) for (const c of REST) yield a + b + c;
  })();
  const renames = new Map();
  for (const name of renameable) {
    let short;
    do short = fresh.next().value;
    while (used.has(short) || SWIZZLE.test(short));
    used.add(short);
    renames.set(name, short);
  }
  return renames;
}

/** A (minified) shader text with the names in `renames` replaced. */
export function renameWgsl(text, renames) {
  let out = '';
  let last = 0;
  // the words inside @builtin(…) and @interpolate(…) stay as they are
  for (const words of [...text.matchAll(ATTRIBUTE_WORDS), { index: text.length, 0: '' }]) {
    out += text.slice(last, words.index).replace(IDENTIFIER, (name) => renames.get(name) ?? name) + words[0];
    last = words.index + words[0].length;
  }
  return out;
}

/** Every piece of every shader under `directory` (the files it includes among them), minified. */
export function allPieces(directory) {
  const pieces = new Map();
  for (const name of readdirSync(directory)) {
    if (!name.endsWith('.wgsl')) continue;
    for (const piece of wgslPieces(path.join(directory, name))) {
      const text = minifyWgsl(piece.text);
      if (text) pieces.set(`${piece.file}#${piece.index}`, text);
    }
  }
  return pieces;
}

/**
 * esbuild plugin: `import source from './x.wgsl'` gives the assembled text, in production builds minified and
 * with its names shortened (see above). Most shaders start with the same includes, so the bundle holds each
 * piece of each file once and a shader is joined from its pieces when the page starts: spliced in whole, the
 * shared part was in the file eight times over.
 */
export const wgslPlugin = ({ minify, shaders = 'src/shaders', source = 'src' }) => ({
  name: 'wgsl',
  setup(build) {
    const PIECE = /^wgsl-piece:(.*)#(\d+)$/;
    // production: minified, and with short names worked out once over all the shaders there are
    let renames = null;
    const own = (text) => {
      if (!minify) return text;
      renames ??= wgslRenames([...allPieces(shaders).values()], headerNames(source));
      return renameWgsl(minifyWgsl(text), renames);
    };
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
