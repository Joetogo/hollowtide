#include "common/scene.wgsl"

// Leaves: kelp blades and stems, grasses and ground cover. A leaf has no mesh: it is a triangle strip of ROWS
// pairs of vertices built in the vertex shader from one 36-byte instance, bent along a circular arc.

override ROWS: f32 = 7.; // vertex pairs along the blade: 9 up close, 5 mid-range, 3 far away and in the shadow bake
override FAR: f32 = 150.; // distance at which the blade has faded out, in metres
override SMOOTH_BEND: bool = false; // see where the blade's arc is worked out

struct LeafInstance {
  @location(0) base: vec4f, // root position, length
  @location(1) shape: vec4f, // yaw, tilt from vertical, width, height above the plant's root (drives sway)
  @location(2) kind: vec4f, // leaf type (as n / 255), two random seeds, bend
}
struct LeafVarying {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f, // x across the blade (-1..1), y along it (0..1)
  @location(3) @interpolate(flat) color: vec3f,
  @location(4) @interpolate(flat) look: vec4f, // x sparkles (0 or 1), y translucency, z iridescence, w glow
  @location(5) @interpolate(flat) seeds: vec2f,
  @location(6) @interpolate(flat) sparkle: vec3f, // sparkle colour
}

// the current: everything rooted near `p` leans the same way, more the higher up it is
fn sway(p: vec2f, h: f32, t: f32) -> vec2f {
  let ph = dot(p, vec2f(.031, .017));
  let a = .024 * pow(max(h, 0.), 1.25);
  return a * (vec2f(sin(t * .5 + ph + h * .09), cos(t * .37 + ph * 1.3 + h * .07)) + .35 * vec2f(sin(t * 1.3 + ph * 3. + h * .3), cos(t * 1.1 + ph * 2. + h * .23)));
}
fn bulge(v: f32) -> f32 { return sin(3.14159 * clamp01(v)); }
// sparkle colours: gold, green, cyan, pink
fn sparklePalette(h: f32) -> vec3f {
  if (h < .3) { return vec3f(1., .62, .08); }
  if (h < .6) { return vec3f(.12, 1., .22); }
  if (h < .8) { return vec3f(.2, .85, 1.); }
  return vec3f(1., .3, .8);
}

