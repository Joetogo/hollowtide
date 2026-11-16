// The page around the scene, from the first moment to the dive and after:
//   loading   a diver sinks while the world is made (the veil draws it; this keeps the depth and the words)
//   home      the world from a drifting camera, the title, one thing to do: any of W A S D, or a tap
//   waking    the dive has begun: the swimmer is put on the seabed and their eyes open
//   playing   in the water
//   paused    the world blurred behind a panel: resume, detail level, the keys
import type { Level } from '../config/quality';
import { createVeil } from './veil';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface Menu {
  /** true while the scene is not being played: loading, the home view, eyes still shut, or paused */
  readonly open: boolean;
  /** true while the home view is up: the camera is the page's to move */
  readonly home: boolean;
  /** Loading: what is happening and how far along it is, 0..1. */
  progress(text: string, fraction: number): void;
  /** Loading is done: the descent ends, the picture goes black, and the home view comes up. */
  ready(): void;
  /** Could not start, or the graphics device was lost: show a message instead of everything else. */
  fail(message: string): void;
  /** Pauses (opens the panel), or closes it and returns to the scene. */
  show(open: boolean): void;
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

export function createMenu(level: Level, canvas: HTMLCanvasElement, actions: MenuActions): Menu {
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
    // focus the resume button so Enter works (delayed: it cannot take focus while it is still hidden)
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
      if (buttonLevel === level) button.className = 'on';
      else button.onclick = () => actions.onLevel(buttonLevel);
    });
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
    progress(text, fraction) {
      if (state !== 'loading') return;
      status.textContent = text;
      bar.style.transform = `scaleX(${fraction})`;
      veil.progress(fraction);
    },
    ready() {
      if (state !== 'loading') return;
      void veil.sink().then(() => {
        // black for a moment, then the home view
        setTimeout(() => {
          if (state !== 'loading') return;
          state = 'home';
          body.className = 'home';
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
  };
}
