#include "common/scene.wgsl"

// The water surface seen from below, and the backdrop behind everything.

struct SurfaceVarying { @builtin(position) clip: vec4f, @location(0) world: vec3f }

// a 1800 m square at y = 0 that follows the camera
@vertex
fn surfaceVertex(@builtin(vertex_index) index: u32) -> SurfaceVarying {
  var o: SurfaceVarying;
  let p = vec2f(f32(index & 1u), f32(index >> 1u)) * 2. - 1.;
  o.world = vec3f(frame.camPos.x + p.x * 900., 0., frame.camPos.z + p.y * 900.);
  o.clip = frame.viewProj * vec4f(o.world, 1.);
  return o;
}

@fragment
fn surfaceFragment(v: SurfaceVarying) -> @location(0) vec4f {
  let toSurface = v.world - frame.camPos; let d = length(toSurface); let V = toSurface / d;
  // the surface's slope from three scales of the water texture, flattening out with distance
  let flatten = smoothRamp(260., 60., d);
  let s = (textureSample(waterTexture, repeatSampler, v.world.xz / 13.).ba + textureSample(waterTexture, repeatSampler, v.world.zx / 4.7 + .2).ba * .7 + textureSample(waterTexture, repeatSampler, v.world.xz / 37. + .6).ba * .8) * flatten;
  let n = normalize(vec3f(-s.x * .8, -1., -s.y * .8));
  // Snell's window: looking up steeply enough you see the sky, refracted; beyond the critical angle the surface
  // is a mirror. 1.769 is the refractive index of water (1.33) squared.
  let cosIncidence = clamp01(dot(V, -n));
  let k = 1. - 1.769 * (1. - cosIncidence * cosIncidence);
  let window = smoothRamp(0., .22, k);
  let refracted = refract(V, n, 1.33);
  let towardsSun = max(dot(refracted, frame.sunDir), 0.);
  let fresnel = pow(1. - sqrt(max(k, 0.)), 5.);
  let sky = (vec3f(.30, .78, 1.) * 1.3 * clamp(1. + 3.8 * (s.x * .6 - s.y * .8), .25, 3.) + vec3f(1., .95, .85) * (pow(towardsSun, 60.) * 1.3 + pow(towardsSun, 500.) * 12.)) * (1. - fresnel);
  let zone = zoneAt(v.world);
  let R = reflect(V, n);
  let mirrored = inScatter(v.world, R, 300., zone, frame.sunDir) * 1.15; // the water itself, seen in the mirror
  let c = mix(mirrored, sky, window);
  return hdrOutput(applyFog(c, v.world, zone));
}

// Behind everything: where no terrain is drawn (it stops at about 240 m) the water looks as it does at that
// distance. A full-screen quad at the far end of the depth range.
@vertex
fn backdropVertex(@builtin(vertex_index) index: u32) -> SurfaceVarying {
  var o: SurfaceVarying;
  let p = vec2f(f32(index & 1u), f32(index >> 1u)) * 2. - 1.;
  o.world = frame.camPos + frame.fwd + frame.right * (p.x * frame.tanHalfX) + frame.up * (p.y * frame.tanHalfY);
  o.clip = vec4f(p, 1e-7, 1.);
  return o;
}

@fragment
fn backdropFragment(v: SurfaceVarying) -> @location(0) vec4f {
  let p = frame.camPos + normalize(v.world - frame.camPos) * 240.;
  return hdrOutput(applyFog(vec3f(0.), p, zoneAt(p)));
}
