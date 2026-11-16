#include "common/scene.wgsl"

// The swimmer's own arms and gear, seen in first person. Skinned meshes: every vertex is moved by one or two
// bones, which are posed in view space (metres from the eye: x right, y up, z back), so the body sits still in
// the picture however the camera moves.
//
// They have to stand next to rock that is textured at four scales and lit through a shadow map, caustics and
// a baked volume, so they get the same treatment: the same detail texture for grain and wear, real relief
// (folds, seams, ribs, studs) worked out as a height and lit as a slope, the same sun, caustics, ambient and fog.

const BONES = 40; // as in src/body/skeleton.ts (a test holds the two together)
// for every bone a rotation q and an offset t: a point v of the bind pose goes to rotate(q, v) + t
struct Bones { q: array<vec4f, BONES>, t: array<vec4f, BONES> }
@group(1) @binding(0) var<uniform> bones: Bones;

// materials, as numbered in src/body/meshes.ts
const NEOPRENE = 0; const FABRIC = 1; const RUBBER = 2; const ARMOUR = 3; const STRAP = 4; const COMPUTER = 5;
const SCREEN = 6; const PAINT = 7; const TRIM = 8; const LAMP = 9; const BLADES = 10;

const ELBOW = .29; // along the bind pose's arm, metres from the shoulder (src/body/skeleton.ts)
const WRIST = .55;
// The body is drawn through a longer lens than the world (51 degrees top to bottom against 62). Through the
// world's wide lens, things a forearm's length from the eye are stretched towards the edges of the picture and
// look small; this is the lens a camera held at arm's length would be given.
const BODY_TAN = .48;

struct BodyVertex {
  @location(0) position: vec3f, // in the bind pose
  @location(1) normal: vec4f, // xyz, and in w how much light the shape itself lets through (0..1)
  @location(2) skin: vec4u, // two bones, the first one's share in 255ths, the material
}
struct BodyVarying {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) local: vec3f, // the bind-pose position: patterns drawn with it stay on the surface as it bends
  @location(2) bindNormal: vec3f,
  // where the bones have taken the bind pose's x and y axes, in world space: with these, a direction worked
  // out on the bind pose (a tilted normal) can be carried to where the surface is now
  @location(3) axisX: vec3f,
  @location(4) axisY: vec3f,
  @location(5) open: f32,
  @location(6) @interpolate(flat) material: u32,
}

fn toWorld(v: vec3f) -> vec3f { return frame.right * v.x + frame.up * v.y - frame.fwd * v.z; }

@vertex
fn bodyVertex(v: BodyVertex) -> BodyVarying {
  var o: BodyVarying;
  let qa = bones.q[v.skin.x]; let qb = bones.q[v.skin.y]; let share = f32(v.skin.z) / 255.;
  let p = mix(rotate(qb, v.position) + bones.t[v.skin.y].xyz, rotate(qa, v.position) + bones.t[v.skin.x].xyz, share);
  o.world = frame.camPos + toWorld(p);
  o.axisX = toWorld(mix(rotate(qb, vec3f(1., 0., 0.)), rotate(qa, vec3f(1., 0., 0.)), share));
  o.axisY = toWorld(mix(rotate(qb, vec3f(0., 1., 0.)), rotate(qa, vec3f(0., 1., 0.)), share));
  // the world's projection with the body's own lens: x and y over the lens's tangent, depth reversed (1 is near)
  o.clip = vec4f(p.x * frame.tanHalfY / (BODY_TAN * frame.tanHalfX), p.y / BODY_TAN, frame.near, -p.z);
  // and into the nearest tenth of the depth range, so that a rock the swimmer is pressed against cannot cut
  // through a hand: the body is always in front of the world
  o.clip.z = o.clip.w * .9 + o.clip.z * .1;
  o.local = v.position; o.bindNormal = v.normal.xyz; o.open = v.normal.w; o.material = v.skin.w;
  return o;
}

