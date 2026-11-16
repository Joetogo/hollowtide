// What a surface of the swimmer's body or gear is made of.

/** What a surface is made of: the numbers shaders/body.wgsl knows. */
export const MATERIAL = {
  neoprene: 0,
  fabric: 1, // the back of the glove
  rubber: 2, // its palm and fingertips
  armour: 3, // the pads over the knuckles and fingers
  strap: 4,
  computer: 5,
  screen: 6,
  paint: 7,
  trim: 8,
  lamp: 9,
  blades: 10,
  suit: 11, // the wetsuit below the arms: legs and hips
} as const;
