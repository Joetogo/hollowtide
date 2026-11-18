// The page around the scene, from the first moment to the dive and after:
//   loading   a diver sinks while the world is made (the veil draws it; this keeps the depth and the words)
//   home      the world from a drifting camera, the title, one thing to do: any of W A S D, or a tap
//   waking    the dive has begun: the swimmer is put on the seabed and their eyes open
//   playing   in the water
//   paused    the world blurred behind a panel: resume, detail level, the keys
import type { Level } from '../config/quality';
import { MOODS } from '../config/mood';
import type { Settings } from '../config/settings';
import { createVeil } from './veil';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
/** Marks a button as the current choice or not: lit for the eye, and said for whatever reads the page aloud. */
const lit = (button: HTMLElement, on: boolean) => {
  button.className = on ? 'on' : '';
  button.setAttribute('aria-pressed', String(on));
};

export interface Menu {
  /** true while the scene is not being played: loading, the home view, eyes still shut, or paused */
  readonly open: boolean;
  /** true while the home view is up: the camera is the page's to move */
  readonly home: boolean;
  /** true while the pause panel is up, with the world blurred behind it */
  readonly paused: boolean;
  /** Loading: what is happening and how far along it is, 0..1. */
  progress(text: string, fraction: number): void;
  /** Loading is done: the descent ends, the picture goes black, and the home view comes up. */
  ready(resume?: boolean, onBlack?: () => void): void;
  /** Could not start, or the graphics device was lost: show a message instead of everything else. */
  fail(message: string): void;
  /** Pauses (opens the panel), or closes it and returns to the scene. */
  show(open: boolean): void;
  /** Shows the settings as they are now (after something other than the panel has changed one). */
  sync(): void;
  /** Lights the button of the light the world is now seen in ('noon', 'dusk' or 'moon'). */
  setMood(name: string): void;
  /** The picture comes up out of black over a second and a half: for a cut from one place to another. */
  fade(): void;
  /** The one button of a gamepad: dives from the home view, pauses while swimming, resumes from the pause. */
  press(): void;
}

export interface MenuActions {
  /** the swimmer is about to wake: put them where they begin */
  onWake(): void;
  /** a dive or a resume, from a key, a click or a tap: the moment to take the mouse and start the sound */
  onDive(): void;
  /** the panel opened or closed */
  onToggle(open: boolean): void;
  /** another detail level was picked */
  onLevel(level: Level): void;
  /** a light was picked: 'noon', 'dusk' or 'moon' (it may be the one that is on already) */
  onMood(name: string): void;
  /** a setting was changed in the panel (the settings object has the new value): apply it and remember it */
  onSettings(): void;
}

/** Keys that start the dive from the home view. */
const START = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'Enter',
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);
/** Seconds the picture stays black between the descent and the home view. */
const BLACK = 0.45;
/** Seconds into waking at which the swimmer can move: the eyes are half open. */
const STIR = 1.3;

