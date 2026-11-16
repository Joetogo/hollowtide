#include "common/scene.wgsl"

// Sea turtles. Not in the original. Like the fish and the mantas nothing is simulated: where a turtle is, the
// way it heads and how its flippers row are closed-form functions of time. The mesh (life/turtle.ts) tells each
// vertex which limb moves it and how much; the numbers below are that file's, and a test holds them equal.
const SHOULDER = vec3f(.26, -.02, .31); // what a front flipper turns about (x mirrored for the left one)
const HIP = vec3f(.16, -.03, -.37);
const NECK = vec3f(0., -.01, .42);
const FLIPPER_REACH = .66; // from the shoulder to the tip
const EYE = vec3f(.067, .026, .71);
const SHELL = vec2f(.36, .48); // half width, half length
const LOOP_SQUASH = .8;
const LOOP_RISE = 1.1;

struct TurtleVertex {
  @location(0) position: vec3f, // x to its right, y up, z the way it swims
  @location(1) normal: vec4f, // xyz, and in w how much of the light around the shape itself lets through
  @location(2) rig: vec4u, // the limb that moves it (0 none, 1 front flipper, 2 rear, 3 head); -; how much, in 255ths; skin (1) or shell (0)
  // per instance
  @location(3) orbit: vec4f, // the middle of its loop, and the loop's radius
  @location(4) motion: vec4f, // phase, radians a second (sign = which way round), size, second phase
}
struct TurtleVarying {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) local: vec3f, // as sculpted: patterns drawn with it stay put as the limbs move
  @location(3) bindNormal: vec3f,
  @location(4) skin: f32,
  @location(5) open: f32,
  @location(6) @interpolate(flat) seed: f32,
}

fn turnX(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }
fn turnY(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(p.x * c + p.z * s, p.y, -p.x * s + p.z * c); }
fn turnZ(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(p.x * c - p.y * s, p.x * s + p.y * c, p.z); }

@vertex
fn turtleVertex(v: TurtleVertex) -> TurtleVarying {
  var o: TurtleVarying;
  let t = frame.time; let R = v.orbit.w; let size = v.motion.z;
  // round its loop, rising and falling twice a lap
  let angle = t * v.motion.y + v.motion.x;
  let P = v.orbit.xyz + vec3f(R * cos(angle), LOOP_RISE * sin(2. * angle + v.motion.w), R * LOOP_SQUASH * sin(angle));
  let T = normalize(vec3f(-R * sin(angle), 2. * LOOP_RISE * cos(2. * angle + v.motion.w), R * LOOP_SQUASH * cos(angle))) * sign(v.motion.y);
  var S = normalize(cross(vec3f(0., 1., 0.), T)); var Up = cross(T, S);
  let bank = -.16 * sign(v.motion.y); // leaning into the turn
  let S2 = S * cos(bank) + Up * sin(bank); Up = Up * cos(bank) - S * sin(bank); S = S2;

  // the stroke: the down beat quicker than the recovery, and harder for a while, then easier
  let raw = t * 1.7 + v.motion.w * 5.; let b = raw + .3 * sin(raw);
  let effort = .62 + .38 * sin(t * .23 + v.motion.x * 3.);
  let share = f32(v.rig.z) / 255.; let side = select(-1., 1., v.position.x > 0.);
  var l = v.position; var n = v.normal.xyz;
  if (v.rig.x == 1u) {
    // a front flipper: up and forward, then down and back, the tip following the root, the blade turned edge on
    // to the water on the way down
    let pivot = SHOULDER * vec3f(side, 1., 1.);
    let along = clamp01((abs(l.x) - SHOULDER.x) / FLIPPER_REACH);
    let beat = b - along * 1.15;
    let flap = (.62 * effort * sin(beat) + .1) * share * side;
    let sweep = -.26 * effort * sin(beat + .6) * share * side;
    let feather = -.26 * effort * cos(beat) * share;
    l = pivot + turnY(turnZ(turnX(l - pivot, feather), flap), sweep);
    n = turnY(turnZ(turnX(n, feather), flap), sweep);
  } else if (v.rig.x == 2u) {
    // a rear flipper: a rudder, sculling a little
    let pivot = HIP * vec3f(side, 1., 1.);
    let scull = .2 * sin(b * .5 + side * .8) * share; let steer = .14 * sin(b * .5 + 1.) * share * side;
    l = pivot + turnY(turnX(l - pivot, scull), steer);
    n = turnY(turnX(n, scull), steer);
  } else if (v.rig.x == 3u) {
    // the head looks about
    let look = .22 * sin(t * .37 + v.motion.w * 3.) * share; let nod = .09 * sin(t * .5 + v.motion.x) * share;
    l = NECK + turnY(turnX(l - NECK, nod), look);
    n = turnY(turnX(n, nod), look);
  }
  // the body is lifted by each down beat
  l.y -= .035 * effort * sin(b - .5);
  let world = P + (S * l.x + Up * l.y + T * l.z) * size;
  o.clip = frame.viewProj * vec4f(world, 1.); o.world = world; o.normal = S * n.x + Up * n.y + T * n.z;
  o.local = v.position; o.bindNormal = v.normal.xyz; o.skin = f32(v.rig.w); o.open = v.normal.w; o.seed = v.motion.w;
  return o;
}

