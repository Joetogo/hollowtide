#include "common/scene.wgsl"

// Jellyfish. Not in the original. A jelly has no mesh: its bell and what trails from it are built in the vertex
// shader from the vertex index and one 32-byte instance, the way the leaves are. They are drawn last, adding
// their light to the picture: a thin shell is brightest where it is seen edge on, and these also glow by
// themselves, so they show in the dark of the grotto where little else is lit.

const AROUND = 28u; // quads round the bell
const RINGS = 9u; // and from its top to its rim
const BELL = 252u; // AROUND * RINGS
const TENTACLES = 8u; // thin ones from the rim
const TRAILS = 12u; // those, and four frilled arms from under the middle
const LINKS = 8u; // quads along each
// vertices per jelly: (BELL + TRAILS * LINKS) * 6 = 2088 (src/render/passes/jellies.ts draws that many)

struct JellyVarying {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  // bell: round it and top to rim, each 0..1; trails: across and root to tip. Taken inside the triangle: a
  // tentacle is thinner than the samples are apart, and a value from outside it would be far out of range
  @location(2) @interpolate(perspective, centroid) uv: vec2f,
  @location(3) @interpolate(flat) tint: vec3f, // its colour, as bright as it is lit and glowing
  @location(4) @interpolate(flat) part: f32, // 0 bell, 1 tentacle, 2 arm
  @location(5) thin: f32, // how much of the ribbon's drawn width the tentacle really fills
}

fn jellyColor(h: f32) -> vec3f {
  if (h < .4) { return vec3f(.12, .8, 1.); }
  if (h < .64) { return vec3f(.5, .38, 1.); }
  if (h < .88) { return vec3f(1., .28, .72); }
  return vec3f(1., .62, .18);
}

// a point of the bell in its own frame (y up its axis): u round it in radians, v from the top (0) to the rim (1)
fn bell(u: f32, v: f32, radius: f32, squeeze: f32) -> vec3f {
  let phi = v * 1.35;
  // squeezing draws the rim in and stretches the dome; the rim is scalloped into eight lobes
  let r = radius * sin(phi) / .9757 * (1. - .3 * squeeze * v * v) * (1. + .07 * cos(u * 8.) * pow(v, 6.));
  let y = radius * .85 * (cos(phi) - .219) * (1. + .2 * squeeze);
  return vec3f(cos(u) * r, y, sin(u) * r);
}

