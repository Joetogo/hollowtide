#include "common/scene.wgsl"

// Solid meshes: the terrain, rocks, the ship, the whale tail, sponges and corals. One mesh vertex format and one
// instance format for all of them; the terrain is drawn as a single identity instance.

struct SolidVertex {
  @location(0) position: vec3f, // in the mesh's own space
  @location(1) normal: vec4f, // xyz, and baked ambient occlusion in w
  // per instance
  @location(2) placement: vec4f, // world position, uniform scale
  @location(3) rotation: vec4f, // unit quaternion
  @location(4) material: vec4f, // x material id, y random seed, z distance at which small rocks vanish (rock) or texture scale (others), w bob height
}
struct SolidVarying {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) objectPosition: vec3f, // scaled and offset per instance, so the rock texture sticks to each rock
  @location(3) objectNormal: vec3f,
  @location(4) @interpolate(flat) material: vec4f,
  @location(5) @interpolate(flat) rotation: vec4f,
  @location(6) ao: f32,
}

// also the vertex shader of the shadow bake, where frame.res.x is 0
@vertex
fn solidVertex(v: SolidVertex) -> SolidVarying {
  var o: SolidVarying;
  var scale = v.placement.w;
  // small rocks shrink to nothing as they near their draw distance, instead of popping (not in the shadow bake)
  if (v.material.x < 1.5 && v.material.z > 1.5 && frame.res.x > 0.) { scale *= 1. - smoothRamp(v.material.z * .7, v.material.z, distance(v.placement.xyz, frame.camPos) / frame.detail); }
  var world = v.placement.xyz + rotate(v.rotation, v.position * scale);
  world.y += sin(frame.time * .3 + v.material.y * 40.) * v.material.w; // floating boulders bob
  o.clip = frame.viewProj * vec4f(world, 1.); o.world = world; o.normal = rotate(v.rotation, v.normal.xyz); o.objectPosition = v.position * v.placement.w + v.material.y * 37.; o.objectNormal = v.normal.xyz;
  o.material = v.material; o.rotation = v.rotation; o.ao = v.normal.w;
  return o;
}
