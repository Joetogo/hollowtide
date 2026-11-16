// What the page remembers between visits, and how the first detail level is picked.
import { MAX_PIXELS } from '../render/dynres';
import type { Level } from './quality';
import { moodNamed } from './mood';

const KEY = 'hollowtide';
/** Set while a world is being built. Still set on the next visit, it means that load took the tab down. */
const LOADING_KEY = 'hollowtide-loading';
/** What the project's keys were before it had its name: read once, so that nothing remembered is lost. */
const OLD_KEY = 'abyssal-rebuild';

export interface Settings {
  level: Level;
  /** pixel budget the dynamic resolution settled on last time */
  pixels: number;
  /** draw-distance scale it settled on last time */
  detail: number;
  muted: boolean;
  /**
   * Swim the original's way: gliding at a steady speed, with no body in view. Off by default, unless the
   * system asks for reduced motion.
   */
  classic: boolean;
  /** how fast the view turns for a given movement of the mouse or a finger, 1 = as shipped */
  sensitivity: number;
  /** pushing the mouse forward looks down */
  invertY: boolean;
  /** 0..1 */
  volume: number;
  /** how wide the view is, as a multiple of the usual lens (0.85 narrow .. 1.2 wide) */
  fov: number;
  /**
   * The picture was set to sharp for this machine (it cannot hold sixty frames a second) and then set back to
   * smooth by hand: it is not to be changed again.
   */
  keepSmooth: boolean;
  /** the light the world is seen in: 'noon' (as authored), 'dusk' or 'moon' (config/mood.ts) */
  mood: string;
  /**
   * What the picture gives up when the machine cannot keep up. false: resolution and draw distance, to stay
   * smooth. true: smoothness, down to thirty frames a second, to stay sharp and far-seeing.
   */
  sharp: boolean;
  /** a phone or tablet: touch is the main input */
  readonly mobile: boolean;
}

interface Stored {
  level?: number;
  pixels?: number;
  detail?: number;
  muted?: boolean;
  classic?: boolean;
  sensitivity?: number;
  invertY?: boolean;
  volume?: number;
  fov?: number;
  sharp?: boolean;
  mood?: string;
  keepSmooth?: boolean;
}

/** A stored number if it is one and within its range, else the default. */
const within = (value: unknown, lo: number, hi: number, otherwise: number) =>
  typeof value === 'number' && value >= lo && value <= hi ? value : otherwise;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage can be blocked; the page then simply does not remember
  }
};
const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // see read()
  }
};

/**
 * The settings for this visit. A first visit gets High on a computer, Low on a computer with 4 GB of memory or
 * less, and Medium or Low on a phone depending on its memory. If the last load never finished, this one runs a
 * level lower.
 */
export function loadSettings(): Settings {
  const mobile = matchMedia('(pointer:coarse)').matches;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  let stored: Stored = {};
  try {
    stored = JSON.parse(read(KEY) ?? read(OLD_KEY) ?? '{}') as Stored;
  } catch {
    // unreadable: start afresh
  }
  let level: Level =
    stored.level === 0 || stored.level === 1 || stored.level === 2
      ? stored.level
      : mobile
        ? memory !== undefined && memory > 7
          ? 1
          : 2
        : memory !== undefined && memory <= 4
          ? 2
          : 0;
  let { pixels, detail } = stored;
  if (read(LOADING_KEY) && level < 2) {
    level = (level + 1) as Level;
    pixels = detail = undefined;
    write(KEY, JSON.stringify({ level }));
  }
  return {
    level,
    pixels: pixels || (level > 1 ? 41e4 : mobile ? 1280 * 720 : MAX_PIXELS),
    detail: detail || 1,
    muted: !!stored.muted,
    classic: stored.classic ?? reducedMotion(),
    sensitivity: within(stored.sensitivity, 0.3, 2.5, 1),
    invertY: !!stored.invertY,
    volume: within(stored.volume, 0, 1, 1),
    fov: within(stored.fov, 0.85, 1.2, 1),
    sharp: !!stored.sharp,
    mood: moodNamed(stored.mood).name,
    keepSmooth: !!stored.keepSmooth,
    mobile,
  };
}

/** Forgets everything remembered: the next loadSettings() starts from what the machine suggests. */
export function forgetSettings(): void {
  write(KEY, null);
  write(OLD_KEY, null);
}

export function saveSettings(settings: Settings, fullPixels: number): void {
  // at full resolution nothing is remembered for the pixel count, so a larger window later starts at its own full size
  const pixels = settings.pixels < fullPixels ? Math.floor(settings.pixels) : undefined;
  // the swimming style is remembered only once it differs from what the system's motion setting implies
  const classic = settings.classic === reducedMotion() ? undefined : settings.classic;
  const { level, detail, muted, sensitivity, invertY, volume, fov, sharp } = settings;
  const mood = settings.mood === 'noon' ? undefined : settings.mood;
  const keepSmooth = settings.keepSmooth || undefined;
  write(
    KEY,
    JSON.stringify({
      level,
      pixels,
      detail,
      muted,
      classic,
      sensitivity,
      invertY,
      volume,
      fov,
      sharp,
      mood,
      keepSmooth,
    }),
  );
}

/** Marks a load as started or finished (see LOADING_KEY). */
export function markLoading(loading: boolean): void {
  write(LOADING_KEY, loading ? '1' : null);
}
