#include "common/scene.wgsl"

// Fish and manta rays. Nothing is simulated: every animal's position, heading and body motion is a closed-form
// function of time, evaluated in the vertex shader from one small instance.

struct CreatureVertex {
  @location(0) position: vec3f, // in the animal's own space
  @location(1) normal: vec4f, // xyz, and for the manta its signed position along the wingspan in w
  // per instance
  @location(2) orbit: vec4f, // centre of the path, radius
  @location(3) motion: vec4f, // fish: seed, angular speed (sign = direction), size, school phase
                              // manta: phase, angular speed, size, second phase
}
struct CreatureVarying {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) objectPosition: vec3f,
  @location(3) @interpolate(flat) seed: f32,
  @location(4) light: f32, // sun shadow, sampled per vertex for fish
}

// Not in the original (0 there): within this many metres of the swimmer a school opens to let them through.
override PART: f32 = 0.;

// a fish: model x = forward, y = up, z = sideways
@vertex
fn fishVertex(v: CreatureVertex) -> CreatureVarying {
  var o: CreatureVarying;
  let s = v.motion.x; let h = vec3f(sineHash(s), sineHash(s + .37), sineHash(s + .71));
  let R = v.orbit.w; let t = frame.time;
  // the school circles an ellipse, rising and falling three times a lap; each fish is a little ahead or behind
  let angle = t * v.motion.y + v.motion.w * 6.3 + (h.x - .5) * (26. / R);
  let phase = v.motion.w * 17.;
  let P = v.orbit.xyz + vec3f(R * cos(angle), 2.2 * sin(3. * angle + phase), R * .6 * sin(angle));
  let T = normalize(vec3f(-R * sin(angle), 6.6 * cos(3. * angle + phase), R * .6 * cos(angle))) * sign(v.motion.y);
  let S = normalize(cross(vec3f(0., 1., 0.), T)); let Up = cross(T, S);
  // its own place in the school, wandering slowly
  let offset = S * ((h.y - .5) * 5. + sin(t * .6 + s * 40.) * .5) + Up * ((h.z - .5) * 3.2 + cos(t * .5 + s * 31.) * .4);
  var l = v.position * v.motion.z * (.75 + .5 * h.z);
  l.z += sin(t * 9. + s * 50. + l.x * 5.) * .22 * (.25 * v.motion.z - l.x); // tail beat, growing towards the tail
  var place = P + offset;
  if (PART > 0.) {
    // a fish at distance d from the eye is moved out along the line from it to d + (PART - d)^2 * .45 / PART:
    // none is left within .45 PART, the order of the fish along any line is kept, and at PART nothing moves
    let away = place - frame.camPos; let d = length(away); let gap = max(PART - d, 0.);
    place += away / max(d, .001) * (gap * gap * .45 / PART);
  }
  let world = place + T * l.x + Up * l.y + S * l.z;
  o.clip = frame.viewProj * vec4f(world, 1.); o.world = world; o.normal = T * v.normal.x + Up * v.normal.y + S * v.normal.z; o.objectPosition = v.position; o.seed = s;
  o.light = shadow1(world);
  return o;
}

@fragment
fn fishFragment(v: CreatureVarying) -> @location(0) vec4f {
  let n = normalize(v.normal); let L = frame.sunDir; let V = normalize(frame.camPos - v.world);
  let zone = zoneAt(v.world); let around = volume(v.world);
  // pale belly, dark back; one fish in seven is tinted yellow
  var albedo = mix(vec3f(.50, .68, .80), vec3f(.10, .22, .40), smoothRamp(-.05, .2, v.objectPosition.y));
  albedo = mix(albedo, vec3f(.95, .8, .3), step(.86, fract(v.seed * 7.7)) * .6);
  let sun = sunlight(v.world.y, zone) * v.light;
  var c = albedo * (sun * (.25 + .75 * clamp01(dot(n, L))) + ambient(v.world, n, around.g, zone) * 1.3);
  c += sun * pow(clamp01(dot(n, normalize(V + L))), 24.) * 1.6 + vec3f(.3, .6, .7) * pow(1. - clamp01(dot(n, V)), 3.) * .25 * around.g;
  // in the lamp a fish flashes silver
  let lit = lampLight(v.world, n);
  c += lit * (albedo + pow(clamp01(dot(n, normalize(V + normalize(lamp.pos - v.world)))), 16.) * 1.2);
  return hdrOutput(applyFog(c, v.world, zone));
}