// two numbers in 0..1 for a whole-number place, the same on every GPU
fn scatter(p: vec2f) -> vec2f {
  let n = vec2u(vec2i(p)) * vec2u(1597334673u, 3812015801u);
  let h = (n.x ^ n.y) * vec2u(1597334673u, 3812015801u);
  return vec2f(h >> vec2u(8u)) / 16777216.;
}

// Scales: cells about one unit across, none quite like its neighbour. Returns how far a point is from the edge
// of its cell (0 on the edge), and a number that is the cell's own.
fn scales(p: vec2f) -> vec2f {
  let cell = floor(p); let f = p - cell; var nearest = 8.; var second = 8.; var own = 0.;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let g = vec2f(f32(x), f32(y)); let r = scatter(cell + g);
      let d = length(g + .2 + .6 * r - f);
      if (d < nearest) { second = nearest; nearest = d; own = r.x; } else if (d < second) { second = d; }
    }
  }
  return vec2f(second - nearest, own);
}

// The carapace's plates, seen from above: five down the middle, four down each side, a ring of small ones round
// the rim. Returns how far the nearest seam is, in metres, and where the middle of the plate is.
fn scutes(p: vec2f) -> vec3f {
  let q = p / SHELL; let rho = length(q); let ax = abs(p.x);
  const RING = .8; const COLUMN = .1; const PITCH = .168;
  var seam = abs(rho - RING) * .4; var middle = vec2f(0.);
  if (rho > RING) {
    let a = atan2(q.y, q.x) / TAU * 26.;
    seam = min(seam, abs(fract(a + .5) - .5) * .1);
    let m = (floor(a) + .5) / 26. * TAU; middle = vec2f(cos(m), sin(m)) * .9 * SHELL;
  } else if (ax < COLUMN) {
    let k = floor(p.y / PITCH + .5);
    seam = min(seam, min(COLUMN - ax, (.5 - abs(p.y / PITCH - k)) * PITCH));
    middle = vec2f(0., k * PITCH);
  } else {
    // the side plates are set half a plate along from the middle ones, their seams slanting back
    let z = p.y + (ax - COLUMN) * .3; let k = floor(z / PITCH);
    seam = min(seam, min(ax - COLUMN, (.5 - abs(z / PITCH - k - .5)) * PITCH));
    middle = vec2f(sign(p.x) * .2, (k + .5) * PITCH - .03);
  }
  return vec3f(seam, middle);
}