export function createMenu(
  level: Level,
  mood: string,
  canvas: HTMLCanvasElement,
  settings: Settings,
  actions: MenuActions,
): Menu {
  const body = document.body;
  const dive = el<HTMLButtonElement>('dive');
  const status = el('status');
  const bar = el('bar');
  const depth = el('depth');
  const veil = createVeil(el<HTMLCanvasElement>('veil'));
  veil.onDepth = (metres) => (depth.textContent = metres.toFixed(1) + ' m');
  let state: 'loading' | 'home' | 'waking' | 'playing' | 'paused' | 'failed' = 'loading';
  let stirring = false; // waking, and far enough along to move

  const captured = () => document.pointerLockElement === canvas;
  const show = (next: boolean) => {
    if (state !== 'playing' && state !== 'paused') return;
    state = next ? 'paused' : 'playing';
    body.className = next ? 'menu' : captured() ? 'playing captured' : 'playing';
    // focus the resume button so Enter works (at once if the panel is still fading out from last time, and
    // again in a moment: it cannot take focus while it is hidden)
    if (next) sync();
    if (next) dive.focus();
    if (next) setTimeout(() => state === 'paused' && dive.focus(), 100);
    else (document.activeElement as HTMLElement | null)?.blur();
    actions.onToggle(next);
  };
  /** The first dive: the swimmer wakes on the seabed. */
  const wake = () => {
    state = 'waking';
    stirring = false;
    body.className = 'waking';
    (document.activeElement as HTMLElement | null)?.blur();
    dive.textContent = 'Resume'; // what the button is from now on
    actions.onWake();
    actions.onDive();
    setTimeout(() => {
      stirring = state === 'waking';
      if (stirring) actions.onToggle(false);
    }, STIR * 1000);
    void veil.openEyes().then(() => {
      if (state !== 'waking') return;
      state = 'playing';
      body.className = captured() ? 'playing captured' : 'playing';
    });
  };

  dive.onclick = () => {
    if (state === 'home') wake();
    else if (state === 'paused') {
      show(false);
      actions.onDive();
    }
  };
  // on the home view any of the swimming keys dives, and so does a tap anywhere that is not a control
  addEventListener('keydown', (event) => {
    if (state !== 'home' || event.repeat || !START.has(event.code)) return;
    if ((event.code === 'Enter' || event.code === 'Space') && event.target instanceof HTMLButtonElement) return;
    event.preventDefault();
    wake();
  });
  el('menu').addEventListener('click', (event) => {
    if (state === 'home' && (event.target as HTMLElement).closest('button, a') === null) wake();
  });
  el('open-menu').onclick = () => show(true);
  // detail buttons, in the order Low, Medium, High: the current level is lit, the others switch to theirs
  el('detail')
    .querySelectorAll('button')
    .forEach((button, i) => {
      const buttonLevel = (2 - i) as Level;
      lit(button, buttonLevel === level);
      if (buttonLevel !== level) button.onclick = () => actions.onLevel(buttonLevel);
    });
  // the light, in the order of config/mood.ts: the current one is lit, and each switches to its own
  const lights = [...el('light').querySelectorAll('button')];
  lights.forEach((button, i) => (button.onclick = () => actions.onMood(MOODS[i]!.name)));
  const setMood = (name: string) => lights.forEach((button, i) => lit(button, MOODS[i]!.name === name));
  setMood(mood);
  // ---- the settings in the pause panel: three sliders and three choices, each written straight into `settings`
  const syncs: (() => void)[] = [];
  const slider = (id: string, key: 'sensitivity' | 'fov' | 'volume') => {
    const input = el<HTMLInputElement>(id);
    input.oninput = () => {
      settings[key] = +input.value;
      actions.onSettings();
    };
    syncs.push(() => (input.value = String(settings[key])));
  };
  /** A row of two buttons for a yes-or-no setting: the first is "no". */
  const choice = (id: string, key: 'invertY' | 'sharp' | 'classic') => {
    const buttons = el(id).querySelectorAll('button');
    buttons.forEach((button, i) => {
      button.onclick = () => {
        settings[key] = i === 1;
        sync();
        actions.onSettings();
      };
    });
    syncs.push(() => buttons.forEach((button, i) => lit(button, (i === 1) === settings[key])));
  };
  slider('look', 'sensitivity');
  slider('fov', 'fov');
  slider('volume', 'volume');
  choice('invert', 'invertY');
  choice('picture', 'sharp');
  choice('swim', 'classic');
  const sync = () => syncs.forEach((each) => each());
  sync();

  // losing the mouse (Esc, or switching away) pauses; taking it resumes. While the eyes are opening the mouse
  // is taken without anything else changing.
  document.addEventListener('pointerlockchange', () => show(!captured()));

  return {
    get open() {
      return state !== 'playing' && !(state === 'waking' && stirring);
    },
    get home() {
      return state === 'home';
    },
    get paused() {
      return state === 'paused';
    },
    progress(text, fraction) {
      if (state !== 'loading') return;
      status.textContent = text;
      bar.style.transform = `scaleX(${fraction})`;
      veil.progress(fraction);
    },
    ready(resume = false, onBlack) {
      if (state !== 'loading') return;
      void veil.sink().then(() => {
        onBlack?.();
        // black for a moment, then the home view; or, for a swimmer who was in the water before the page
        // started over (to change the light, or the detail), the place they were, paused
        setTimeout(() => {
          if (state !== 'loading') return;
          if (resume) {
            // back in the panel the change was made in, the world in its new light behind it; resuming from
            // there is a click, which is what taking the mouse, the whole screen and the sound each need
            state = 'playing';
            dive.textContent = 'Resume';
            actions.onWake();
            show(true);
          } else {
            state = 'home';
            body.className = 'home';
          }
          veil.reveal();
        }, BLACK * 1000);
      });
    },
    fail(message) {
      state = 'failed';
      body.className = 'loading failed';
      status.textContent = message;
    },
    show,
    sync,
    setMood,
    fade: () => veil.reveal(),
    press() {
      if (state === 'home') wake();
      else if (state === 'playing') show(true);
      else if (state === 'paused') dive.click();
    },
  };
}