// also the vertex shader of the shadow bake, where frame.res.x is 0
@vertex
fn leafVertex(@builtin(vertex_index) index: u32, leaf: LeafInstance) -> LeafVarying {
  var o: LeafVarying;
  // u: which edge (-1 or 1); v: how far along the blade, rows bunched towards the tip
  let u = f32(index & 1u) * 2. - 1.; let v = sin(f32(index >> 1u) / (ROWS - 1.) * 1.5708);
  let kind = i32(leaf.kind.x * 255. + .5); let s1 = leaf.kind.y; let s2 = leaf.kind.z;
  let t = frame.time;
  let len = leaf.base.w; let rootHeight = leaf.shape.w;
  let cy = cos(leaf.shape.x); let sy = sin(leaf.shape.x); let ct = cos(leaf.shape.y); let st = sin(leaf.shape.y);
  // the blade's frame: along it, the direction it bends towards, and across it
  let along = vec3f(st * cy, ct, st * sy); let bendDir = vec3f(ct * cy, -st, ct * sy); let across = vec3f(-sy, 0., cy);
  // per type. look: x chance to sparkle, y translucency, z iridescence, w glow. profile: where the blade is widest, how blunt. wave: travelling ripple. flutter: how lively the bend is.
  var color = vec3f(0.); var look = vec4f(0.); var sparkle = vec3f(0.); var profile = vec2f(.75, .7); var wave = 1.; var flutter = 1.;
  let pick = sineHash(s1 * 13.7 + s2 * 71.3);
  switch kind {
    // 0 olive kelp blade
    case 0 { color = mix(vec3f(.11, .125, .022), vec3f(.04, .10, .04), s1); color = mix(color, vec3f(.25, .17, .025), step(.72, s2)); look = vec4f(.24, .9, 0., 0.); sparkle = sparklePalette(pick * .72); profile = vec2f(.5, .32); wave = 1.9; }
    // 1 kelp stem
    case 1 { color = vec3f(.10, .11, .035); look = vec4f(0., .2, 0., 0.); profile = vec2f(.05, .1); wave = .3; flutter = .3; }
    // 2 teal seagrass
    case 2 { color = mix(vec3f(.05, .20, .16), vec3f(.12, .26, .22), s1); color = mix(color, vec3f(.30, .14, .24), step(.85, s2)); look = vec4f(.05, 1.0, .25, 0.); sparkle = vec3f(.6, 1., .9); profile = vec2f(.45, .35); wave = 2.2; }
    // 3 dark iridescent purple
    case 3 { color = mix(vec3f(.02, .05, .065), vec3f(.05, .03, .08), s1); color = mix(color, vec3f(.09, .03, .09), step(.8, s2)); look = vec4f(.2, .85, .55, .02); sparkle = mix(vec3f(.5, .35, 1.), vec3f(.2, 1., .7), step(.6, pick)); profile = vec2f(.7, .6); wave = 2.4; }
    // 4 amber
    case 4 { color = mix(vec3f(.30, .15, .02), vec3f(.42, .25, .04), s1); look = vec4f(.2, 1., .1, 0.); sparkle = vec3f(1., .85, .5); profile = vec2f(.5, .4); wave = 1.8; }
    // 5 glowing magenta tuft
    case 5 { color = mix(vec3f(.85, .05, .40), vec3f(.60, .10, .80), step(.7, s1)); color = mix(color, vec3f(.95, .25, .55), step(.75, s2)); look = vec4f(.22, .8, 0., .30); sparkle = vec3f(1., .35, .8); profile = vec2f(.6, .6); flutter = 2.; }
    // 6 red hanging frond
    case 6 { color = mix(vec3f(.80, .16, .16), vec3f(.92, .36, .42), s1); look = vec4f(.06, 1., 0., .10); sparkle = vec3f(1., .5, .5); profile = vec2f(.4, .3); wave = 2.; }
    // 7 teal tuft
    default { color = mix(vec3f(.05, .40, .36), vec3f(.10, .52, .58), s1); look = vec4f(.1, .9, .2, .04); sparkle = vec3f(.3, 1., .9); profile = vec2f(.6, .5); }
  }
  look.x = step(sineHash(s1 * 91.7 + s2 * 37.1 + leaf.shape.x), look.x);
  // the blade follows an arc of constant curvature that breathes over time, with a ripple running along it
  let k = (leaf.kind.w - .3) * 2.0 + sin(t * (.8 + s1) * flutter + s2 * 40. + rootHeight * .25) * .10 * flutter;
  let ripplePhase = v * (3. + 5. * s2) + s1 * 30. + t * 1.1;
  let ripple = sin(ripplePhase) * .12 * wave;
  // The arc's formulas divide by the curvature, so near zero the original swaps in a small positive one: a
  // blade whose curl breathes through zero flicks from -0.06 to +0.06 each time, a twitch of some centimetres
  // at its tip. With SMOOTH_BEND the curvature is used as it is, and near zero the two quotients are taken from
  // their series instead, which pass through zero without a step.
  let kq = k * 1.7; let straight = abs(kq) < .06; let ka = select(kq, select(.06, kq, SMOOTH_BEND), straight);
  let sK = sin(ka * v); let cK = cos(ka * v);
  let x = kq * v; let series = SMOOTH_BEND && straight;
  let alongK = select(sK / ka, v * (1. - x * x / 6.), series); let bendK = select((1. - cK) / ka, x * v * .5 * (1. - x * x / 12.), series);
  let spine = leaf.base.xyz + len * (along * alongK + bendDir * (bendK + ripple * v));
  let slope = sK + ripple + cos(ripplePhase) * .10 * wave * v * (3. + 5. * s2);
  let N = normalize(bendDir * cK - along * slope); let T = normalize(along * cK + bendDir * slope);
  // twist about the spine
  let twist = (s1 - .5) * 2.4 * v + sin(t * .9 + s2 * 20.) * .25 * v;
  let side = across * cos(twist) + N * sin(twist); let N2 = N * cos(twist) - across * sin(twist);
  let widthProfile = pow(max(sin(3.14159 * pow(v, profile.x)), 0.), profile.y);
  let shadowBake = frame.res.x == 0.;
  let rootDistance = distance(leaf.base.xyz, frame.camPos); let far = FAR * frame.detail;
  let nearK = select(1. - smoothRamp(26., 40., rootDistance), 0., shadowBake); // frilled edges only up close
  // width fades out towards the draw distance, and right at the camera so blades do not fill the screen
  let farK = select((1. - smoothRamp(far * .8, far, rootDistance)) * smoothRamp(.6, 2.2, distance(spine, frame.camPos)) * smoothRamp(len * 1.1 + .5, len * 2.2 + 1.2, distance(leaf.base.xyz + along * (len * .5), frame.camPos)), 1., shadowBake);
  let ruffle = sin(v * 10. + s2 * 30. + t * .6) * leaf.shape.z * .36 * u * bulge(v) * nearK;
  // in the shadow bake blades are at least 9 cm wide so they register, and stems cast nothing
  var p = spine + side * (u * farK * select(leaf.shape.z * .5 * widthProfile, select(max(leaf.shape.z * .5, .09) * widthProfile, 0., kind == 1), shadowBake));
  p += N2 * ruffle;
  let drift = sway(leaf.base.xz, rootHeight + (p.y - leaf.base.y), t);
  p.x += drift.x; p.z += drift.y;
  o.clip = frame.viewProj * vec4f(p, 1.); o.world = p; o.normal = normalize(N2 + side * u * .55 - T * cos(v * 10. + s2 * 30. + t * .6) * u * .7 * nearK); o.uv = vec2f(u, v);
  o.color = color; o.look = look; o.seeds = vec2f(s1, s2); o.sparkle = sparkle;
  return o;
}

