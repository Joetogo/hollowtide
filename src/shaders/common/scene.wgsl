#include "math.wgsl"

// Shared by every shader that draws into the scene: how water absorbs and scatters light, sun shadows, caustics,
// ambient light and fog. `frame`, the textures and the samplers come from the Scene group.

// detail-level switches, set as pipeline constants
override LOW: bool = false; // Low detail: one shadow tap instead of nine
override SHADOW_SIZE: f32 = 4096.; // shadow map size in texels

// How light fades in this water, per metre and per colour channel. Red goes first.
const EXTINCTION = vec3f(.058, .0235, .0195); // along any path
const DOWNWELLING = vec3f(.056, .0245, .0170); // daylight on its way down
const WATER_COLOR = vec3f(.16, .58, .90); // what the water scatters back
// the purple grotto has its own, clearer and bluer water
const DOWNWELLING_GROTTO = vec3f(.034, .023, .018);
const GROTTO_COLOR = vec3f(.58, .66, .98);
const SUN_COLOR = vec3f(1.7, 1.6, 1.45); // sunlight just under the surface
const TAU = 6.2831853;

// `zone` runs from 0 in open water to 1 inside the grotto
fn downwelling(zone: f32) -> vec3f { return mix(DOWNWELLING, DOWNWELLING_GROTTO, zone); }
fn extinction(zone: f32) -> vec3f { return mix(EXTINCTION, vec3f(.034, .026, .022), zone); }

// what a fragment shader returns: HDR colour kept inside what the half-float target and the bloom can take
fn hdrOutput(c: vec3f) -> vec4f { return vec4f(min(max(c, vec3f(0.)), vec3f(40.)), 1.); }

const FOG_DOWNWELLING_GROTTO = vec3f(.043, .045, .042);
// Light scattered into the line of sight over `dist` metres from `origin` along `dir`: the single-scattering
// integral in closed form, for daylight that fades with depth. Brighter when looking towards the sun.
fn inScatter(origin: vec3f, dir: vec3f, dist: f32, zone: f32, sun: vec3f) -> vec3f {
  let k = mix(DOWNWELLING, FOG_DOWNWELLING_GROTTO, zone);
  let a = extinction(zone) - k * dir.y;
  let I = (1. - exp(-a * dist)) / a;
  let mu = max(dot(dir, sun), 0.);
  let m2 = mu * mu;
  return mix(WATER_COLOR, GROTTO_COLOR, zone) * extinction(zone) * exp(k * origin.y) * I * (1.22 + .3 * m2 * m2);
}

// ---- sun shadows: one baked orthographic map
// xy = texture coordinate, z = depth to compare against (with a small constant bias)
fn shadowCoord(p: vec3f) -> vec3f { let s = frame.shadowMat * vec4f(p, 1.); return vec3f(s.x * .5 + .5, .5 - s.y * .5, s.z - .0007); }
fn shadow1(p: vec3f) -> f32 { let s = shadowCoord(p); return textureSampleCompareLevel(shadowMap, shadowSampler, s.xy, s.z); }
fn shadow4(p: vec3f) -> f32 {
  let s = shadowCoord(p); let e = 1.8 / SHADOW_SIZE;
  return (textureSampleCompareLevel(shadowMap, shadowSampler, s.xy + vec2f(-e, -e), s.z) + textureSampleCompareLevel(shadowMap, shadowSampler, s.xy + vec2f(e, -e), s.z)
        + textureSampleCompareLevel(shadowMap, shadowSampler, s.xy + vec2f(-e, e), s.z) + textureSampleCompareLevel(shadowMap, shadowSampler, s.xy + vec2f(e, e), s.z)) * .25;
}
fn shadow9(p: vec3f) -> f32 {
  if (LOW) { return shadow1(p); }
  let s = shadowCoord(p); let e = 2.1 / SHADOW_SIZE; var a = 0.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) { a += textureSampleCompareLevel(shadowMap, shadowSampler, s.xy + vec2f(f32(x), f32(y)) * e, s.z); } }
  return a / 9.;
}

