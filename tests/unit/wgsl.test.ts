import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WgslReflect } from 'wgsl_reflect';
import {
  allPieces,
  headerNames,
  loadWgsl,
  minifyWgsl,
  renameWgsl,
  wgslPieces,
  wgslRenames,
} from '../../tools/wgsl.mjs';
import { declarations } from '../../src/gpu/bindings';
import { BlitGroup } from '../../src/render/passes/blit';
import { postGroup } from '../../src/render/passes/post';
import { ShaftsBlurGroup, shaftsGroup } from '../../src/render/passes/shafts';
import { WaterGroup } from '../../src/render/passes/water';
import { SceneGroup } from '../../src/render/scene';
import blit from '../../src/shaders/blit.wgsl';
import creatures from '../../src/shaders/creatures.wgsl';
import detail from '../../src/shaders/detail.wgsl';
import leaf from '../../src/shaders/leaf.wgsl';
import post from '../../src/shaders/post.wgsl';
import shaftsBlur from '../../src/shaders/shafts-blur.wgsl';
import shafts from '../../src/shaders/shafts.wgsl';
import solid from '../../src/shaders/solid.wgsl';
import sprites from '../../src/shaders/sprites.wgsl';
import surface from '../../src/shaders/surface.wgsl';
import water from '../../src/shaders/water.wgsl';

describe('minifyWgsl', () => {
  const cases: [string, string][] = [
    ['let x = a + b ;', 'let x=a+b;'],
    ['fn f ( a : f32 ) -> f32 { return - a ; }', 'fn f(a:f32)->f32{return-a;}'],
    ['a - -b', 'a- -b'], // never a--b
    ['a + +b', 'a+ +b'],
    ['a / *p', 'a/ *p'], // never a comment opener
    ['a & &b', 'a& &b'],
    ['x = 1. - .5;', 'x=1.-.5;'],
    ['@group(0) @binding(1) var t : texture_2d<f32> ;', '@group(0)@binding(1)var t:texture_2d<f32>;'],
    ['if (a) { b(); } else if (c) { d(); }', 'if(a){b();}else if(c){d();}'],
    ['let a = 1; // trailing\n/* block\n comment */ let b = 2;', 'let a=1;let b=2;'],
    ['const K = 1e-3 ;', 'const K=1e-3;'],
  ];
  for (const [input, output] of cases) it(JSON.stringify(input), () => expect(minifyWgsl(input)).toBe(output));
});

