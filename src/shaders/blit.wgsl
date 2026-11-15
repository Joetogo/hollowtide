#include "common/fullscreen.wgsl"

// Mip generation and the bloom chain. `sourceTexture` and `linearSampler` come from the Blit group.

// uv of this fragment in the source: scale 2 when the target is half the source's size, 0.5 when it is twice
fn sourceUv(position: vec4f, scale: f32) -> vec2f { return position.xy * scale / vec2f(textureDimensions(sourceTexture)); }

@fragment
fn mip(@builtin(position) position: vec4f) -> @location(0) vec4f { return textureSampleLevel(sourceTexture, linearSampler, sourceUv(position, 2.), 0.); }

// weights a colour down by its brightest channel, so one very bright pixel cannot take over the average (Karis)
fn karis(c: vec3f) -> vec4f { let w = 1. / (1. + max(c.r, max(c.g, c.b))); return vec4f(c * w, w); }

// first bloom step, scene to half size: four bilinear taps one source texel out, each clamped and Karis-weighted
@fragment
fn bloomDownFirst(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let uv = sourceUv(position, 2.); let texel = 1. / vec2f(textureDimensions(sourceTexture));
  let a = karis(min(textureSampleLevel(sourceTexture, linearSampler, uv + texel * vec2f(-1., -1.), 0.).rgb, vec3f(24.)));
  let b = karis(min(textureSampleLevel(sourceTexture, linearSampler, uv + texel * vec2f(1., -1.), 0.).rgb, vec3f(24.)));
  let c = karis(min(textureSampleLevel(sourceTexture, linearSampler, uv + texel * vec2f(-1., 1.), 0.).rgb, vec3f(24.)));
  let d = karis(min(textureSampleLevel(sourceTexture, linearSampler, uv + texel * vec2f(1., 1.), 0.).rgb, vec3f(24.)));
  let sum = a + b + c + d;
  return vec4f(sum.rgb / sum.a, 1.);
}

// further steps down: a plain four-tap box
@fragment
fn bloomDown(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let uv = sourceUv(position, 2.); let texel = 1. / vec2f(textureDimensions(sourceTexture));
  return (textureSampleLevel(sourceTexture, linearSampler, uv + texel * vec2f(-1., -1.), 0.) + textureSampleLevel(sourceTexture, linearSampler, uv + texel * vec2f(1., -1.), 0.)
        + textureSampleLevel(sourceTexture, linearSampler, uv + texel * vec2f(-1., 1.), 0.) + textureSampleLevel(sourceTexture, linearSampler, uv + texel * vec2f(1., 1.), 0.)) * .25;
}

// steps back up: four taps three quarters of a texel out; the pipeline adds the result onto the level above
@fragment
fn bloomUp(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let uv = sourceUv(position, .5); let texel = .75 / vec2f(textureDimensions(sourceTexture));
  return (textureSampleLevel(sourceTexture, linearSampler, uv + texel * vec2f(-1., -1.), 0.) + textureSampleLevel(sourceTexture, linearSampler, uv + texel * vec2f(1., -1.), 0.)
        + textureSampleLevel(sourceTexture, linearSampler, uv + texel * vec2f(-1., 1.), 0.) + textureSampleLevel(sourceTexture, linearSampler, uv + texel * vec2f(1., 1.), 0.)) * .25;
}
