// Bind groups defined once, in TypeScript.
//
// A group made here yields the WGSL declarations, the bind group layout and a typed way to fill it. Every pass
// that needs the same resources uses the same group, so two shaders can never number them differently.
//
//   const FrameGroup = group(0, { frame: Frame, linear: 'sampler', shadowMap: 'texture_depth_2d' });
//   const layout = FrameGroup.layout(device);
//   const bindGroup = FrameGroup.bind(device, layout, { frame: { buffer }, linear: sampler, shadowMap: view });
//   shaderSource = declarations(FrameGroup) + ...
import type { Struct } from './struct';

export type TextureType = 'texture_2d<f32>' | 'texture_3d<f32>' | 'texture_depth_2d' | 'texture_depth_multisampled_2d';

/** What a binding holds: a uniform struct, a sampler or a texture. */
export type Resource = Struct | 'sampler' | 'sampler_comparison' | TextureType;
export type Resources = Record<string, Resource>;

const TEXTURES: Record<TextureType, GPUTextureBindingLayout> = {
  'texture_2d<f32>': { sampleType: 'float', viewDimension: '2d' },
  'texture_3d<f32>': { sampleType: 'float', viewDimension: '3d' },
  texture_depth_2d: { sampleType: 'depth', viewDimension: '2d' },
  texture_depth_multisampled_2d: { sampleType: 'depth', viewDimension: '2d', multisampled: true },
};

const BOTH_STAGES = 0x1 | 0x2; // GPUShaderStage.VERTEX | FRAGMENT, spelled out so this module also loads off the main thread

export interface Group<R extends Resources = Resources> {
  readonly index: number;
  readonly resources: R;
  /** The `@group @binding var` lines, without the struct declarations (see `declarations`). */
  readonly wgsl: string;
  /** The layout entries, in binding order. */
  entries(visibility?: GPUShaderStageFlags): GPUBindGroupLayoutEntry[];
  layout(device: GPUDevice, visibility?: GPUShaderStageFlags): GPUBindGroupLayout;
  bind(device: GPUDevice, layout: GPUBindGroupLayout, values: { [K in keyof R]: GPUBindingResource }): GPUBindGroup;
}

const isStruct = (r: Resource): r is Struct => typeof r !== 'string';

export function group<const R extends Resources>(index: number, resources: R): Group<R> {
  const names = Object.keys(resources) as (keyof R & string)[];
  const lines = names.map((name, binding) => {
    const r: Resource = resources[name];
    const decl = isStruct(r) ? `var<uniform> ${name}: ${r.name}` : `var ${name}: ${r}`;
    return `@group(${index}) @binding(${binding}) ${decl};`;
  });
  const entries = (visibility: GPUShaderStageFlags = BOTH_STAGES) =>
    names.map((name, binding): GPUBindGroupLayoutEntry => {
      const r: Resource = resources[name];
      if (isStruct(r)) return { binding, visibility, buffer: { type: 'uniform' } };
      if (r === 'sampler') return { binding, visibility, sampler: { type: 'filtering' } };
      if (r === 'sampler_comparison') return { binding, visibility, sampler: { type: 'comparison' } };
      return { binding, visibility, texture: TEXTURES[r] };
    });
  return {
    index,
    resources,
    wgsl: lines.join('\n') + '\n',
    entries,
    layout: (device, visibility) => device.createBindGroupLayout({ entries: entries(visibility) }),
    bind: (device, layout, values) =>
      device.createBindGroup({ layout, entries: names.map((name, binding) => ({ binding, resource: values[name] })) }),
  };
}

/** The WGSL a shader needs in front of it to use these groups: each struct once, then every binding. */
export function declarations(...groups: Group[]): string {
  const structs = new Set<Struct>();
  for (const g of groups) for (const r of Object.values(g.resources)) if (isStruct(r)) structs.add(r);
  return [...structs].map((s) => s.wgsl).join('') + groups.map((g) => g.wgsl).join('');
}
