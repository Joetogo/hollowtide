#include "common/fullscreen.wgsl"

// A 3 x 3 blur of the half-resolution light shafts that hides their sampling dither. Each tap is weighted by how
// close its depth (in alpha) is to the centre's, so the blur stops at silhouettes. `shaftsTexture` comes from the
// ShaftsBlur group.
@fragment
fn blurShafts(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let pixel = vec2i(position.xy); let last = vec2i(textureDimensions(shaftsTexture)) - 1;
  let centre = textureLoad(shaftsTexture, pixel, 0);
  var acc = vec3f(0.); var weightSum = 0.;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let tap = textureLoad(shaftsTexture, clamp(pixel + vec2i(x, y) , vec2i(0), last), 0);
    let weight = 1. / (.03 + abs(tap.a - centre.a) / centre.a);
    acc += tap.rgb * weight; weightSum += weight;
  } }
  return vec4f(acc / weightSum, centre.a);
}
