#include "common/scene.wgsl"

// The swimmer's own arms and gear, seen in first person. Skinned meshes: every vertex is moved by one or two
// bones, which are posed in view space (metres from the eye: x right, y up, z back), so the body sits still in
// the picture however the camera moves. It is lit like everything else: sun through the shadow map, caustics,
// the water's glow, fog.

const BONES = 40; // as in src/body/skeleton.ts (a test holds the two together)
// for every bone a rotation q and an offset t: a point v of the bind pose goes to rotate(q, v) + t
struct Bones { q: array<vec4f, BONES>, t: array<vec4f, BONES> }
@group(1) @binding(0) var<uniform> bones: Bones;

// materials, as numbered in src/body/meshes.ts
const NEOPRENE = 0; const FABRIC = 1; const RUBBER = 2; const ARMOUR = 3; const STRAP = 4; const COMPUTER = 5;
const SCREEN = 6; const PAINT = 7; const TRIM = 8; const LAMP = 9; const BLADES = 10;

const ELBOW = .29; // along the bind pose's arm, metres from the shoulder (src/body/skeleton.ts)
const WRIST = .55;

struct BodyVertex {
  @location(0) position: vec3f, // in the bind pose
  @location(1) normal: vec4f, // xyz, and in w how much light the shape itself lets through (0..1)
  @location(2) skin: vec4u, // two bones, the first one's share in 255ths, the material
}
struct BodyVarying {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) local: vec3f, // the bind-pose position: patterns drawn with it stay on the surface as it bends
  @location(3) open: f32,
  @location(4) @interpolate(flat) material: u32,
}

@vertex
fn bodyVertex(v: BodyVertex) -> BodyVarying {
  var o: BodyVarying;
  let a = v.skin.x; let b = v.skin.y; let share = f32(v.skin.z) / 255.;
  let p = mix(rotate(bones.q[b], v.position) + bones.t[b].xyz, rotate(bones.q[a], v.position) + bones.t[a].xyz, share);
  let n = normalize(mix(rotate(bones.q[b], v.normal.xyz), rotate(bones.q[a], v.normal.xyz), share));
  o.world = frame.camPos + frame.right * p.x + frame.up * p.y - frame.fwd * p.z;
  o.normal = frame.right * n.x + frame.up * n.y - frame.fwd * n.z;
  o.clip = frame.viewProj * vec4f(o.world, 1.);
  // into the nearest tenth of the depth range (depth is reversed: 1 is near), so that a rock the swimmer is
  // pressed against cannot cut through a hand: the body is always in front of the world
  o.clip.z = o.clip.w * .9 + o.clip.z * .1;
  o.local = v.position; o.open = v.normal.w; o.material = v.skin.w;
  return o;
}

// a line of stitching `across` metres from a seam: short pale dashes along `along`
fn stitches(across: f32, along: f32) -> f32 { return smoothRamp(.0011, .0005, abs(across)) * step(.42, fract(along * 210.)); }

