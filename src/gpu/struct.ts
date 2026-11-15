// WGSL structs defined once, in TypeScript.
//
// A struct made here yields both its WGSL declaration and the offset of every field, so the shader and the code
// that fills the buffer cannot drift apart:
//
//   const Frame = struct('Frame', { viewProj: 'mat4x4f', camPos: 'vec3f', time: 'f32' });
//   data[Frame.at.time] = seconds;        // instead of data[19]
//   shaderSource = Frame.wgsl + ...       // struct Frame { viewProj: mat4x4f, camPos: vec3f, time: f32, }

/** Alignment and size in bytes, from the WGSL spec's "Alignment and Size" table. */
const TYPES = {
  f32: { align: 4, size: 4 },
  u32: { align: 4, size: 4 },
  i32: { align: 4, size: 4 },
  vec2f: { align: 8, size: 8 },
  vec3f: { align: 16, size: 12 }, // a following f32 packs into the last four bytes
  vec4f: { align: 16, size: 16 },
  mat4x4f: { align: 16, size: 64 },
} as const;

export type FieldType = keyof typeof TYPES;
export type Fields = Record<string, FieldType>;

export interface Struct<F extends Fields = Fields> {
  readonly name: string;
  readonly fields: F;
  /** Byte offset of each field. */
  readonly offset: Readonly<Record<keyof F, number>>;
  /** Index of each field's first element in a Float32Array or Uint32Array laid over the struct. */
  readonly at: Readonly<Record<keyof F, number>>;
  /** Size in bytes, rounded up to the struct's alignment: the size of a buffer that holds it. */
  readonly size: number;
  /** The WGSL declaration. */
  readonly wgsl: string;
}

const roundUp = (value: number, multiple: number) => Math.ceil(value / multiple) * multiple;

export function struct<const F extends Fields>(name: string, fields: F): Struct<F> {
  const offset: Record<string, number> = {};
  const at: Record<string, number> = {};
  const lines: string[] = [];
  let end = 0;
  let align = 1;
  for (const [key, type] of Object.entries(fields)) {
    const layout = TYPES[type];
    if (!layout) throw new Error(`struct ${name}: field ${key} has unsupported type ${String(type)}`);
    const start = roundUp(end, layout.align);
    offset[key] = start;
    at[key] = start / 4;
    end = start + layout.size;
    align = Math.max(align, layout.align);
    lines.push(`  ${key}: ${type},`);
  }
  return {
    name,
    fields,
    offset: offset as Record<keyof F, number>,
    at: at as Record<keyof F, number>,
    size: roundUp(end, align),
    wgsl: `struct ${name} {\n${lines.join('\n')}\n}\n`,
  };
}
