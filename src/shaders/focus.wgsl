#include "common/fullscreen.wgsl"
#include "common/math.wgsl"

// A photograph's depth of field: the lens is held at one distance, and what is nearer or further is spread over
// a disc, the wider the further from it. `frame`, `linearSampler`, `sceneTexture` (the finished scene),
// `halfTexture` (the same at half the size each way), `depthTexture` and `focusTexture` (one texel: the distance
// the lens is held at) come from the Focus group.

fn distanceAt(pixel: vec2i) -> f32 {
  return frame.near / max(textureLoad(depthTexture, clamp(pixel, vec2i(0), vec2i(frame.res) - 1), 0), 1e-6);
}

// how far away the middle of the picture is: written to the one texel that `soften` reads the lens's distance from
@fragment
fn latch(@builtin(position) position: vec4f) -> @location(0) vec4f {
  return vec4f(min(distanceAt(vec2i(frame.res * .5)), 1e4), 0., 0., 1.);
}

// The widest disc, as a share of the picture's height (so a picture saved at twice the size is as soft).
const WIDEST = .011;

// The radius in pixels of the disc that a point `d` metres away is spread over, with the lens held at `held`:
// a thin lens, for which it goes with the difference of the two distances' inverses. Held close, the far
// distance is very soft; held far, nearly everything is sharp.
fn spread(d: f32, held: f32) -> f32 { return min(abs(1. / held - 1. / d) * .03, WIDEST) * frame.res.y; }

@fragment
fn soften(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let held = textureLoad(focusTexture, vec2i(0), 0).r;
  let here = distanceAt(vec2i(position.xy));
  let own = spread(here, held);
  let widest = WIDEST * frame.res.y;
  // Taps on a spiral over the widest disc, as many as keep them some four pixels apart: they are read from the
  // half-size picture, which fills in what lies between. Each pixel turns the spiral by another angle.
  let taps = clamp(widest * widest * .18, 24., 128.);
  let turn = interleavedGradientNoise(position.xy) * 6.2832;
  var sum = textureLoad(sceneTexture, vec2i(position.xy), 0).rgb;
  var count = 1.;
  for (var i = 0.; i < taps; i += 1.) {
    let radius = sqrt((i + .5) / taps) * widest;
    let angle = i * 2.39996 + turn;
    let at = position.xy + vec2f(cos(angle), sin(angle)) * radius;
    let there = distanceAt(vec2i(at));
    var size = spread(there, held);
    // what lies behind this point is not spread over it by more than the point is soft itself: a sharp thing
    // in front keeps its edge
    if (there > here) { size = min(size, own * 2.); }
    // a tap counts if its own disc reaches this far; one that does not leaves the average as it is
    let reach = smoothstep(radius - .5, radius + .5, size);
    sum += mix(sum / count, textureSampleLevel(halfTexture, linearSampler, at * frame.invRes, 0.).rgb, reach);
    count += 1.;
  }
  return vec4f(sum / count, 1.);
}