// ---- the detail texture, taken along the three axes of the bind pose and blended by which way the surface
// faces, as the rock shader does: b = height, a = mottle, rg = slope
struct Grain { height: f32, mottle: f32, slope: vec3f }
fn grain(p: vec3f, n: vec3f, scale: f32) -> Grain {
  var w = pow(abs(n), vec3f(4.)); w /= (w.x + w.y + w.z);
  let x = textureSample(detailTexture, repeatSampler, p.zy * scale); let y = textureSample(detailTexture, repeatSampler, p.xz * scale); let z = textureSample(detailTexture, repeatSampler, p.xy * scale);
  var o: Grain;
  o.height = x.b * w.x + y.b * w.y + z.b * w.z;
  o.mottle = x.a * w.x + y.a * w.y + z.a * w.z;
  let a = x.rg * 2. - 1.; let b = y.rg * 2. - 1.; let c = z.rg * 2. - 1.;
  o.slope = vec3f(0., a.y, a.x) * w.x + vec3f(b.x, 0., b.y) * w.y + vec3f(c.x, c.y, 0.) * w.z;
  return o;
}
fn hash2(p: vec2f) -> f32 { var q = fract(p * vec2f(.1031, .1030)); q += dot(q, q.yx + 33.33); return fract((q.x + q.y) * q.x); }

// how far a point of the sleeve is from the seam of its forearm panel, metres along the surface (negative inside the panel)
fn seamOf(p: vec3f) -> f32 { return (abs(atan2(p.x, p.z)) - mix(.95, .62, smoothRamp(ELBOW + .02, WRIST - .06, p.y))) * length(p.xz); }
// the rubber studs of a palm: 1 on a stud, 0 between
fn studs(p: vec3f) -> f32 {
  let row = floor(p.y * 290.);
  let cell = fract(vec2f(p.x * 250. + row * .5, p.y * 290.)) - .5;
  return smoothRamp(.44, .24, length(cell));
}

// The surface's own relief, metres above the sculpted shape: folds where the suit bunches, seams, the ribs of
// a knit, studs. `fine` fades out what is too small for the pixels it is drawn in (it would only shimmer).
fn relief(p: vec3f, material: u32, fine: f32) -> f32 {
  let around = atan2(p.x, p.z);
  var h = 0.;
  if (material == NEOPRENE) {
    // rings of folds at the elbow and above the cuff, each a little crooked
    let crook = sin(around * 2. + p.y * 31.) * .7 + sin(around * 5. - p.y * 17.) * .35;
    h += .0013 * sin((p.y - ELBOW) * 205. + crook) * exp(-pow((p.y - ELBOW) / .06, 2.));
    h += .0008 * sin((p.y - (WRIST - .1)) * 310. + crook * 1.4) * exp(-pow((p.y - (WRIST - .1)) / .035, 2.));
    // long soft creases along the upper arm
    h += .0006 * sin(around * 7. + sin(p.y * 23.) * 1.2) * smoothRamp(ELBOW - .03, ELBOW - .12, p.y);
    // the seam of the forearm panel: a groove, with stitches standing up on either side
    let seam = seamOf(p); let on = step(ELBOW, p.y);
    h -= .0008 * smoothRamp(.0019, .0, abs(seam)) * on;
    h += .00035 * (smoothRamp(.0012, .0004, abs(abs(seam) - .0034)) * step(.4, fract(p.y * 210.))) * on * fine;
  } else if (material == FABRIC) {
    // a knit: ribs across the hand
    h += .00013 * sin(p.y * 2400.) * fine;
  } else if (material == RUBBER) {
    h += .00045 * studs(p) * fine;
  } else if (material == ARMOUR) {
    // moulded pads, scored across
    h -= .00035 * smoothRamp(.16, .0, abs(fract(p.y * 150.) - .5));
  } else if (material == STRAP) {
    h += .00016 * sin(p.y * 1500.) * sin(around * 60.) * fine;
  }
  return h;
}

