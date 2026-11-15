#include "common/noise.wgsl"

// The terrain as a density field: positive inside rock, negative in water, roughly in metres from the surface.
// Evaluated once for every voxel of the grid when the page loads; the CPU reads it back, removes floating specks
// and turns it into the terrain mesh, the collision data and the placement rules for everything else.
//
// The shapes come from the hand-authored layout (src/world/layout.ts), two vec4f each, in this order:
//   rock masses   a = footprint segment (x0, z0, x1, z1)   b = radius, top y, overhang, waist
//   arches        a = centre xyz, yaw                      b = ring radius, tube radius, vertical squash
//   tunnels       a = start xyz, radius                    b = end xyz
//   clearings     a = segment (x0, z0, x1, z1)             b = radius, softness
struct DensityParams {
  size: vec4u, // voxels along x, y, z
  origin: vec4f, // world position of voxel 0, and the voxel size in w
  counts: vec4u, // rock masses, arches, tunnels, clearings
}
@group(0) @binding(0) var<uniform> params: DensityParams;
@group(0) @binding(1) var<storage, read_write> density: array<f32>;
@group(0) @binding(2) var<storage, read> shapes: array<vec4f>;

// max and min that round the crease where two shapes meet, over a width of k
fn smoothMax(a: f32, b: f32, k: f32) -> f32 { let h = max(k - abs(a - b), 0.) / k; return max(a, b) + h * h * k * .25; }
fn smoothMin(a: f32, b: f32, k: f32) -> f32 { return -smoothMax(-a, -b, k); }
// distance from p to the segment a-b
fn segment2(p: vec2f, a: vec2f, b: vec2f) -> f32 { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0., 1.); return length(pa - ba * h); }
fn segment3(p: vec3f, a: vec3f, b: vec3f) -> f32 { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0., 1.); return length(pa - ba * h); }

fn densityAt(p: vec3f) -> f32 {
  // everything is evaluated at a position bent by low-frequency noise, so nothing comes out straight
  let warp = vec3f(fbm(p * .04 + 11., 3), fbm(p * .04 + 47., 3), fbm(p * .04 + 83., 3)) - .5;
  let q = p + warp * vec3f(15., 6., 15.);
  // the seabed: about 45 m down, rolling
  let ground = -45.5 + 7. * (fbm(vec3f(q.xz * .011, 3.), 4) - .5) + 1.6 * (fbm(vec3f(q.xz * .07, 9.), 3) - .5);
  let terrace = 3. * (fbm(vec3f(q.xz * .09, 2.), 3) - .5);
  // the designed rock masses: walls and pillars over a footprint segment, flaring at the top, with an apron at
  // the base and a pinched waist
  var masses = -1e3; var edge = 1e3;
  var k = 0u;
  for (var i = 0u; i < params.counts.x; i++) {
    let a = shapes[k]; let b = shapes[k + 1u]; k += 2u;
    let yr = clamp((p.y - ground) / (b.y - ground), 0., 1.3);
    var e = segment2(q.xz, a.xy, a.zw) - b.x;
    e -= b.z * smoothRamp(.3, .92, yr) + 3. * (1. - yr) * (1. - yr) - b.w * smoothRamp(.0, .5, yr) * (1. - smoothRamp(.5, 1., yr));
    masses = smoothMax(masses, smoothMin(-e, b.y + terrace - p.y, 3.), 2.5);
    edge = min(edge, e);
  }
  // clearings keep the random plateaus below out of the designed places
  var clearing = 0.;
  let firstClearing = (params.counts.x + params.counts.y + params.counts.z) * 2u;
  for (var i = 0u; i < params.counts.w; i++) {
    let a = shapes[firstClearing + i * 2u]; let b = shapes[firstClearing + i * 2u + 1u];
    clearing = max(clearing, 1. - smoothRamp(0., b.y, segment2(q.xz, a.xy, a.zw) - b.x));
  }
  // random plateaus elsewhere, and a ring of tall rock that closes the world off at about 160 m
  let radius = length(p.xz) + warp.x * 14.;
  let n = fbm(vec3f(q.xz * .0125, 1.7), 4);
  let ring = smoothRamp(156., 172., radius);
  let plateau = max(smoothRamp(.5, .565, n) * (1. - clearing), ring);
  let top = ground + plateau * mix(26. + 17. * fbm(vec3f(q.xz * .03, 5.), 2), 60., ring);
  var d = smoothMax(ground + 4.5 * smoothRamp(10., 0., edge) - p.y, masses, 3.); // scree piles up against the masses
  d = smoothMax(d, (top - p.y) * .7, 3.);
  // arches: upright rings of rock
  k = params.counts.x * 2u;
  for (var i = 0u; i < params.counts.y; i++) {
    let a = shapes[k]; let b = shapes[k + 1u]; k += 2u;
    var r = p + warp * 3. - a.xyz;
    let cs = cos(a.w); let sn = sin(a.w);
    r = vec3f(cs * r.x + sn * r.z, r.y / b.z, -sn * r.x + cs * r.z);
    d = smoothMax(d, b.y - length(vec2f(length(r.xy) - b.x, r.z)), 1.5);
  }
  // rock texture, stronger away from the seabed: two scales of cells, some noise, and horizontal strata
  let aboveGround = p.y - ground;
  let rough = mix(.25, 1., smoothRamp(.5, 5., aboveGround));
  d += rough * ((.5 - worley(p * .17 + warp * 2.)) * 3.4 + (.5 - worley(p * .41 + 7.)) * 1.3 + (fbm(p * .3, 3) - .5) * 2.2);
  d += rough * 2.2 * (abs(fract(p.y * .21 + warp.y * 2.2) - .5) - .25);
  // tunnels are carved last, through everything
  for (var i = 0u; i < params.counts.z; i++) {
    let a = shapes[k]; let b = shapes[k + 1u]; k += 2u;
    d = smoothMin(d, segment3(p + warp * 2., a.xyz, b.xyz) - a.w, 2.);
  }
  return min(d, 3. - p.y); // no rock above 3 m over the surface
}

@compute @workgroup_size(4, 4, 4)
fn fill(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= params.size.xyz)) { return; }
  var d = densityAt(params.origin.xyz + vec3f(id) * params.origin.w);
  // the sides and the top of the grid are water, so the terrain mesh is closed there
  if (id.x == 0u || id.z == 0u || id.x == params.size.x - 1u || id.z == params.size.z - 1u || id.y == params.size.y - 1u) { d = -1.; }
  density[id.x + params.size.x * (id.y + params.size.y * id.z)] = d;
}