@fragment
fn bodyFragment(v: BodyVarying) -> @location(0) vec4f {
  let N0 = normalize(v.normal); let L = frame.sunDir; let V = normalize(frame.camPos - v.world);
  let dist = length(v.world - frame.camPos);
  let p = v.local;
  // the rock detail texture doubles as cloth grain and scuffing (taken before any branch: sampling with
  // implicit derivatives needs uniform control flow)
  let grain = textureSample(detailTexture, repeatSampler, p.xy * 9. + p.z * 5.);
  let weave = textureSample(detailTexture, repeatSampler, p.yz * 31. + p.x * 17.);
  let scuff = textureSample(detailTexture, repeatSampler, p.yz * 2.3 + p.x * 1.7);
  let around = atan2(p.x, p.z); // the angle round the arm, 0 on the back of the hand's side
  let girth = length(p.xz);

  var albedo = vec3f(0.); var gloss = .3; var bump = .25; var sheen = 0.; var glow = vec3f(0.);
  // A material is one number for a whole triangle, so a border between two of them is a row of teeth. The
  // wrist strap's border is simple enough to draw exactly instead: it is a band at one place along the arm.
  var material = v.material;
  if ((material == FABRIC || material == STRAP) && p.y < WRIST - .005) { material = select(u32(FABRIC), u32(STRAP), abs(p.y - (WRIST - .026)) < .0098 || (material == STRAP && abs(p.y - (WRIST - .026)) < .0125 && p.z > .02)); }
  switch material {
    case NEOPRENE: {
      // wetsuit: near-black neoprene with a fine jersey face; a teal panel down the back of the forearm and
      // over the shoulder, seamed and stitched; a thin band above the elbow
      albedo = vec3f(.032, .038, .050) * (.72 + .5 * weave.b);
      let edge = abs(around) - mix(.95, .62, smoothRamp(ELBOW + .02, WRIST - .06, p.y));
      let panel = smoothRamp(.03, -.03, edge) * smoothRamp(ELBOW - .012, ELBOW + .03, p.y) + smoothRamp(.08, .03, p.y) * smoothRamp(1.3, 1.1, abs(around));
      albedo = mix(albedo, vec3f(.015, .36, .40) * (.7 + .5 * weave.b), clamp01(panel));
      // seams: a dark groove with a row of pale stitches on either side
      let seam = edge * girth;
      albedo *= 1. - .7 * smoothRamp(.0016, .0004, abs(seam)) * step(ELBOW, p.y);
      albedo = mix(albedo, vec3f(.30, .36, .38), (stitches(seam - .0034, p.y) + stitches(seam + .0034, p.y)) * step(ELBOW + .01, p.y) * .8);
      let ring = abs(p.y - (ELBOW - .075));
      albedo = mix(albedo, vec3f(.80, .28, .03), smoothRamp(.006, .0045, ring) * .9);
      gloss = .34; bump = .55; sheen = .5;
    }
    case FABRIC: {
      // the back of the glove: slate-blue stretch fabric, ribbed across the fingers, darker in the folds
      let ribs = .5 + .5 * sin(p.y * 2300.);
      albedo = vec3f(.115, .150, .200) * (.7 + .25 * ribs + .35 * weave.b);
      albedo = mix(albedo, vec3f(.06, .075, .10), smoothRamp(.55, .8, scuff.a) * .5);
      gloss = .22; bump = .6; sheen = .7;
    }
    case RUBBER: {
      // the palm and the fingertips: black rubber studded with small grips
      let cell = fract(vec2f(p.x, p.y) * vec2f(260., 300.) + vec2f(floor(p.y * 300.) * .5, 0.)) - .5;
      let stud = smoothRamp(.42, .26, length(cell));
      albedo = vec3f(.020, .021, .024) * (.8 + .4 * grain.b) + stud * vec3f(.018, .020, .022);
      gloss = mix(.25, .6, stud); bump = .35;
    }
    case ARMOUR: {
      // moulded pads over the knuckles and the fingers: pale grey, scratched
      albedo = mix(vec3f(.34, .37, .40), vec3f(.20, .22, .25), smoothRamp(.45, .7, scuff.a)) * (.85 + .3 * grain.b);
      gloss = .55; bump = .15;
    }
    case STRAP: {
      // the wrist strap: orange webbing with a woven texture
      albedo = vec3f(.92, .30, .03) * (.6 + .3 * step(.5, fract(p.y * 900.)) + .3 * weave.b);
      gloss = .25; bump = .5; sheen = .4;
    }
    case COMPUTER: {
      albedo = vec3f(.022, .023, .026) * (.8 + .4 * grain.b); gloss = .6; bump = .1;
    }
    case SCREEN: {
      // a small lit display: a depth read-out as bars, a ring for the air that is left. (The dive computer on
      // the forearm, or the scooter's battery gauge, which sits at another place in its own mesh.)
      let uv = (p.xy - vec2f(0., select(WRIST - .1, .12, p.y < .3))) / vec2f(.0165, .021);
      let bars = step(abs(uv.x + .1), .62) * step(abs(fract(uv.y * 2.4 + .5) - .5), .2) * step(uv.x, -.75 + 1.5 * fract(floor(uv.y * 2.4 + .5) * .37 + .2));
      let dial = smoothRamp(.1, .06, abs(length(uv - vec2f(.55, -.55)) - .25));
      albedo = vec3f(.004, .008, .010); gloss = .9; bump = 0.;
      glow = vec3f(.10, .85, .75) * (bars * .5 + dial * .7) + vec3f(.01, .05, .05);
    }
    case PAINT: {
      // the scooter's shell: yellow paint, scuffed down to a darker undercoat
      albedo = mix(vec3f(.95, .50, .02), vec3f(.50, .27, .04), smoothRamp(.55, .8, scuff.a) * .7) * (.85 + .25 * grain.b);
      gloss = .75; bump = .1;
    }
    case TRIM: {
      albedo = vec3f(.028, .030, .034) * (.7 + .6 * grain.b); gloss = .45; // black trim: ring, struts, handles
    }
    case LAMP: {
      albedo = vec3f(.5, .55, .6); gloss = .95; glow = vec3f(1.6, 1.5, 1.2);
    }
    default: {
      albedo = vec3f(.06, .065, .07) * (.7 + .6 * grain.b); gloss = .6; // propeller
    }
  }

  let N = normalize(N0 + (frame.right * (weave.r - .5) + frame.up * (weave.g - .5)) * bump);
  let zone = zoneAt(v.world);
  let caustic = caustics(v.world, dist);
  let room = volume(v.world);
  let open = clamp01((room.r - .5) * 2.7);
  // the shape's own shadowing, from the bake: full in open skin, deep between the fingers and in the folds
  let ao = mix(.12, 1., v.open * v.open);
  let sun = sunlight(v.world.y, zone) * shadow9(v.world + N0 * .2);
  // the sun wraps a little way round: these are small rounded things seen from a hand's breadth away, and a
  // hard terminator would cut them into a lit and a black half
  let wrap = clamp01(dot(N, L) * .7 + .3);
  let direct = sun * wrap * (.10 + mix(vec3f(.33), caustic, smoothRamp(.1, .45, dot(N0, L))) * 2.5) * mix(.45, 1., ao);
  let ambientLight = (ambient(v.world, N, room.g, zone) + sideGlow(v.world, N, open, zone)) * ao * 1.4;
  var c = albedo * (direct + ambientLight);
  let H = normalize(V + L); let ndl = clamp01(dot(N, L));
  c += sun * (.25 + caustic) * pow(clamp01(dot(N, H)), mix(10., 90., gloss)) * gloss * ndl * 1.8 * ao;
  // the water all around, mirrored at grazing angles: what makes wet rubber and paint look wet
  let rim = pow(1. - clamp01(dot(N, V)), 2.5);
  let R = reflect(-V, N);
  c += (ambient(v.world, R, room.g, zone) + sideGlow(v.world, R, open, zone)) * (.08 + gloss) * .6 * rim * ao;
  // fabric catches light along its edges, where the fibres stand up
  c += albedo * (sun * (.3 + .7 * ndl) + ambientLight) * sheen * rim * .9;
  c += glow;
  return hdrOutput(applyFog(c, v.world, zone));
}