// one digit of a seven-segment display in the unit square: 1 on its lit strokes
const SEGMENTS = array<u32, 10>(0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F); // bits: a b c d e f g
fn sevenSegment(uv: vec2f, digit: i32) -> f32 {
  if (uv.x < 0. || uv.x > 1. || uv.y < 0. || uv.y > 1.) { return 0.; }
  let m = SEGMENTS[clamp(digit, 0, 9)];
  let p = vec2f(uv.x, uv.y * 2.);
  let across = step(.2, p.x) * step(p.x, .8); let t = .1;
  let upper = step(1.08, p.y) * step(p.y, 1.8); let lower = step(.2, p.y) * step(p.y, .92);
  var lit = f32(m & 1u) * across * step(abs(p.y - 1.88), t) + f32((m >> 6u) & 1u) * across * step(abs(p.y - 1.), t) + f32((m >> 3u) & 1u) * across * step(abs(p.y - .12), t);
  lit += f32((m >> 5u) & 1u) * upper * step(abs(p.x - .1), t) + f32((m >> 1u) & 1u) * upper * step(abs(p.x - .9), t);
  lit += f32((m >> 4u) & 1u) * lower * step(abs(p.x - .1), t) + f32((m >> 2u) & 1u) * lower * step(abs(p.x - .9), t);
  return min(lit, 1.);
}

