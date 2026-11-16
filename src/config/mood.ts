// Moods: the same world in another light. A mood scales the sun's own light and the daylight the water scatters,
// each by a colour, says how much living things shine by themselves, and how far the eye opens. Noon is the
// light the world was made for: every number 1 and no glow, and with it the shaders are exactly what they were.
//
// The sun stays where it is in every mood: the caustics and the baked shadows are made for that direction.

export interface Mood {
  readonly name: 'noon' | 'dusk' | 'moon';
  /** what the menu calls it */
  readonly label: string;
  /** the sun's light, by colour */
  readonly sun: readonly [number, number, number];
  /** daylight scattered by the water: the haze, the light from all around, the sky through the surface */
  readonly sky: readonly [number, number, number];
  /** how much jellyfish, glints and the glowing plants shine by themselves (0: only as they are lit) */
  readonly glow: number;
  /** how far the eye opens, as a multiple of noon's exposure */
  readonly exposure: number;
}

export const NOON: Mood = { name: 'noon', label: 'Noon', sun: [1, 1, 1], sky: [1, 1, 1], glow: 0, exposure: 1 };
/**
 * A low sun: red and gold near the surface, violet below. (Water takes the red out of light within a few tens
 * of metres, so for any warmth to reach the seabed the sun has to be far redder than a sunset is in air.)
 */
export const DUSK: Mood = {
  name: 'dusk',
  label: 'Dusk',
  sun: [2.4, 0.36, 0.6],
  sky: [1.8, 0.38, 0.62],
  glow: 0.35,
  exposure: 1.15,
};
/** Moonlight: a twentieth of the day's light, cold, and what lives here shining in it. */
export const MOON: Mood = {
  name: 'moon',
  label: 'Moonlit',
  sun: [0.09, 0.14, 0.24],
  sky: [0.03, 0.06, 0.15],
  glow: 1,
  exposure: 1.9,
};

export const MOODS: readonly Mood[] = [NOON, DUSK, MOON];
export const moodNamed = (name: unknown): Mood => MOODS.find((mood) => mood.name === name) ?? NOON;

/** A number as WGSL writes one. */
const wgsl = (value: number) => (Number.isInteger(value) ? value + '.' : String(value));
const vec3 = (v: readonly number[]) => `vec3f(${v.map(wgsl).join(', ')})`;

/**
 * A shader's source in a mood: the three constants of shaders/common/optics.wgsl rewritten. Noon's source is
 * returned as it came. Throws if a source that has the constants does not have them in the form expected, so
 * that a mood can never be silently ignored.
 */
export function inMood(source: string, mood: Mood): string {
  if (mood === NOON || !source.includes('MOOD_SUN')) return source;
  let found = 0;
  const set = (name: string, value: string) => {
    source = source.replace(new RegExp(`const ${name}\\s*=[^;]*;`), () => {
      found++;
      return `const ${name} = ${value};`;
    });
  };
  set('MOOD_SUN', vec3(mood.sun));
  set('MOOD_SKY', vec3(mood.sky));
  set('MOOD_GLOW', wgsl(mood.glow));
  if (found !== 3) throw new Error('a shader has the mood constants in a form that cannot be rewritten');
  return source;
}