@fragment
fn leafFragment(v: LeafVarying, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  let dist = length(v.world - frame.camPos);
  let caustic = causticsMono(v.world, dist);
  var n = normalize(v.normal); if (!front) { n = -n; }
  let V = normalize(frame.camPos - v.world); let L = frame.sunDir;
  let zone = zoneAt(v.world);
  let grain = textureSample(detailTexture, repeatSampler, vec2f(v.uv.x * .13 + v.seeds.x * 3.7, v.uv.y * .8 + v.seeds.y * 5.3));
  let around = volume(v.world + vec3f(0., .8, 0.));
  let sun = sunlight(v.world.y, zone) * shadow1(v.world + L * .3);
  let ndl = dot(n, L);
  // base colour: darker along the midrib and towards the root, fine veins up close, mottled by the detail texture
  var albedo = v.color * (.72 + .28 * smoothRamp(0., .25, abs(v.uv.x))) * mix(.5, 1.12, v.uv.y) * (1. - .45 * smoothRamp(30., 8., dist) * smoothRamp(.6, 1., sin(v.uv.y * 40. - abs(v.uv.x) * 7. + v.seeds.x * 40.))) * (.58 + .42 * smoothRamp(0., .13, abs(v.uv.x))) * (.5 + 1.0 * grain.b) * (.65 + .7 * grain.a);
  let ndv = clamp01(dot(n, V));
  // a rainbow sheen that shifts with the viewing angle, on the types that have it
  let iridescence = .5 + .5 * cos(TAU * (vec3f(0., .33, .67) + ndv * 1.1 + v.seeds.x * .22 + v.uv.y * .5 + .55));
  albedo = mix(albedo, albedo * .5 + iridescence * vec3f(.15, .13, .30), v.look.z * (1. - ndv) * .8);
  // light coming through the blade from behind, warmer than the blade itself
  let through = (max(-ndl, 0.) * .85 + .15) * v.look.y;
  let throughColor = albedo * mix(vec3f(1.), vec3f(1.5, 1.4, .75), clamp01(v.look.y) * (1. - v.look.z));
  let occlusion = clamp01((around.r - .5) * 6.) * mix(.4, 1., v.uv.y);
  let ambientLight = (ambient(v.world, n, around.g, zone) + ambient(v.world, -n, around.g, zone) * v.look.y * .55 * vec3f(1.1, 1.15, .7) + sideGlow(v.world, n, clamp01((around.r - .5) * 4.), zone) * .6) * (.3 + .7 * occlusion);
  var c = sun * (.06 + caustic * 1.5) * (albedo * max(ndl, 0.) + throughColor * through) + albedo * ambientLight;
  let H = normalize(V + L);
  c += sun * (pow(clamp01(dot(n, H)), 40.) * (.45 + iridescence * v.look.z * 2.) + pow(clamp01(dot(n, H)), 9.) * .07) + ambientLight * iridescence * v.look.z * pow(1. - ndv, 3.) * 1.5;
  c += sun * throughColor * v.look.y * pow(clamp01(dot(-V, L)), 3.) * 1.2; // glow when looking towards the sun through it
  c += albedo * v.look.w * (.5 + 3. * dot(ambientLight + sun * .3, vec3f(.1, .5, .5)));
  c += albedo * v.look.w * (MOOD_GLOW * 1.6); // and in the dark the same leaves shine by themselves
  // sparkle: whole-leaf glints that twinkle slowly
  let twinkle = pow(.5 + .5 * sin(frame.time * (.5 + v.seeds.y * 1.4) + v.seeds.x * 90.), 5.);
  let band = smoothRamp(.2, .0, abs(v.uv.y - (.35 + .45 * v.seeds.y))) * (1. - v.uv.x * v.uv.x);
  let lit = .35 + sun.g * 1.2 + MOOD_GLOW * .5;
  c += v.sparkle * v.look.x * (.1 + twinkle) * band * lit * .6;
  return hdrOutput(applyFog(c, v.world, zone));
}

