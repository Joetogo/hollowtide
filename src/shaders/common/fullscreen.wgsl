// One triangle that covers the screen, built from the vertex index alone: draw(3) with no vertex buffer.
@vertex
fn fullscreenVertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  return vec4f(f32(i32(index & 1u) * 4 - 1), f32(i32(index >> 1u) * 4 - 1), 0., 1.);
}