@fragment
fn bodyFragment(v: BodyVarying) -> @location(0) vec4f {
  let p = v.local; let L = frame.sunDir; let V = normalize(frame.camPos - v.world);
  let dist = length(v.world - frame.camPos);
  let n0 = normalize(v.bindNormal);
  // the detail texture at three scales: wear in patches, the grain of the material, and its finest tooth
  // (all taken before any branch: sampling with implicit derivatives needs uniform control flow)
  let broad = grain(p, n0, 6.); let mid = grain(p, n0, 23.); let micro = grain(p, n0, 71.);
  let pixel = fwidth(p.x) + fwidth(p.y) + fwidth(p.z); // roughly the width of a pixel on the surface, metres
  let fine = smoothRamp(.0011, .0004, pixel);
  let around = atan2(p.x, p.z);

  // A material is one number for a whole triangle, so a border between two of them is a row of teeth. The
  // wrist strap's border is simple enough to draw exactly instead: it is a band at one place along the arm.
  var material = v.material;
  if ((material == FABRIC || material == STRAP) && p.y < WRIST - .005) { material = select(u32(FABRIC), u32(STRAP), abs(p.y - (WRIST - .026)) < .0098 || (material == STRAP && abs(p.y - (WRIST - .026)) < .0125 && p.z > .02)); }

  var albedo = vec3f(0.); var gloss = .3; var bump = .5; var sheen = 0.; var glow = vec3f(0.); var bubbly = 0.;
  let wear = smoothRamp(.42, .72, broad.mottle * .6 + mid.mottle * .45);
  switch material {
    case NEOPRENE: {
      // wetsuit: near-black neoprene, greyed where it has rubbed; a teal panel down the back of the forearm and
      // over the shoulder; an orange ring above the elbow
      albedo = mix(vec3f(.040, .047, .060), vec3f(.09, .10, .115), wear * .55) * (.6 + .7 * mid.height);
      let seam = seamOf(p);
      let panel = smoothRamp(.0015, -.0015, seam) * smoothRamp(ELBOW - .012, ELBOW + .03, p.y) + smoothRamp(.08, .03, p.y) * smoothRamp(1.3, 1.1, abs(around));
      albedo = mix(albedo, mix(vec3f(.012, .33, .37), vec3f(.05, .22, .25), wear * .6) * (.55 + .8 * mid.height), clamp01(panel));
      albedo *= 1. - .65 * smoothRamp(.0017, .0003, abs(seam)) * step(ELBOW, p.y);
      albedo = mix(albedo, vec3f(.34, .40, .42), smoothRamp(.0012, .0004, abs(abs(seam) - .0034)) * step(.4, fract(p.y * 210.)) * step(ELBOW + .01, p.y) * .8 * fine);
      albedo = mix(albedo, vec3f(.78, .27, .03) * (.6 + .6 * mid.height), smoothRamp(.006, .0045, abs(p.y - (ELBOW - .075))) * .9);
      gloss = mix(.42, .2, wear); bump = .75; sheen = .45; bubbly = 1.;
    }
    case FABRIC: {
      // the back of the glove: slate-blue stretch knit, faded where it stretches over the knuckles
      albedo = mix(vec3f(.15, .20, .28), vec3f(.26, .30, .35), wear * .6) * (.55 + .75 * mid.height) * (.9 + .2 * sin(p.y * 2400.) * fine);
      gloss = .2; bump = .8; sheen = .7; bubbly = .7;
    }
    case RUBBER: {
      // the palm and the fingertips: black rubber studded with small grips, shiny where they have worn smooth
      let stud = studs(p) * fine;
      albedo = vec3f(.018, .019, .022) * (.7 + .6 * mid.height) + stud * vec3f(.022, .024, .027);
      gloss = mix(.3, .7, stud) * mix(1., .6, wear); bump = .45;
    }
    case ARMOUR: {
      // moulded pads over the knuckles and the fingers: grey rubber, scuffed pale along its edges
      albedo = mix(vec3f(.27, .30, .33), vec3f(.46, .49, .51), wear) * (.6 + .6 * mid.height);
      gloss = mix(.6, .3, wear); bump = .35;
    }
    case STRAP: {
      // the wrist strap: orange webbing
      albedo = vec3f(.90, .29, .03) * (.5 + .35 * step(.5, fract(p.y * 480.)) * fine + .5 * mid.height) * mix(1., .7, wear);
      gloss = .22; bump = .7; sheen = .4;
    }
    case COMPUTER: {
      albedo = vec3f(.020, .021, .024) * (.7 + .5 * mid.height); gloss = .7; bump = .12;
    }
    case SCREEN: {
      albedo = vec3f(.003, .006, .008); gloss = .95; bump = 0.;
      if (p.y > .3) {
        // the dive computer: depth in metres to one decimal, a bar for the air that is left, a ring
        let uv = (p.xy - vec2f(0., WRIST - .1)) / vec2f(.0165, .021);
        let depth = clamp(-frame.camPos.y, 0., 99.9);
        let number = sevenSegment((uv - vec2f(-.92, .0)) / vec2f(.5, .85), i32(depth / 10.)) + sevenSegment((uv - vec2f(-.36, .0)) / vec2f(.5, .85), i32(depth) % 10)
          + sevenSegment((uv - vec2f(.38, .0)) / vec2f(.5, .85), i32(depth * 10.) % 10) + step(length(uv - vec2f(.26, .06)), .055);
        let bar = step(abs(uv.y + .52), .1) * step(abs(uv.x + .1), .78) * (.25 + .75 * step(uv.x, .32)) * step(.12, fract(uv.x * 5.));
        let tick = step(abs(uv.y + .82), .035) * step(abs(uv.x), .88);
        glow = vec3f(.10, .85, .72) * (min(number, 1.) * .9 + bar * .55 + tick * .25) + vec3f(.004, .022, .020);
      } else {
        // the scooter's gauge: a row of battery bars
        let uv = (p.xy - vec2f(0., .12)) / vec2f(.016, .022);
        glow = vec3f(.15, .9, .35) * step(abs(uv.x), .7) * step(abs(fract(uv.y * 2.5 + .5) - .5), .3) * step(uv.y, .45) + vec3f(.004, .02, .008);
      }
    }
    case PAINT: {
      // the scooter's shell: yellow paint, scratched through to a darker undercoat and to metal
      let scratch = smoothRamp(.62, .7, mid.mottle * .5 + micro.mottle * .6);
      albedo = mix(vec3f(.92, .47, .02), vec3f(.46, .25, .04), wear * .7) * (.8 + .3 * mid.height);
      albedo = mix(albedo, vec3f(.32, .34, .36), scratch * .6);
      // a black stripe along each flank
      albedo = mix(albedo, vec3f(.02), smoothRamp(.009, .007, abs(abs(p.z) - .0)) * smoothRamp(.05, .06, abs(p.x)) * step(-.08, p.y) * step(p.y, .18));
      gloss = mix(.8, .35, wear); bump = .2;
    }
    case TRIM: {
      albedo = mix(vec3f(.024, .026, .030), vec3f(.07, .075, .08), wear * .5) * (.6 + .7 * mid.height); gloss = .5; bump = .5; // ring, struts, handles
    }
    case LAMP: {
      albedo = vec3f(.5, .55, .6); gloss = .95; glow = vec3f(1.6, 1.5, 1.2);
    }
    default: {
      albedo = vec3f(.055, .06, .065) * (.6 + .7 * mid.height); gloss = .65; bump = .3; // propeller
    }
  }

  // ---- the lit surface: the sculpted normal, tilted by the relief's slope and by the grain, both worked out
  // on the bind pose and then carried to where the bones have put the surface
  let e = .0006; let h0 = relief(p, material, fine);
  let slope = vec3f(relief(p + vec3f(e, 0., 0.), material, fine), relief(p + vec3f(0., e, 0.), material, fine), relief(p + vec3f(0., 0., e), material, fine)) - h0;
  var nb = n0 - (slope - n0 * dot(slope, n0)) / e;
  nb = normalize(nb) + (mid.slope * .55 + micro.slope * .5 * fine + broad.slope * .25) * bump;
  let ax = normalize(v.axisX); let ay = normalize(v.axisY - ax * dot(v.axisY, ax));
  let N0 = normalize(ax * n0.x + ay * n0.y + cross(ax, ay) * n0.z);
  let N = normalize(ax * nb.x + ay * nb.y + cross(ax, ay) * nb.z);

  let zone = zoneAt(v.world);
  let caustic = caustics(v.world, dist);
  let room = volume(v.world);
  let open = clamp01((room.r - .5) * 2.7);
  // the shape's own shadowing, from the bake, deepened in the grooves of the relief
  let ao = mix(.1, 1., v.open * v.open) * clamp(1. + h0 * 500., .55, 1.1);
  let sun = sunlight(v.world.y, zone) * shadow9(v.world + N0 * .2);
  let ndl = clamp01(dot(N, L));
  // the sun wraps a short way round: these are small rounded things seen from a hand's breadth away
  let wrap = clamp01(dot(N, L) * .8 + .2);
  let direct = sun * wrap * (.10 + mix(vec3f(.33), caustic, smoothRamp(.1, .45, dot(N0, L))) * 2.5) * mix(.4, 1., ao);
  // (the sky is never quite shut out for the body: under an overhang the rock around the swimmer goes dark, but
  // the mask, the suit and the water in front of the face still throw some light back on the hands)
  let sky = max(room.g, .62);
  let ambientLight = (ambient(v.world, N, sky, zone) + sideGlow(v.world, N, max(open, .35), zone)) * ao;
  var c = albedo * (direct + ambientLight);
  let H = normalize(V + L);
  c += sun * (.25 + caustic) * pow(clamp01(dot(N, H)), mix(8., 110., gloss)) * gloss * ndl * 2. * ao;
  // the water all around, mirrored at grazing angles: what makes wet rubber and paint look wet
  let rim = pow(1. - clamp01(dot(N, V)), 3.);
  let R = reflect(-V, N);
  let mirrored = ambient(v.world, R, sky, zone) + sideGlow(v.world, R, max(open, .35), zone);
  c += mirrored * (.05 + gloss * .9) * (.04 + .96 * rim) * ao;
  // cloth catches light along its edges, where the fibres stand up
  c += albedo * (sun * (.3 + .7 * ndl) + ambientLight) * sheen * rim * 1.2;

  // tiny bubbles cling to the suit and the glove: bright beads, each with a glint from the sun
  let q = vec2f(around * max(length(p.xz), .02) + p.y * .37, p.y) * 240.; let id = floor(q);
  let centre = vec2f(hash2(id + 7.), hash2(id + 13.)) * .5 + .25; let size = .07 + .12 * hash2(id + 3.);
  let off = fract(q) - centre;
  let bead = step(.8, hash2(id)) * smoothRamp(size, size * .55, length(off)) * bubbly * fine * smoothRamp(.2, .7, mid.mottle + n0.z * .3 + .2);
  c = mix(c, mirrored * .9 + sun * (.1 + 2.5 * smoothRamp(size * .45, 0., length(off - vec2f(-.3, .3) * size))), bead * .85);

  c += glow;
  return hdrOutput(applyFog(c, v.world, zone));
}
