// What the page remembers between visits, and how the first detail level is picked.
import { MAX_PIXELS } from '../render/dynres';
import type { Level } from './quality';

const KEY = 'abyssal-rebuild';
/** Set while a world is being built. Still set on the next visit, it means that load took the tab down. */
const LOADING_KEY = 'abyssal-rebuild-loading';

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
  /** a phone or tablet: touch is the main input */
  readonly mobile: boolean;
}

interface Stored {
  level?: number;
  pixels?: number;
  detail?: number;
  muted?: boolean;
  classic?: boolean;
}

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
    stored = JSON.parse(read(KEY) ?? '{}') as Stored;
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
    mobile,
  };
}

export function saveSettings(settings: Settings, fullPixels: number): void {
  // at full resolution nothing is remembered for the pixel count, so a larger window later starts at its own full size
  const pixels = settings.pixels < fullPixels ? Math.floor(settings.pixels) : undefined;
  // the swimming style is remembered only once it differs from what the system's motion setting implies
  const classic = settings.classic === reducedMotion() ? undefined : settings.classic;
  write(
    KEY,
    JSON.stringify({ level: settings.level, pixels, detail: settings.detail, muted: settings.muted, classic }),
  );
}

/** Marks a load as started or finished (see LOADING_KEY). */
export function markLoading(loading: boolean): void {
  write(LOADING_KEY, loading ? '1' : null);
}
