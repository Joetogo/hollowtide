#include "common/fullscreen.wgsl"

// Scaffold self-test: a vertical gradient between two colours of a generated uniform struct. If the struct
// layout made in TypeScript disagreed with what WGSL expects, the colours on screen would be wrong.
// `selfTest` is declared by src/gpu/bindings.ts and prepended when the module is created.
@fragment
fn fragment(in: FullscreenOutput) -> @location(0) vec4f {
  return vec4f(mix(selfTest.shallow, selfTest.deep, in.uv.y) * selfTest.gain, 1.0);
}
