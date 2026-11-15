#include "common/fullscreen.wgsl"

// The animated water texture, redrawn every frame; it tiles in both directions.
//   r (and g) = caustic brightness, ba = slope of the water surface
// Caustics on the seabed, the light shafts and the surface seen from below all read it. `clock` comes from the
// Water group.

override WATER_SIZE: f32 = 512.; // the texture's size in texels

// the well-known tiling caustic: a few rounds of feeding a pair of sine waves back into their own phase
fn causticPattern(uv: vec2f, t: f32) -> f32 {
  let p = uv * 6.2831853;
  var i = p; var c = 0.;
  for (var n = 1; n <= 5; n++) {
    let tt = t * (1. - 3.5 / f32(n));
    i = p + vec2f(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    let s = sin(i.x + tt); let k = cos(i.y + tt);
    c += abs(s * k) / (1.25 * sqrt(s * s + k * k) + 1e-4);
  }
  c = 1.17 - pow(c / 5., 1.4);
  return pow(abs(c), 8.);
}

// surface waves: xy = whole-number wave vector (so the sum tiles), z = amplitude
const WAVES = array<vec3f, 10>(vec3f(1., 2., 1.), vec3f(-2., 1., .9), vec3f(3., 1., .6), vec3f(1., -4., .5), vec3f(4., 3., .4),
  vec3f(-3., 5., .32), vec3f(6., -2., .28), vec3f(5., 7., .2), vec3f(-8., 3., .18), vec3f(2., 11., .14));

@fragment
fn drawWater(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let uv = position.xy / WATER_SIZE; let t = clock.time;
  let c = causticPattern(uv, t * .45 + 23.);
  let warped = uv + .02 * vec2f(sin(6.2831853 * (uv.y * 2. + .1 * t)), cos(6.2831853 * (uv.x * 3. - .07 * t)));
  var slope = vec2f(0.);
  for (var i = 0; i < 10; i++) {
    let k = WAVES[i];
    slope += k.xy * k.z * cos(dot(k.xy, warped) * 6.2831853 + t * (.5 + .35 * sqrt(length(k.xy))) * select(-1., 1., (i & 1) == 0) + f32(i) * 1.7);
  }
  return vec4f(c, c, slope * .06);
}
