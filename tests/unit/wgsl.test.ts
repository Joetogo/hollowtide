import { describe, expect, it } from 'vitest';
import { WgslReflect } from 'wgsl_reflect';
import { loadWgsl, minifyWgsl } from '../../tools/wgsl.mjs';
import { declarations, group } from '../../src/gpu/bindings';
import { struct } from '../../src/gpu/struct';
import selfTest from '../../src/shaders/selftest.wgsl';

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

  it('names the including file when an include is missing', () => {
    expect(() => loadWgsl('tests/unit/fixtures/wgsl/broken.wgsl')).toThrow(
      /broken\.wgsl: cannot include .*missing\.wgsl/,
    );
  });

  it('gives the app a shader that still parses after minifying', () => {
    const SelfTest = struct('SelfTest', { shallow: 'vec3f', gain: 'f32', deep: 'vec3f' });
    const header = declarations(group(0, { selfTest: SelfTest }));
    expect(selfTest).toContain('fn fullscreenVertex');
    for (const source of [selfTest, minifyWgsl(selfTest)]) {
      const parsed = new WgslReflect(header + source);
      expect(parsed.entry.vertex.map((f) => f.name)).toEqual(['fullscreenVertex']);
      expect(parsed.entry.fragment.map((f) => f.name)).toEqual(['fragment']);
    }
  });
});
