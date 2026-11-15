#include "math.wgsl"

// Hashes and noise for the one-time bakes (terrain density, rock detail texture). The hashes are sine-free, so
// they give the same pattern on every GPU.

fn hash31(p: vec3f) -> f32 { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn hash33(p: vec3f) -> vec3f { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yxz + 33.33); return fract((q.xxy + q.yxx) * q.zyx); }

// value noise on the integer lattice, smoothly interpolated, in [0, 1]
fn valueNoise(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(mix(hash31(i), hash31(i + vec3f(1., 0., 0.)), u.x), mix(hash31(i + vec3f(0., 1., 0.)), hash31(i + vec3f(1., 1., 0.)), u.x), u.y),
             mix(mix(hash31(i + vec3f(0., 0., 1.)), hash31(i + vec3f(1., 0., 1.)), u.x), mix(hash31(i + vec3f(0., 1., 1.)), hash31(i + vec3f(1., 1., 1.)), u.x), u.y), u.z);
}

// fractal sum of `octaves` layers of value noise, normalised to [0, 1]
fn fbm(p: vec3f, octaves: i32) -> f32 {
  var amplitude = .5; var sum = 0.; var q = p;
  for (var i = 0; i < octaves; i++) { sum += amplitude * valueNoise(q); q = q * 2.03 + vec3f(17.1, 31.7, 5.3); amplitude *= .5; }
  return sum / (1. - 2. * amplitude);
}

// distance to the nearest feature point of a jittered grid (Worley F1)
fn worley(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); var d = 9.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) { for (var z = -1; z <= 1; z++) {
    let o = vec3f(f32(x), f32(y), f32(z)); let r = o + hash33(i + o) - f; d = min(d, dot(r, r));
  } } }
  return sqrt(d);
}