// ---- glints: the gold and green specks drifting among the kelp, as additive camera-facing quads
override GLINT_FAR: f32 = 150.; // they have faded out by here (at 150 the fade starts where they are dropped anyway)
struct GlintVarying { @builtin(position) clip: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) color: vec3f }

// place: position, height above the plant's root (so it sways with the plant). spark: seed, colour key, size.
@vertex
fn glintVertex(@builtin(vertex_index) index: u32, @location(0) place: vec4f, @location(1) spark: vec4f) -> GlintVarying {
  var o: GlintVarying; let q = vec2f(f32(index & 1u), f32(index >> 1u)) * 2. - 1.; let t = frame.time;
  var p = place.xyz; let drift = sway(place.xz, place.w, t); p.x += drift.x; p.z += drift.y;
  p += .1 * vec3f(sin(t * .7 + spark.x * 50.), sin(t * .9 + spark.x * 70.), cos(t * .8 + spark.x * 90.));
  let d = length(p - frame.camPos);
  // too far or behind the camera: collapse the quad outside the clip volume
  if (d > 120. || dot(p - frame.camPos, frame.fwd) < -1.) { o.clip = vec4f(0., 0., 2., 1.); return o; }
  let twinkle = pow(.5 + .5 * sin(t * (.35 + .9 * sineHash(spark.x)) + spark.x * 100.), 4.);
  // never smaller than about a pixel on screen; the brightness is scaled down to keep the same total light
  let size = min(max(spark.z, d * .0026), d * .0045);
  let world = p + (frame.right * q.x + frame.up * q.y) * size;
  o.clip = frame.viewProj * vec4f(world, 1.); o.uv = q;
  let zone = zoneAt(p);
  let lit = .3 + 1.8 * shadow1(p) * sunlight(p.y, zone).g + MOOD_GLOW * 1.1;
  let e = spark.z / size;
  o.color = sparklePalette(spark.y) * (.12 + twinkle * 1.7) * lit * e * e * exp(-EXTINCTION.g * d) * smoothRamp(.4, 1.5, d) * 17. * smoothRamp(GLINT_FAR, GLINT_FAR * .8, d);
  return o;
}

@fragment
fn glintFragment(v: GlintVarying) -> @location(0) vec4f {
  let r = dot(v.uv, v.uv);
  return vec4f(min(v.color * exp(-r * 7.) * (1. - smoothRamp(.7, 1., r)), vec3f(10.)), 0.);
}
