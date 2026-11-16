import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DUSK, inMood, MOODS, MOON, moodNamed, NOON } from '../../src/config/mood';
import { loadWgsl } from '../../tools/wgsl.mjs';

const shaders = readdirSync('src/shaders').filter((name) => name.endsWith('.wgsl'));

describe('moods', () => {
  it('noon is the light the world was made for: every shader exactly as written', () => {
    expect(NOON.sun).toEqual([1, 1, 1]);
    expect(NOON.sky).toEqual([1, 1, 1]);
    expect([NOON.glow, NOON.exposure]).toEqual([0, 1]);
    for (const file of shaders) {
      const { code } = loadWgsl('src/shaders/' + file, { minify: true });
      expect(inMood(code, NOON), file).toBe(code);
    }
  });

  it('as written, the three constants are the ones that change nothing', () => {
    const { code } = loadWgsl('src/shaders/common/optics.wgsl', { minify: true });
    expect(code).toContain('const MOOD_SUN=vec3f(1.,1.,1.);');
    expect(code).toContain('const MOOD_SKY=vec3f(1.,1.,1.);');
    expect(code).toContain('const MOOD_GLOW=0.;');
  });

  it('another mood rewrites its three constants in every shader that has them, and nothing else', () => {
    let lit = 0;
    for (const file of shaders) {
      for (const minify of [true, false]) {
        const { code } = loadWgsl('src/shaders/' + file, { minify });
        const dusk = inMood(code, DUSK);
        if (!code.includes('MOOD_SUN')) {
          expect(dusk, file).toBe(code);
          continue;
        }
        lit++;
        expect(dusk, file).toMatch(/const MOOD_SUN = vec3f\(2\.4, 0\.36, 0\.6\);/);
        expect(dusk, file).toMatch(/const MOOD_SKY = vec3f\(1\.8, 0\.38, 0\.62\);/);
        expect(dusk, file).toMatch(/const MOOD_GLOW = 0\.35;/);
        // the rest of the source is untouched
        const rest = (text: string) => text.replace(/const MOOD_(SUN|SKY|GLOW)\s*=[^;]*;/g, '');
        expect(rest(dusk), file).toBe(rest(code));
        // a whole number is still written as a float
        expect(inMood(code, MOON), file).toMatch(/const MOOD_GLOW = 1\.;/);
      }
    }
    // everything that draws into the scene, and the light shafts
    expect(lit).toBeGreaterThanOrEqual(2 * 9);
  });

  it('a source with the constants in a form that cannot be rewritten is refused, not left at noon', () => {
    expect(() => inMood('const MOOD_SUN = vec3f(1.); let x = MOOD_SKY;', DUSK)).toThrow(/cannot be rewritten/);
  });

  it('a mood is found by its name, and anything else is noon', () => {
    for (const mood of MOODS) expect(moodNamed(mood.name)).toBe(mood);
    for (const name of [undefined, null, '', 'midnight', 3]) expect(moodNamed(name)).toBe(NOON);
  });
});
