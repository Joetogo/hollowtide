// Small helpers shared by the scene and post shaders.

fn clamp01(x: f32) -> f32 { return clamp(x, 0., 1.); }

// smoothstep that also takes its edges in descending order (b < a), which the built-in does not promise
fn smoothRamp(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }

// interleaved gradient noise: a screen-space dither pattern in [0, 1) with no visible structure
fn interleavedGradientNoise(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(.06711056, .00583715)))); }

fn sineHash(x: f32) -> f32 { return fract(sin(x * 127.1) * 43758.5453); }
