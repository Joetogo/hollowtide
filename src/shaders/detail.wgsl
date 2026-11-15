#include "common/fullscreen.wgsl"
#include "common/noise.wgsl"

// Bakes the rock detail texture once at start-up: 1024 x 1024, tileable.
//   rg = surface slope (packed to 0..1), b = height, a = mottling
// The rock shader samples it three ways (triplanar) at several scales for bumps and colour variation.

// noise that repeats every `period` cells, so the texture tiles
fn periodicHash(p: vec2f, period: f32) -> f32 { return hash31(vec3f(p - period * floor(p / period), period)); }
fn tileNoise(p: vec2f, period: f32) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(periodicHash(i, period), periodicHash(i + vec2f(1., 0.), period), u.x), mix(periodicHash(i + vec2f(0., 1.), period), periodicHash(i + vec2f(1., 1.), period), u.x), u.y);
}
fn tileFbm(uv: vec2f, period: f32, octaves: i32) -> f32 { var amplitude = .5; var sum = 0.; var pr = period; for (var i = 0; i < octaves; i++) { sum += amplitude * tileNoise(uv * pr + f32(i) * 7.3, pr); pr *= 2.; amplitude *= .5; } return sum / (1. - 2. * amplitude); }
// tiling Worley: xy = distance to the nearest and second-nearest point, z = a random id of the nearest cell
fn tileWorley(p: vec2f, period: f32) -> vec3f {
  let i = floor(p); let f = fract(p); var d = vec2f(9.); var id = 0.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) {
    let o = vec2f(f32(x), f32(y)); let c = i + o; let wrapped = c - period * floor(c / period);
    let h = hash33(vec3f(wrapped, period)); let r = o + h.xy - f; let l = dot(r, r);
    if (l < d.x) { d.y = d.x; d.x = l; id = h.z; } else if (l < d.y) { d.y = l; }
  } }
  return vec3f(sqrt(d), id);
}

// the rock's height field: broad lumps, ridges, cracks and scattered pits
fn rockHeight(uv: vec2f) -> f32 {
  let warped = uv + .11 * (vec2f(tileFbm(uv, 3., 4), tileFbm(uv + .5, 3., 4)) - .5);
  let lumps = tileFbm(warped, 3., 8);
  let ridges = 1. - abs(tileFbm(warped + 1.7, 5., 6) * 2. - 1.);
  let cracks = min(abs(tileFbm(warped + 4.1, 4., 5) * 2. - 1.) * 7., 1.);
  let cracks2 = min(abs(tileFbm(warped.yx + 2.3, 9., 4) * 2. - 1.) * 9., 1.);
  let cell = tileWorley(warped * 29., 29.);
  let pit = (1. - smoothRamp(.0, .34, cell.x)) * step(.62, cell.z);
  return lumps * .50 + ridges * ridges * .24 + cracks * cracks2 * .26 - pit * .07;
}

@fragment
fn bakeDetail(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let uv = position.xy / 1024.; let e = 1. / 1024.;
  let h = rockHeight(uv);
  let gx = rockHeight(uv + vec2f(e, 0.)) - rockHeight(uv - vec2f(e, 0.)); let gy = rockHeight(uv + vec2f(0., e)) - rockHeight(uv - vec2f(0., e));
  let slope = clamp(vec2f(gx, gy) * 1024. * .5 * .075, vec2f(-1.), vec2f(1.));
  return vec4f(-slope * .5 + .5, h, tileFbm(uv + 3.7, 3., 5));
}