describe('loadWgsl', () => {
  it('splices includes in, each file once, and reports every file read', () => {
    const { code, files } = loadWgsl('tests/unit/fixtures/wgsl/root.wgsl');
    expect(code).not.toContain('#include');
    expect(code.match(/fn shared\(/g)).toHaveLength(1); // asked for by both root.wgsl and a.wgsl
    expect(code.indexOf('fn shared(')).toBeLessThan(code.indexOf('fn a('));
    expect(code.indexOf('fn a(')).toBeLessThan(code.indexOf('fn root('));
    expect(files.map((f: string) => f.split('/').pop())).toEqual(['root.wgsl', 'a.wgsl', 'shared.wgsl']);
  });

  it('in pieces, as the build ships it, it is the same text in the same order', () => {
    const pieces = wgslPieces('tests/unit/fixtures/wgsl/root.wgsl');
    expect(pieces.map((piece: { text: string }) => piece.text).join('')).toBe(
      loadWgsl('tests/unit/fixtures/wgsl/root.wgsl').code,
    );
    // and so for every shader the app has, minified piece by piece or all at once
    for (const file of readdirSync('src/shaders').filter((name) => name.endsWith('.wgsl'))) {
      const whole = loadWgsl('src/shaders/' + file, { minify: true }).code;
      const joined = wgslPieces('src/shaders/' + file)
        .map((piece: { text: string }) => minifyWgsl(piece.text))
        .filter(Boolean)
        .join('\n');
      expect(joined.replace(/\n/g, ''), file).toBe(whole);
    }
  });

  it('names the including file when an include is missing', () => {
    expect(() => loadWgsl('tests/unit/fixtures/wgsl/broken.wgsl')).toThrow(
      /broken\.wgsl: cannot include .*missing\.wgsl/,
    );
  });

  // every shader the app ships, with the bind groups it is compiled against
  const shaders: Record<string, { source: string; header: string; vertex: string[]; fragment: string[] }> = {
    blit: {
      source: blit,
      header: declarations(BlitGroup),
      vertex: ['fullscreenVertex'],
      fragment: ['mip', 'bloomDownFirst', 'bloomDown', 'bloomUp'],
    },
    'post (multisampled depth)': {
      source: post,
      header: declarations(postGroup(true)),
      vertex: ['fullscreenVertex'],
      fragment: ['composite'],
    },
    'post (plain depth)': {
      source: post,
      header: declarations(postGroup(false)),
      vertex: ['fullscreenVertex'],
      fragment: ['composite'],
    },
    detail: { source: detail, header: '', vertex: ['fullscreenVertex'], fragment: ['bakeDetail'] },
    water: { source: water, header: declarations(WaterGroup), vertex: ['fullscreenVertex'], fragment: ['drawWater'] },
    solid: { source: solid, header: declarations(SceneGroup), vertex: ['solidVertex'], fragment: ['solidFragment'] },
    surface: {
      source: surface,
      header: declarations(SceneGroup),
      vertex: ['surfaceVertex', 'backdropVertex'],
      fragment: ['surfaceFragment', 'backdropFragment'],
    },
    leaf: {
      source: leaf,
      header: declarations(SceneGroup),
      vertex: ['leafVertex', 'glintVertex'],
      fragment: ['leafFragment', 'glintFragment'],
    },
    creatures: {
      source: creatures,
      header: declarations(SceneGroup),
      vertex: ['fishVertex', 'mantaVertex'],
      fragment: ['fishFragment', 'mantaFragment'],
    },
    'shafts (multisampled depth)': {
      source: shafts,
      header: declarations(shaftsGroup(true)),
      vertex: ['fullscreenVertex'],
      fragment: ['marchShafts'],
    },
    'shafts (plain depth)': {
      source: shafts,
      header: declarations(shaftsGroup(false)),
      vertex: ['fullscreenVertex'],
      fragment: ['marchShafts'],
    },
    'shafts blur': {
      source: shaftsBlur,
      header: declarations(ShaftsBlurGroup),
      vertex: ['fullscreenVertex'],
      fragment: ['blurShafts'],
    },
    sprites: {
      source: sprites,
      header: declarations(SceneGroup),
      vertex: ['bubbleVertex', 'snowVertex'],
      fragment: ['bubbleFragment', 'snowFragment'],
    },
  };
  // ---- the short names production builds give the shaders' own names
  const pieces: Map<string, string> = allPieces('src/shaders');
  const keep: Set<string> = headerNames('src');
  const renames: Map<string, string> = wgslRenames([...pieces.values()], keep);
  const words = (text: string) => text.match(/(?<![A-Za-z0-9_])[A-Za-z_][A-Za-z0-9_]*/g) ?? [];

  it('the names TypeScript declares in front of a shader are all known to the renamer, and kept', () => {
    const headers = new Set(Object.values(shaders).map((shader) => shader.header));
    expect(headers.size).toBeGreaterThan(6);
    for (const header of headers) {
      for (const word of words(header)) {
        // (what is not a name of ours is a word of the language, which the renamer never touches either)
        if (!keep.has(word)) expect(renameWgsl(word, renames), word).toBe(word);
        expect(renames.has(word), word).toBe(false);
      }
    }
    for (const name of ['frame', 'camPos', 'lamp', 'shadowMap', 'sourceTexture', 'Frame'])
      expect(keep.has(name)).toBe(true);
  });

  it('renaming changes names and nothing else: the same shader, word for word', () => {
    expect(renames.size).toBeGreaterThan(250);
    // no two names share a short one, and no short one was a name already
    const shorts = new Set(renames.values());
    expect(shorts.size).toBe(renames.size);
    const all = new Set([...pieces.values()].flatMap(words));
    for (const short of shorts) expect(all.has(short) || keep.has(short), short).toBe(false);
    let saved = 0;
    for (const [key, text] of pieces) {
      const renamed = renameWgsl(text, renames);
      saved += text.length - renamed.length;
      const [before, after] = [words(text), words(renamed)];
      expect(after.length, key).toBe(before.length);
      before.forEach((word, i) => expect(after[i], `${key}: ${word}`).toBe(renames.get(word) ?? word));
      // and what stands between the words is untouched
      const gaps = (t: string) => t.replace(/(?<![A-Za-z0-9_])[A-Za-z_][A-Za-z0-9_]*/g, '\u0000');
      expect(gaps(renamed), key).toBe(gaps(text));
    }
    expect(saved).toBeGreaterThan(9000);
  });

  it('what the program asks a shader for by name keeps its name', () => {
    const asked = new Set(Object.values(shaders).flatMap((shader) => [...shader.vertex, ...shader.fragment]));
    for (const text of pieces.values()) {
      for (const m of text.matchAll(/\boverride\s+(\w+)/g)) asked.add(m[1]!);
      for (const m of text.matchAll(/\b(MOOD_\w+)/g)) asked.add(m[1]!);
    }
    for (const name of [
      'solidVertex',
      'leafFragment',
      'ROCK_FADE',
      'SHADOW_SIZE',
      'OWN',
      'PART',
      'MOOD_SUN',
      'MOOD_GLOW',
    ]) {
      expect(asked.has(name), name).toBe(true);
    }
    for (const name of asked) expect(renames.has(name), name).toBe(false);
    // nor are the language's own words, where a shader has used one for a variable, or short names
    for (const name of ['length', 'position', 'normalize', 'sample', 'xyz', 'rgb', 'uv']) {
      expect(renames.has(name), name).toBe(false);
    }
  });

  for (const [name, shader] of Object.entries(shaders)) {
    it(`${name} parses with short names, and has the same entry points`, () => {
      const parsed = new WgslReflect(shader.header + renameWgsl(minifyWgsl(shader.source), renames));
      expect(parsed.entry.vertex.map((f) => f.name)).toEqual(shader.vertex);
      expect(parsed.entry.fragment.map((f) => f.name)).toEqual(shader.fragment);
    });
  }

  for (const [name, shader] of Object.entries(shaders)) {
    it(`${name} parses, as written and minified, with the entry points the pipelines ask for`, () => {
      expect(shader.source).not.toContain('#include');
      for (const source of [shader.source, minifyWgsl(shader.source)]) {
        const parsed = new WgslReflect(shader.header + source);
        expect(parsed.entry.vertex.map((f) => f.name)).toEqual(shader.vertex);
        expect(parsed.entry.fragment.map((f) => f.name)).toEqual(shader.fragment);
      }
    });
  }
});