// place: home, and the bell's radius. motion: a seed, how far it drifts from home, colour key, how fast it beats.
@vertex
fn jellyVertex(@builtin(vertex_index) index: u32, @location(0) place: vec4f, @location(1) motion: vec4f) -> JellyVarying {
  var o: JellyVarying;
  let quad = index / 6u; let k = index % 6u;
  // the two triangles of a quad: corners (0,0) (1,0) (0,1), then (0,1) (1,0) (1,1)
  let cx = f32(k == 1u || k == 4u || k == 5u); let cy = f32(k == 2u || k == 3u || k == 5u);
  let t = frame.time; let radius = place.w; let seed = motion.x;
  // the beat: a quick squeeze, a slow opening
  let beat = fract(t * motion.w * .5 + seed);
  let squeeze = smoothRamp(0., .16, beat) * (1. - smoothRamp(.16, .95, beat));
  // where it is: round its home on a slow loop, climbing with each squeeze and sinking back before the next
  let a = t * .06 * (.6 + seed) + seed * 40.;
  let centre = place.xyz + vec3f(sin(a) * motion.y, sin(a * .6 + seed * 9.) * motion.y * .3 + radius * .5 * (smoothRamp(0., .4, beat) - beat), cos(a * 1.3) * motion.y);
  // its axis leans the way it is drifting
  let axis = normalize(vec3f(cos(a) * .3, 1., -sin(a * 1.3) * .3));
  let ax = normalize(cross(axis, vec3f(.2, 0., 1.))); let az = cross(ax, axis);

  o.thin = 1.;
  if (quad < BELL) {
    let u = (f32(quad % AROUND) + cx) / f32(AROUND) * 6.2831853; let v = (f32(quad / AROUND) + cy) / f32(RINGS);
    let local = bell(u, v, radius, squeeze);
    // the normal from two neighbours on the surface (at the very top there is no "round it": straight up)
    let along = bell(u, v + .02, radius, squeeze) - local; let round = vec3f(-sin(u), 0., cos(u));
    let normal = select(normalize(cross(along, round)), vec3f(0., 1., 0.), v < .01);
    o.uv = vec2f(u / 6.2831853, v); o.part = 0.;
    o.world = centre + ax * local.x + axis * local.y + az * local.z;
    o.normal = ax * normal.x + axis * normal.y + az * normal.z;
  } else {
    let r = quad - BELL; let trail = r / LINKS; let s = (f32(r % LINKS) + cy) / f32(LINKS); let side = cx * 2. - 1.;
    let fine = trail < TENTACLES; let n = f32(trail);
    // tentacles hang from the rim, arms from under the middle of the bell
    let u = select((n - 8.) * 1.5708 + .6, (n + .5) * .7854, fine);
    let root = select(vec3f(cos(u) * radius * .16, radius * .05, sin(u) * radius * .16), bell(u, 1., radius, squeeze), fine);
    let reach = radius * select(2.4, 3.2 + 2.4 * fract(seed * 7. + n * .37), fine);
    // each trails below, lagging the beat, waving more towards its tip
    let phase = t * 1.5 * motion.w - s * 5. + n * 1.7 + seed * 30.;
    let wave = (vec3f(cos(u), 0., sin(u)) * sin(phase) + vec3f(-sin(u), 0., cos(u)) * cos(phase * .7)) * radius * select(.35, .5, fine) * s * s;
    let local = root + vec3f(0., -reach * s * (1. - .25 * squeeze), 0.) + wave + vec3f(cos(u), 0., sin(u)) * radius * .25 * squeeze * s;
    let spine = centre + ax * local.x + axis * local.y + az * local.z;
    // a ribbon turned to face the camera; the arms are wide and frilled, the tentacles hair-thin
    var width = radius * select(.15 * (1. - .8 * s) * (1. + .4 * sin(s * 17. + t * 2. + n)), .014 * (1. - .6 * s), fine);
    // never drawn thinner than a pixel, but dimmer instead: a line that comes and goes between samples flickers
    let pixel = 2. * frame.tanHalfY * frame.invRes.y * max(dot(spine - frame.camPos, frame.fwd), 0.);
    o.thin = min(1., width / max(pixel * .6, 1e-6));
    width = max(width, pixel * .6);
    let across = normalize(cross(frame.camPos - spine, axis));
    o.world = spine + across * side * width;
    o.normal = normalize(frame.camPos - spine);
    o.uv = vec2f(cx, s); o.part = select(2., 1., fine);
  }
  o.clip = frame.viewProj * vec4f(o.world, 1.);
  // lit as a whole, from where its middle is: sunlight makes it shine where it reaches it; its own light is
  // there regardless, stronger on the squeeze
  let lit = sunlight(centre.y, zoneAt(centre)).g * shadow1(centre);
  o.tint = jellyColor(motion.z) * (.3 + 1.1 * lit + .45 * (.6 + .8 * squeeze));
  // too far to be seen through this water: not drawn
  if (distance(centre, frame.camPos) > 110.) { o.clip = vec4f(0.); }
  return o;
}

@fragment
fn jellyFragment(v: JellyVarying) -> @location(0) vec4f {
  let toCamera = frame.camPos - v.world; let d = length(toCamera);
  var glow = 0.;
  if (v.part < .5) {
    // the bell: bright at its silhouette, sixteen canals running from top to rim, a lit band round the rim,
    // a soft knot of light at the top, and four rings round it
    let edge = pow(clamp(1. - abs(dot(normalize(v.normal), toCamera / d)), 0., 1.), 2.2);
    let canals = .55 + .45 * pow(abs(cos(v.uv.x * 50.265)), 8.);
    let q = vec2f((fract(v.uv.x * 4.) - .5) * 1.61 * sin(v.uv.y * 1.35), (v.uv.y - .3) * 1.2);
    let off = (length(q) - .15) * 24.; let rings = exp(-off * off);
    glow = (.04 + 1.15 * edge) * canals + .55 * smoothRamp(.84, 1., v.uv.y) + .3 * smoothRamp(.32, 0., v.uv.y) + .42 * rings;
  } else {
    // trails: brightest down the middle, fading towards the tip; the arms are ruffled
    let middle = max(0., 1. - abs(v.uv.x * 2. - 1.));
    let fold = sin(v.uv.y * 21. + sin(v.uv.x * 6.2831853 + v.uv.y * 9.) * 1.3); let ruffle = .4 + .6 * fold * fold;
    glow = middle * (1. - v.uv.y * .85) * select(.7 * v.thin, .55 * ruffle, v.part > 1.5);
  }
  // faded by the water in between, and right at the camera, where a bell would fill the screen
  let c = v.tint * glow * exp(-EXTINCTION * d) * smoothRamp(.25, 1.1, d);
  return vec4f(min(c, vec3f(8.)), 0.);
}
