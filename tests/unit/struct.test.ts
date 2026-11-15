import { describe, expect, it } from 'vitest';
import { WgslReflect } from 'wgsl_reflect';
import { struct, type Fields, type Struct } from '../../src/gpu/struct';

/** What an independent WGSL parser makes of the generated declaration. */
function reflect(s: Struct) {
  const info = new WgslReflect(s.wgsl).structs.find((x) => x.name === s.name)!;
  return { size: info.size, offset: Object.fromEntries(info.members.map((m) => [m.name, m.offset])) };
}

describe('struct', () => {
  it('reproduces the 240-byte frame block of the original', () => {
    // upstream's `G`: seven vec4f after two matrices, here with each packed scalar named
    const frame = struct('Frame', {
      viewProj: 'mat4x4f',
      shadowMat: 'mat4x4f',
      camPos: 'vec3f',
      time: 'f32',
      right: 'vec3f',
      tanHalfX: 'f32',
      up: 'vec3f',
      tanHalfY: 'f32',
      fwd: 'vec3f',
      near: 'f32',
      sunDir: 'vec3f',
      zoneBlend: 'f32',
      res: 'vec2f',
      invRes: 'vec2f',
      exposure: 'f32',
      shaftGain: 'f32',
      detail: 'f32',
    });
    expect(frame.size).toBe(240);
    expect(frame.offset).toMatchObject({
      viewProj: 0,
      shadowMat: 64,
      camPos: 128,
      time: 140,
      right: 144,
      tanHalfX: 156,
    });
    expect(frame.offset).toMatchObject({ up: 160, fwd: 176, near: 188, sunDir: 192, zoneBlend: 204, res: 208 });
    expect(frame.offset).toMatchObject({ invRes: 216, exposure: 224, shaftGain: 228, detail: 232 });
    // the float indices the original writes by hand: UB[35] time, UB[52] width, UB[56] exposure, UB[58] detail
    expect(frame.at).toMatchObject({ time: 35, res: 52, exposure: 56, detail: 58 });
  });

  const cases: Record<string, Fields> = {
    'scalars pack tightly': { a: 'f32', b: 'u32', c: 'i32' },
    'vec3f followed by f32 shares a 16-byte slot': { p: 'vec3f', t: 'f32' },
    'vec3f followed by vec3f does not': { a: 'vec3f', b: 'vec3f' },
    'a scalar pushes the next vec2f to 8 and the next vec4f to 16': { a: 'f32', b: 'vec2f', c: 'f32', d: 'vec4f' },
    'a trailing scalar is padded to the struct alignment': { m: 'mat4x4f', x: 'f32' },
    'vec2f pairs': { a: 'vec2f', b: 'vec2f', c: 'f32' },
  };
  for (const [name, fields] of Object.entries(cases)) {
    it(`agrees with an independent WGSL parser: ${name}`, () => {
      const s = struct('T', fields);
      const parsed = reflect(s);
      expect(s.size).toBe(parsed.size);
      expect(s.offset).toEqual(parsed.offset);
      for (const key of Object.keys(fields)) expect(s.at[key]).toBe(s.offset[key]! / 4);
    });
  }

  it('rejects a type it has no layout for', () => {
    expect(() => struct('T', { a: 'mat3x3f' } as unknown as Fields)).toThrow(/unsupported type mat3x3f/);
  });
});