@fragment
fn turtleFragment(v: TurtleVarying) -> @location(0) vec4f {
  let dist = length(v.world - frame.camPos);
  let caustic = caustics(v.world, dist);
  let mottle = textureSample(detailTexture, repeatSampler, v.local.xz * 2.3 + v.seed);
  let n = normalize(v.normal + (vec3f(mottle.r, 0., mottle.g) - vec3f(.5, 0., .5)) * .22);
  let L = frame.sunDir; let V = normalize(frame.camPos - v.world);
  let zone = zoneAt(v.world); let around = volume(v.world);

  // the shell: above its rim dark plates rayed with amber, each in a fine groove; under it, cream
  let plate = scutes(v.local.xz);
  let spoke = v.local.xz - plate.yz;
  let rays = .5 + .5 * sin(atan2(spoke.y, spoke.x) * 13. + mottle.r * 9.);
  let rings = .5 + .5 * sin(length(spoke) * 150. + mottle.g * 5.);
  var carapace = mix(vec3f(.085, .06, .03), vec3f(.4, .245, .085), (.12 + .6 * rays) * (.35 + .65 * mottle.b)) * (.82 + .18 * rings);
  // a dark groove along each seam, and the plate's edge beside it a little paler than its middle
  carapace = mix(vec3f(.03, .026, .016), carapace * (1. + .55 * smoothRamp(.022, .007, plate.x)), smoothRamp(.0015, .0075, plate.x));
  let underSeam = min(abs(v.local.x), abs(fract(v.local.z / .15) - .5) * .15);
  let plastron = vec3f(.56, .5, .3) * (.82 + .18 * mottle.a) * (1. - .3 * smoothRamp(.004, .001, underSeam));
  let shell = mix(plastron, carapace, smoothRamp(-.05, -.028, v.local.y));
  // the skin: dark scales with pale edges, seen along whichever axis the surface faces; larger on the flippers
  // than on the head and neck; pale underneath
  let facing = abs(v.bindNormal);
  let plane = select(select(v.local.xy, v.local.zy, facing.x > facing.z), v.local.xz, facing.y > .55);
  let cell = scales(plane * select(24., 42., v.local.z > NECK.z));
  let scale = smoothRamp(.025, .12, cell.x);
  var skin = mix(vec3f(.44, .41, .26), vec3f(.05, .066, .055) * (.55 + .9 * cell.y), scale);
  skin = mix(skin, vec3f(.55, .51, .35) * (.75 + .25 * scale), smoothRamp(-.15, -.65, v.bindNormal.y) * .9);
  // the eyes: dark, and wet
  let eye = smoothRamp(.014, .0105, length(vec3f(abs(v.local.x), v.local.yz) - EYE));
  let albedo = mix(mix(shell, skin, v.skin), vec3f(.008), eye);

  let sun = sunlight(v.world.y, zone) * shadow4(v.world + n * .3);
  let ndv = clamp01(dot(n, V));
  let fillNormal = vec3f(n.x, abs(n.y) * .55 + .25, n.z);
  let sky = ambient(v.world, vec3f(0., 1., 0.), around.g, zone);
  var c = albedo * (sun * clamp01(dot(n, L)) * (.3 + caustic) + (ambient(v.world, fillNormal, around.g, zone) * 1.1 + sideGlow(v.world, n, 1., zone) * .8) * (.35 + .65 * v.open));
  // a wet shine, sharper on the shell and the eyes than on the skin
  c += sun * pow(clamp01(dot(n, normalize(V + L))), mix(110., 24., v.skin)) * mix(.3, .1, v.skin) * (.3 + caustic) * (1. + 4. * eye);
  // light thrown back up from the seabed onto its underside, and the sky caught at grazing angles
  c += albedo * sky * caustic * .45 * smoothRamp(.2, -.4, n.y) + sky * pow(1. - ndv, 3.) * .28;
  return hdrOutput(applyFog(c, v.world, zone));
}
