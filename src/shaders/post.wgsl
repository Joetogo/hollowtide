#include "common/fullscreen.wgsl"
#include "common/math.wgsl"

// The final composite: light shafts and bloom are added to the scene, then exposure, vignette, tone mapping, a
// contrast curve, a slight desaturation, gamma and dither. `frame`, `linearSampler`, `sceneTexture`,
// `shaftsTexture`, `bloomTexture` and `depthTexture` come from the Post group.

fn clamp01v(x: vec3f) -> vec3f { return clamp(x, vec3f(0.), vec3f(1.)); }

// ACES filmic curve, Narkowicz's fit
fn tonemap(x: vec3f) -> vec3f { return clamp01v((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14)); }

@fragment
fn composite(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let pixel = vec2i(position.xy);
  let uv = position.xy * frame.invRes;
  let viewDepth = frame.near / max(textureLoad(depthTexture, pixel, 0), 1e-6);
  // The shafts are half resolution. Each of the four nearest texels is weighted by its bilinear weight and by how
  // close its depth (stored in alpha) is to this pixel's, so shafts do not bleed across silhouettes.
  let h = position.xy * .5 - .5; let base = floor(h); let f = h - base; let corner = vec2i(base);
  let last = vec2i(textureDimensions(shaftsTexture)) - 1;
  var shafts = vec3f(0.); var weightSum = 0.;
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1);
    let texel = textureLoad(shaftsTexture, clamp(corner + o, vec2i(0), last), 0);
    let bilinear = mix(1. - f.x, f.x, f32(o.x)) * mix(1. - f.y, f.y, f32(o.y));
    let weight = (bilinear + .02) / (.02 + abs(texel.a - viewDepth) / viewDepth);
    shafts += texel.rgb * weight; weightSum += weight;
  }
  var c = textureLoad(sceneTexture, pixel, 0).rgb + shafts / weightSum;
  let bloom = textureSampleLevel(bloomTexture, linearSampler, uv, 0.).rgb;
  c = mix(c, bloom, .06) + bloom * .03;
  c *= frame.exposure;
  let q = uv - .5;
  c *= 1. - dot(q, q) * .55; // vignette
  c = tonemap(c);
  // S-curve on luminance, keeping hue
  let luma = dot(c, vec3f(.2126, .7152, .0722));
  let curved = mix(luma, luma * luma * (3. - 2. * luma), .55);
  c *= curved / max(luma, 1e-4);
  c = mix(c, vec3f(curved), smoothRamp(.55, 1., curved) * .1); // highlights lose a little colour
  c = mix(vec3f(curved), c, .93) + vec3f(.008, .002, 0.); // overall desaturation and a warm lift
  c = pow(max(c, vec3f(0.)), vec3f(1. / 2.2));
  let dither = interleavedGradientNoise(position.xy) + interleavedGradientNoise(position.xy + 37.) - 1.;
  return vec4f(c + dither / 255., 1.);
}