// a manta: model x = along the wingspan, y = up, z = forward
@vertex
fn mantaVertex(v: CreatureVertex) -> CreatureVarying {
  var o: CreatureVarying;
  let t = frame.time; let R = v.orbit.w; let size = v.motion.z;
  let angle = t * v.motion.y + v.motion.x;
  let P = v.orbit.xyz + vec3f(R * cos(angle), 2.5 * sin(2. * angle + v.motion.w), R * .75 * sin(angle));
  let T = normalize(vec3f(-R * sin(angle), 5. * cos(2. * angle + v.motion.w) * 1., R * .75 * cos(angle))) * sign(v.motion.y);
  var S = normalize(cross(vec3f(0., 1., 0.), T)); var Up = cross(T, S);
  // banked into the turn
  let bank = -.28 * sign(v.motion.y);
  let S2 = S * cos(bank) + Up * sin(bank); Up = Up * cos(bank) - S * sin(bank); S = S2;
  // the wing beat is a wave travelling out along the span, larger towards the tips
  let u = v.normal.w; let span = abs(u);
  let beat = t * 1.25 + v.motion.w * 5. - span * 1.2;
  let amplitude = .36 * pow(span, 1.6);
  var l = v.position;
  l.y += amplitude * sin(beat) - .1 * sin(t * 1.25 + v.motion.w * 5.);
  let tail = smoothRamp(-.5, -1.9, l.z) * step(span, .001);
  l.x += tail * sin(t * .8 + l.z * 2.) * .12;
  // the normal follows the wing's slope (the derivative of the displacement above)
  let slope = (.576 * pow(span, .6) * sin(beat) - .43 * pow(span, 1.6) * cos(beat)) * sign(u);
  let bent = normalize(vec3f(v.normal.x - slope * v.normal.y, v.normal.y + slope * v.normal.x, v.normal.z));
  let world = P + (S * l.x + Up * l.y + T * l.z) * size;
  o.clip = frame.viewProj * vec4f(world, 1.); o.world = world; o.normal = S * bent.x + Up * bent.y + T * bent.z; o.objectPosition = v.position; o.seed = v.motion.w;
  o.light = 1.;
  return o;
}

@fragment
fn mantaFragment(v: CreatureVarying) -> @location(0) vec4f {
  let dist = length(v.world - frame.camPos);
  let caustic = caustics(v.world, dist);
  let skin = textureSample(detailTexture, repeatSampler, v.objectPosition.xz * .9 + v.seed);
  let n = normalize(v.normal + (vec3f(skin.r, 0., skin.g) - vec3f(.5, 0., .5)) * .5); let L = frame.sunDir; let V = normalize(frame.camPos - v.world);
  let zone = zoneAt(v.world); let around = volume(v.world);
  let top = smoothRamp(-.2, .25, normalize(v.normal).y);
  let span = abs(v.objectPosition.x);
  // pale belly with gill slits and dark wing tips; dark back with pale shoulder patches
  let gill = smoothRamp(.25, .0, abs(span - .13) * 8.) * smoothRamp(.04, .12, v.objectPosition.z) * smoothRamp(.34, .26, v.objectPosition.z) * smoothRamp(.2, .8, sin(v.objectPosition.z * 110.));
  var belly = vec3f(.13, .17, .21) * (.6 + .6 * skin.b) * (1. - .7 * gill);
  belly = mix(belly, vec3f(.05, .08, .11), clamp01(smoothRamp(.45, .9, span + skin.a * .35) + smoothRamp(-.1, -.4, v.objectPosition.z + skin.b * .2) * .7));
  var back = vec3f(.04, .065, .10) + vec3f(.10, .16, .2) * smoothRamp(.5, .75, skin.a);
  back = mix(back, vec3f(.36, .46, .52), smoothRamp(.25, .0, abs(span - .26) * 3.5 + abs(v.objectPosition.z - .12) * 5.) * .8);
  var albedo = mix(belly, back, top);
  let sun = sunlight(v.world.y, zone) * shadow4(v.world + n * .3);
  let ndv = clamp01(dot(n, V));
  let iridescence = .5 + .5 * cos(TAU * (vec3f(0., .33, .67) + ndv * 1.1 + skin.a * 1.5 + .55));
  let fillNormal = vec3f(n.x, abs(n.y) * .55 + .25, n.z);
  var c = albedo * (sun * clamp01(dot(n, L)) * (.3 + caustic) + ambient(v.world, fillNormal, around.g, zone) * 1.1 + sideGlow(v.world, n, 1., zone) * .8);
  c += iridescence * vec3f(.35, .16, .6) * (.07 + .22 * skin.b) * (.4 + sun.g * .2 * caustic.g) * (1. - top * .3);
  c += sun * pow(clamp01(dot(n, normalize(V + L))), 30.) * .5 * (.3 + caustic);
  let sky = ambient(v.world, vec3f(0., 1., 0.), around.g, zone);
  c += albedo * sky * caustic * .45 * (1. - top) + sky * pow(1. - ndv, 3.) * .35;
  c += albedo * lampLight(v.world, n) * 1.5;
  return hdrOutput(applyFog(c, v.world, zone));
}
