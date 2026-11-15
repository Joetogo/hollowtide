// One triangle that covers the screen, built from the vertex index alone: draw(3) with no vertex buffer.
struct FullscreenOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f, // (0, 0) at the top left
}

@vertex
fn fullscreenVertex(@builtin(vertex_index) index: u32) -> FullscreenOutput {
  let corner = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  return FullscreenOutput(vec4f(corner * 2.0 - 1.0, 0.0, 1.0), vec2f(corner.x, 1.0 - corner.y));
}
