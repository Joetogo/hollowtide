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

// The rock detail texture sampled along the three axes and blended by how much the surface faces each
// (triplanar): no texture coordinates needed, and no stretching on steep faces.
struct Triplanar { height: f32, mottle: f32, slope: vec3f }
fn triplanar(p: vec3f, n: vec3f, scale: f32) -> Triplanar {
  var w = pow(abs(n), vec3f(4.)); w /= (w.x + w.y + w.z);
  let x = textureSample(detailTexture, repeatSampler, p.zy * scale); let y = textureSample(detailTexture, repeatSampler, p.xz * scale); let z = textureSample(detailTexture, repeatSampler, p.xy * scale);
  var o: Triplanar;
  o.height = x.b * w.x + y.b * w.y + z.b * w.z;
  o.mottle = x.a * w.x + y.a * w.y + z.a * w.z;
  let a = x.rg * 2. - 1.; let b = y.rg * 2. - 1.; let c = z.rg * 2. - 1.;
  o.slope = vec3f(0., a.y, a.x) * w.x + vec3f(b.x, 0., b.y) * w.y + vec3f(c.x, c.y, 0.) * w.z;
  return o;
}

@fragment
fn solidFragment(v: SolidVarying, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  // material: 0 terrain, 1 rock, 2 whale tail, 3 ship wood, 4 sponge, 5 and up coral
  let material = i32(v.material.x + .5); let seed = v.material.y; let facing = select(-1., 1., front);
  let objectNormal = normalize(v.objectNormal) * facing; let normal0 = normalize(v.normal) * facing;
  let dist = length(v.world - frame.camPos);
  let textureScale = select(1., v.material.z, material >= 2);
  // the detail texture at four scales, from boulder-sized to pebble-sized; the finest only on rock within 10 m.
  // Every tap sits outside the material branches: implicit-derivative sampling needs uniform control flow.
  let broad = triplanar(v.objectPosition, objectNormal, .1 * textureScale); let medium = triplanar(v.objectPosition, objectNormal, .43 * textureScale); let fine = triplanar(v.objectPosition, objectNormal, 1.9 * textureScale); let micro = triplanar(v.objectPosition, objectNormal, 6.7 * textureScale); let microFade = smoothRamp(10., 1.5, dist) * f32(material <= 1);
  let wood = textureSample(detailTexture, repeatSampler, vec2f(v.objectPosition.x * .06, (v.objectPosition.y + v.objectPosition.z) * .7));
  let patch1 = textureSample(detailTexture, repeatSampler, v.objectPosition.xz * .013 + v.objectPosition.y * .021).a;
  let patch2 = textureSample(detailTexture, repeatSampler, v.objectPosition.zx * .031 + v.objectPosition.y * .043 + .37).a;
  var groove = 0.;
  let streak = textureSample(detailTexture, repeatSampler, vec2f((v.objectPosition.x + v.objectPosition.z) * .33, v.objectPosition.y * .035));
  let streak2 = textureSample(detailTexture, repeatSampler, vec2f((v.objectPosition.x - v.objectPosition.z) * 1.1, v.objectPosition.y * .11));
  let ground = textureSample(groundMap, clampSampler, v.world.xz / 384. + .5);
  let caustic = caustics(v.world, dist);
  let height = broad.height * .5 + medium.height * .35 + fine.height * .15;
  var bump = 1.7; var gloss = .1; var albedo = vec3f(0.); var emissive = vec3f(0.); var vertexAo = 1.; var fluorescence = 0.;
  let flatness = smoothRamp(.72, .93, normal0.y);
  if (material <= 1) {
    // layered rock: grey / olive / brown beds, warm encrustation patches, algae on up-facing parts
    let strata = v.objectPosition.y * .55 + broad.height * 1.6 + patch1 * 5. + patch2 * 3.;
    let bed = sineHash(floor(strata)); let within = fract(strata);
    albedo = mix(vec3f(.11, .12, .13), vec3f(.33, .30, .25), clamp01(broad.mottle * 1.5 - .25));
    albedo = mix(albedo, mix(vec3f(.26, .19, .10), vec3f(.20, .22, .14), bed), smoothRamp(.42, .66, patch1) * .7);
    albedo *= mix(.72, 1.15, bed) * (1. - .45 * smoothRamp(.12, .0, within) * (1. - abs(objectNormal.y)));
    let encrusted = smoothRamp(.46, .6, patch2 * .6 + medium.mottle * .5) * smoothRamp(.3, .6, height);
    albedo = mix(albedo, mix(vec3f(.34, .07, .10), vec3f(.40, .25, .07), smoothRamp(.45, .6, broad.mottle)) * (.5 + .8 * medium.height), encrusted * .75);
    albedo = mix(albedo, vec3f(.50, .50, .46) * (.5 + .7 * fine.height), smoothRamp(.60, .70, medium.mottle * .6 + fine.mottle * .5) * .5);
    let algae = smoothRamp(-.1, .6, normal0.y) * smoothRamp(.3, .52, medium.mottle * .55 + patch1 * .5);
    albedo = mix(albedo, vec3f(.035, .14, .07), algae * .8);
    albedo *= (.22 + 1.3 * height) * mix(1., .62 + .76 * micro.height, microFade);
    groove = -smoothRamp(.14, .0, within) * (1. - abs(objectNormal.y)) * 1.2;
    if (material == 0) {
      // the seabed: pale sediment on flat ground, magenta growth in the deep, a purple cast inside the grotto
      albedo = mix(albedo, vec3f(.13, .15, .14) * (.55 + .6 * medium.height), flatness * ground.a * .7);
      let magenta = flatness * clamp01(ground.r * 1.5 - .45 + (medium.mottle - .5) * 1.6) * smoothRamp(.35, .6, broad.height) * smoothRamp(-34., -40., v.world.y);
      albedo = mix(albedo, vec3f(.20, .02, .12) * (.4 + .9 * medium.height), magenta * .8);
      fluorescence = magenta * .35;
      albedo = mix(albedo, albedo * vec3f(.85, .8, 1.4) + vec3f(.015, .0, .05), ground.b * .8);
    }
  } else if (material == 2) {
    // whale tail: smooth pale stone with dark streaks running along its length
    albedo = mix(vec3f(.42, .47, .48), vec3f(.10, .13, .15), smoothRamp(.40, .62, streak.a * .6 + streak2.b * .5)) * (.75 + .3 * medium.height);
    albedo = mix(albedo, vec3f(.60, .64, .62), smoothRamp(.62, .75, streak2.a) * .5);
    gloss = .9; bump = .3;
  } else if (material == 3) {
    // ship: planks with dark seams, running round the hull, and algae patches
    albedo = mix(vec3f(.13, .085, .05), vec3f(.36, .25, .14), wood.b) * (.6 + .5 * medium.height);
    let plank = fract(atan2(v.objectPosition.z, 2. - v.objectPosition.y) * 7.);
    albedo *= .35 + .65 * smoothRamp(0., .12, min(plank, 1. - plank));
    albedo = mix(albedo, vec3f(.08, .22, .16), smoothRamp(.5, .7, broad.mottle) * .6);
    gloss = .2; bump = .7;
  } else if (material == 4) {
    // sponges: orange to brown, a quarter of them purple
    let hue = fract(seed * 7.31);
    albedo = mix(vec3f(.60, .17, .08), vec3f(.64, .35, .10), fract(hue * 3.));
    if (hue > .75) { albedo = vec3f(.44, .18, .42); }
    albedo *= (.45 + .75 * medium.height) * (.7 + .3 * fine.height);
    vertexAo = v.ao * v.ao; gloss = .2; bump = 1.4; fluorescence = .55;
  } else {
    // corals: reds and pinks, some orange, a few violet, with pale tips
    let hue = fract(seed * 5.73);
    albedo = mix(vec3f(.80, .08, .10), vec3f(.90, .22, .40), fract(hue * 4.));
    if (hue > .7) { albedo = vec3f(.88, .42, .10); }
    if (hue > .9) { albedo = vec3f(.55, .22, .75); }
    albedo *= (.4 + .8 * medium.height) * (.5 + .9 * v.ao * v.ao);
    albedo = mix(albedo, vec3f(1., .75, .6), smoothRamp(.8, 1., v.ao) * .35);
    emissive = albedo * .01; fluorescence = .75; gloss = .25; bump = 1.5;
  }
  // sand ripples on flat seabed
  let ripple = select(0., flatness * ground.a * cos((v.world.x * .8 + v.world.z * .35) * 5. + broad.mottle * 9.) * .65, material == 0);
  let N = normalize(rotate(v.rotation, normalize(objectNormal + (broad.slope * .85 + medium.slope * .65 + fine.slope * .45 * smoothRamp(60., 12., dist) + micro.slope * .5 * microFade) * bump + vec3f(.8, groove, .35) * vec3f(ripple, 1., ripple))));
  let L = frame.sunDir; let V = normalize(frame.camPos - v.world);
  // occlusion from the baked volume, sampled a little and further out along the normal
  let near = volume(v.world + normal0 * 1.5); let far = volume(v.world + normal0 * 4.5);
  let ao = (clamp01((near.r - .5) * 8.) * .55 + clamp01((far.r - .5) * 2.7) * .45) * vertexAo * smoothRamp(.12, .6, height);
  let zone = zoneAt(v.world);
  let sun = sunlight(v.world.y, zone) * shadow9(v.world + normal0 * .35);
  let ndl = clamp01(dot(N, L));
  let ambientLight = (ambient(v.world, N, near.g, zone) + sideGlow(v.world, N, clamp01((far.r - .5) * 2.7), zone)) * ao;
  let direct = sun * ndl * (.10 + mix(vec3f(.33), caustic, smoothRamp(.1, .45, dot(normal0, L))) * 2.5);
  // fluorescence: some surfaces give back a part of the light that falls on them as their own colour
  var c = albedo * (direct + ambientLight) + emissive + albedo * fluorescence * dot(direct + ambientLight, vec3f(.1, .5, .5));
  let H = normalize(V + L);
  c += sun * (.25 + caustic) * pow(clamp01(dot(N, H)), mix(10., 70., gloss)) * gloss * ndl * 1.8;
  c += (ambient(v.world, reflect(-V, N), near.g, zone) + sideGlow(v.world, reflect(-V, N), clamp01((far.r - .5) * 2.7), zone)) * ao * (.08 + gloss) * .6 * pow(1. - clamp01(dot(N, V)), 2.5);
  return hdrOutput(applyFog(c, v.world, zone));
}
