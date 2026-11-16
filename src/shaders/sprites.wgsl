#include "common/scene.wgsl"

// Camera-facing quads: rising bubbles (alpha-blended) and drifting particles, the "marine snow" (additive).

struct SpriteVarying {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f, // -1..1 across the quad
  @location(1) @interpolate(flat) data: vec4f,
  @location(2) world: vec3f, // the sprite's centre
}
fn corner(index: u32) -> vec2f { return vec2f(f32(index & 1u), f32(index >> 1u)) * 2. - 1.; }

// The swimmer's own bubbles (body/breath.ts) are drawn with this set: they are there at once where they are let
// go, and are not faded out near the camera, which is where they are.
override OWN: bool = false;

// vent: where the bubble starts, its size. rise: phase, speed, height of the column, wobble.
@vertex
fn bubbleVertex(@builtin(vertex_index) index: u32, @location(0) vent: vec4f, @location(1) rise: vec4f) -> SpriteVarying {
  var o: SpriteVarying; let q = corner(index); let t = frame.time;
  // each bubble loops: it rises the height of its column, then starts again at the vent
  let life = fract(t * rise.y / rise.z + rise.x);
  let h = life * rise.z;
  var p = vent.xyz + vec3f(0., h, 0.);
  let wobble = rise.w * (.3 + h * .035);
  p.x += sin(t * 1.7 + rise.x * 50. + h * .6) * wobble + sin(h * .13 + rise.x * 9.) * rise.w * 2.;
  p.z += cos(t * 1.3 + rise.x * 33. + h * .5) * wobble + cos(h * .11 + rise.x * 7.) * rise.w * 2.;
  // grows as it rises, pops in at the vent and shrinks away just under the surface
  let size = vent.w * (.55 + .7 * life) * smoothRamp(0., select(.03, .0012, OWN), life) * smoothRamp(0., -1.2, p.y);
  let world = p + (frame.right * q.x + frame.up * q.y) * size;
  o.clip = frame.viewProj * vec4f(world, 1.); o.uv = q; o.world = p;
  o.data = vec4f(rise.x, size, shadow1(p), 0.);
  return o;
}

@fragment
fn bubbleFragment(v: SpriteVarying) -> @location(0) vec4f {
  let t = frame.time;
  // larger bubbles have a slightly wobbling outline
  let angle = atan2(v.uv.y, v.uv.x + 1e-4);
  let large = smoothRamp(.04, .22, v.data.y);
  let r = length(v.uv) / (.9 + large * .05 * sin(angle * 3. + t * 5. + v.data.x * 40.) + large * .02 * sin(angle * 5. - t * 7.));
  let edge = fwidth(r) * 1.5;
  let disc = 1. - smoothRamp(1. - edge, 1., r);
  let rim = smoothRamp(.55, .98, r);
  let highlight = smoothRamp(.34, .0, length(v.uv - vec2f(-.36, .42))) + .5 * smoothRamp(.2, .0, length(v.uv - vec2f(.4, -.42)));
  let zone = zoneAt(v.world);
  let sun = sunlight(v.world.y, zone) * (.25 + .75 * v.data.z);
  // a bubble mostly shows the water around it: bright from above, dark from below
  let above = inScatter(v.world, vec3f(0., 1., 0.), 80., zone, frame.sunDir) * 1.5;
  let below = inScatter(v.world, vec3f(0., -1., 0.), 80., zone, frame.sunDir);
  var c = mix(below, above, smoothRamp(-.5, .8, v.uv.y + rim * .4)) * (.5 + 1.2 * rim) + sun * highlight * 1.6;
  var alpha = disc * clamp01(.03 + rim * rim * rim * .9 + highlight);
  // fog, and a fade right at the camera
  let toBubble = v.world - frame.camPos; let d = length(toBubble);
  let visible = exp(-EXTINCTION.g * d) * select(smoothRamp(1.2, 3., d), smoothRamp(.1, .16, d), OWN);
  c = c * visible + inScatter(frame.camPos, toBubble / d, d, zone, frame.sunDir) * (1. - visible);
  alpha *= mix(.35, 1., visible);
  return vec4f(min(max(c * alpha, vec3f(0.)), vec3f(20.)), alpha);
}

// seed: a random point in a unit cube, and a random size in w
@vertex
fn snowVertex(@builtin(vertex_index) index: u32, @location(0) seed: vec4f) -> SpriteVarying {
  var o: SpriteVarying; let q = corner(index); let t = frame.time;
  // the particles fill a 44 m box that wraps around the camera, so there are always some nearby
  let box = 44.;
  var p = seed.xyz * box + vec3f(t * .22, t * .05, t * .13) + .5 * vec3f(sin(t * .3 + seed.x * 60.), sin(t * .23 + seed.y * 50.), cos(t * .27 + seed.z * 70.));
  p = frame.camPos + (fract((p - frame.camPos) / box + .5) - .5) * box;
  let d = length(p - frame.camPos);
  let size = (.012 + .045 * seed.w * seed.w * seed.w);
  // never smaller than about a pixel on screen; dimmed instead
  let world = p + (frame.right * q.x + frame.up * q.y) * max(size, d * .0011);
  o.clip = frame.viewProj * vec4f(world, 1.); o.uv = q; o.world = p;
  let fade = smoothRamp(box * .5, box * .32, d) * smoothRamp(.6, 2.5, d) * min(1., size / (d * .0011)) * smoothRamp(-.3, -1.5, p.y);
  let twinkle = .6 + .4 * sin(t * (1. + seed.w * 2.) + seed.x * 100.);
  o.data = vec4f(fade * twinkle, shadow1(p), seed.w, d);
  return o;
}

@fragment
fn snowFragment(v: SpriteVarying) -> @location(0) vec4f {
  let r = length(v.uv);
  let m = smoothRamp(1., .2, r);
  let zone = zoneAt(v.world);
  // (and whatever drifts through the lamp's beam shows it up)
  let c = (sunlight(v.world.y, zone) * v.data.y * .8 + ambient(v.world, vec3f(0., 1., 0.), 1., zone) * .3 + lampGlow(v.world) * 1.6) * mix(vec3f(1.), vec3f(.7, 1., .9), v.data.z);
  return vec4f(min(max(c * m * m * v.data.x * exp(-EXTINCTION.g * v.data.w), vec3f(0.)), vec3f(8.)), 0.);
}
