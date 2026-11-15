import { describe, expect, it } from 'vitest';
import { WgslReflect } from 'wgsl_reflect';
import { declarations, group } from '../../src/gpu/bindings';
import { struct } from '../../src/gpu/struct';

const Frame = struct('Frame', { viewProj: 'mat4x4f', camPos: 'vec3f', time: 'f32' });
const Scene = group(0, {
  frame: Frame,
  repeat: 'sampler',
  shadowSampler: 'sampler_comparison',
  shadowMap: 'texture_depth_2d',
  water: 'texture_2d<f32>',
  volume: 'texture_3d<f32>',
});
const Post = group(1, { frame: Frame, scene: 'texture_2d<f32>', depth: 'texture_depth_multisampled_2d' });

describe('group', () => {
  it('numbers bindings in declaration order', () => {
    expect(Scene.wgsl.split('\n').slice(0, 3)).toEqual([
      '@group(0) @binding(0) var<uniform> frame: Frame;',
      '@group(0) @binding(1) var repeat: sampler;',
      '@group(0) @binding(2) var shadowSampler: sampler_comparison;',
    ]);
  });

  it('builds layout entries that match the WGSL types', () => {
    expect(Scene.entries(2)).toEqual([
      { binding: 0, visibility: 2, buffer: { type: 'uniform' } },
      { binding: 1, visibility: 2, sampler: { type: 'filtering' } },
      { binding: 2, visibility: 2, sampler: { type: 'comparison' } },
      { binding: 3, visibility: 2, texture: { sampleType: 'depth', viewDimension: '2d' } },
      { binding: 4, visibility: 2, texture: { sampleType: 'float', viewDimension: '2d' } },
      { binding: 5, visibility: 2, texture: { sampleType: 'float', viewDimension: '3d' } },
    ]);
    expect(Post.entries()[2]).toEqual({
      binding: 2,
      visibility: 3, // vertex and fragment by default
      texture: { sampleType: 'depth', viewDimension: '2d', multisampled: true },
    });
  });

  it('declares a struct shared by two groups once, and an independent parser sees the same bindings', () => {
    const wgsl = declarations(Scene, Post);
    expect(wgsl.match(/struct Frame/g)).toHaveLength(1);
    const parsed = new WgslReflect(wgsl);
    const where = (list: { name: string; group: number; binding: number }[]) =>
      Object.fromEntries(list.map((v) => [`${v.group}:${v.name}`, v.binding]));
    expect(where(parsed.uniforms)).toEqual({ '0:frame': 0, '1:frame': 0 });
    expect(where(parsed.samplers)).toEqual({ '0:repeat': 1, '0:shadowSampler': 2 });
    expect(where(parsed.textures)).toEqual({
      '0:shadowMap': 3,
      '0:water': 4,
      '0:volume': 5,
      '1:scene': 1,
      '1:depth': 2,
    });
  });
});
