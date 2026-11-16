#include "math.wgsl"

// How this water absorbs and scatters light. No textures or uniforms: shared by the scene shaders and the light
// shafts.

// How light fades in this water, per metre and per colour channel. Red goes first.
const EXTINCTION = vec3f(.058, .0235, .0195); // along any path
const DOWNWELLING = vec3f(.056, .0245, .0170); // daylight on its way down
const WATER_COLOR = vec3f(.16, .58, .90); // what the water scatters back
// the purple grotto has its own, clearer and bluer water
const DOWNWELLING_GROTTO = vec3f(.034, .023, .018);
const GROTTO_COLOR = vec3f(.58, .66, .98);
const SUN_COLOR = vec3f(1.7, 1.6, 1.45); // sunlight just under the surface
const TAU = 6.2831853;

// The mood (config/mood.ts): the sun's light and the daylight the water scatters, each scaled by a colour, and
// how much living things shine by themselves. These three lines are rewritten when a mood other than noon is
// chosen; as they stand they change nothing.
const MOOD_SUN = vec3f(1., 1., 1.);
const MOOD_SKY = vec3f(1., 1., 1.);
const MOOD_GLOW = 0.;

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
  return mix(WATER_COLOR, GROTTO_COLOR, zone) * extinction(zone) * exp(k * origin.y) * I * (1.22 + .3 * m2 * m2) * MOOD_SKY;
}
