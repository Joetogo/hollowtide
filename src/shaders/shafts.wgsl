#include "common/fullscreen.wgsl"
#include "common/optics.wgsl"

// Light shafts, at half resolution: for every pixel, a march from the camera to whatever it sees, adding up the
// sunlight scattered towards the eye wherever the sun reaches. Rock and kelp cut the light into shafts (the
// shadow map), and the surface waves break it up further (the water texture, projected down along the sun).
// `frame`, the samplers and textures come from the Shafts group. Alpha carries the view depth, so the blur and
// the composite can keep shafts from bleeding across silhouettes.

override RAY_STEPS: i32 = 34; // 12 on Low

@fragment
fn marchShafts(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let depth = textureLoad(depthTexture, vec2i(position.xy) * 2, 0);
  let uv = position.xy * 2. * frame.invRes;
  let ndc = vec2f(uv.x * 2. - 1., 1. - uv.y * 2.);
  let ray = frame.fwd + frame.right * (ndc.x * frame.tanHalfX) + frame.up * (ndc.y * frame.tanHalfY);
  let rayLength = length(ray); let dir = ray / rayLength;
  let viewDepth = frame.near / max(depth, 1e-6);
  // march to the scene, 120 m at most, and no further than the surface when looking up
  var reach = min(viewDepth * rayLength, 120.);
  if (dir.y > 1e-4) { reach = min(reach, -frame.camPos.y / dir.y); }
  let origin = frame.camPos; let sun = frame.sunDir; let k = downwelling(frame.zoneBlend); let sigma = extinction(frame.zoneBlend);
  let dt = reach / f32(RAY_STEPS);
  let jitter = interleavedGradientNoise(position.xy); // each pixel starts at a different offset; the blur hides it
  var acc = vec3f(0.);
  for (var n = 0; n < RAY_STEPS; n++) {
    let t = (f32(n) + jitter) * dt;
    let p = origin + dir * t;
    let s = frame.shadowMat * vec4f(p, 1.);
    let lit = textureSampleCompareLevel(shadowMap, shadowSampler, vec2f(s.x * .5 + .5, .5 - s.y * .5), s.z - .0006);
    let q = p.xz - sun.xz * (p.y / sun.y); // where this point's sun ray crosses the surface
    let pattern = smoothRamp(.3, .7, textureSampleLevel(waterTexture, repeatSampler, q / 27., 2.5).r) * smoothRamp(.15, .6, textureSampleLevel(waterTexture, repeatSampler, q.yx / 11. + .3, 2.).r);
    let openness = textureSampleLevel(volumeTexture, clampSampler, (p - vec3f(-192., -56., -192.)) / vec3f(384., 60., 384.), 0.).r;
    let mist = clamp01(1. - (openness - .5) * 3.4); // thicker close to rock
    acc += exp(-sigma * t + k * (p.y / sun.y)) * (lit * (.012 + pattern * 6.) * (1. + 1.2 * mist * mist));
  }
  let mu = max(dot(dir, sun), 0.);
  let phase = mix(.2 + 2.0 * mu * mu * mu, .8, frame.zoneBlend); // strongest when looking towards the sun
  let color = mix(WATER_COLOR + vec3f(.04, .07, .05), GROTTO_COLOR + vec3f(.28, .16, .12), frame.zoneBlend);
  return vec4f(min(acc * dt * sigma * color * (SUN_COLOR * MOOD_SUN) * phase * frame.shaftGain * (1. - .55 * frame.zoneBlend), vec3f(20.)), viewDepth);
}