// ---- caustics: the water texture projected down along the sun direction
// where the sun ray through `p` crosses the surface plane y = 0
fn causticUv(p: vec3f) -> vec2f { return p.xz - frame.sunDir.xz * (p.y / frame.sunDir.y); }
// three taps slightly apart give each colour channel its own pattern (dispersion); fades to a flat value far away
fn caustics(p: vec3f, viewDistance: f32) -> vec3f {
  let q = causticUv(p);
  let o = vec2f(.004, .0025);
  let a = vec3f(textureSample(waterTexture, repeatSampler, q / 3.3 + o).r, textureSample(waterTexture, repeatSampler, q / 3.3).r, textureSample(waterTexture, repeatSampler, q / 3.3 - o).r);
  let b = textureSample(waterTexture, repeatSampler, q.yx / 6.9 + .37).r;
  let c = min(pow(a, vec3f(2.3)) * 5. * (.45 + b * 1.3), vec3f(4.));
  return mix(c, vec3f(.33), smoothRamp(35., 100., viewDistance));
}
// a cheaper single-channel version for leaves
fn causticsMono(p: vec3f, viewDistance: f32) -> f32 {
  let q = causticUv(p);
  let c = min(pow(textureSample(waterTexture, repeatSampler, q / 4.1).r, 1.4) * 2.6 * (.45 + textureSample(waterTexture, repeatSampler, q.yx / 6.9 + .37).r * 1.3), 2.6);
  return mix(c, .33, smoothRamp(35., 100., viewDistance));
}

// ---- light
// sunlight reaching height y: faded along its slanted path down
fn sunlight(y: f32, zone: f32) -> vec3f { return SUN_COLOR * exp(downwelling(zone) * (min(y, 0.) / frame.sunDir.y)) * (.5 + .5 * clamp01(-y / 30.)); }
// the baked volume around `p`: r = openness (0.5 at a rock surface, more in open water), g = skylight from above
fn volume(p: vec3f) -> vec4f { return textureSampleLevel(volumeTexture, clampSampler, (p - vec3f(-192., -56., -192.)) / vec3f(384., 60., 384.), 0.); }
// light from the water all around, strongest from above, dimmed where the sky is blocked
fn ambient(p: vec3f, n: vec3f, sky: f32, zone: f32) -> vec3f {
  let up = n.y * .5 + .5;
  return mix(vec3f(.22, .60, .80), vec3f(.34, .56, .82), zone) * exp(downwelling(zone) * min(p.y, 0.) * 1.2) * (.3 + .7 * sky) * (.24 + .76 * up * up) * 1.3 * (.55 + .45 * clamp01(-p.y / 30.)) + vec3f(.003, .010, .016);
}
// how much a point belongs to the grotto: the camera's zone, nudged by the ground map
fn zoneAt(p: vec3f) -> f32 { return mix(frame.zoneBlend, textureSampleLevel(groundMap, clampSampler, p.xz / 384. + .5, 0.).b, .2); }
// glow of open water seen sideways, on surfaces that face it
fn sideGlow(p: vec3f, n: vec3f, open: f32, zone: f32) -> vec3f { return mix(WATER_COLOR, GROTTO_COLOR, zone) * exp(downwelling(zone) * min(p.y, 0.)) * open * (1. - abs(n.y)) * .7; }

// A lit colour as seen from the camera: faded by the water in between, plus the light scattered into the view.
// Skylight is taken at most 150 m along the ray: past that, terrain and the backdrop behind it get the same haze.
fn applyFog(c: vec3f, world: vec3f, zone: f32) -> vec3f {
  let v = world - frame.camPos; let d = length(v); let dir = v / d;
  return c * exp(-extinction(zone) * d) * smoothRamp(230., 185., d) + inScatter(frame.camPos, dir, d, zone, frame.sunDir) * (.58 + .42 * volume(frame.camPos + dir * min(d, 150.)).g);
}

// rotates v by the unit quaternion q
fn rotate(q: vec4f, v: vec3f) -> vec3f { return v + 2. * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
