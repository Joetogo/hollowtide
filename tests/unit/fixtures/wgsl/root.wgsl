#include "a.wgsl"
#include "lib/shared.wgsl"
fn root() -> f32 { return a() + shared(); }
