// The page around the scene: the loading bar, the start menu, the detail buttons.
// The scene keeps rendering, blurred by CSS, behind the menu.
import type { Level } from '../config/quality';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface Menu {
  /** true while the menu (or the loading screen) covers the scene */
  readonly open: boolean;
  /** Loading: what is happening and how far along it is, 0..1. */
  progress(text: string, fraction: number): void;
  /** Loading is done: show the menu. */
  ready(): void;
  /** Could not start, or the graphics device was lost: show a message instead of everything else. */
  fail(message: string): void;
  /** Opens the menu, or closes it and returns to the scene. */
  show(open: boolean): void;
}

export interface MenuActions {
  /** the dive / resume button was pressed: the menu has closed */
  onDive(): void;
  /** the menu opened or closed */
  onToggle(open: boolean): void;
  /** another detail level was picked */
  onLevel(level: Level): void;
}

export function createMenu(level: Level, canvas: HTMLCanvasElement, actions: MenuActions): Menu {
  const body = document.body;
  const dive = el<HTMLButtonElement>('dive');
  const status = el('status');
  const bar = el('bar');
  let open = true;
  let failed = false;

  const show = (next: boolean) => {
    if (failed) return;
    open = next;
    body.className = open ? 'menu' : document.pointerLockElement ? 'playing captured' : 'playing';
    // focus the dive button so Enter works (delayed: it cannot take focus while it is still hidden)
    if (open) setTimeout(() => open && dive.focus(), 100);
    else (document.activeElement as HTMLElement | null)?.blur();
    actions.onToggle(open);
  };

  dive.onclick = () => {
    show(false);
    dive.textContent = 'Resume';
    actions.onDive();
  };
  el('open-menu').onclick = () => show(true);
  // detail buttons, in the order Low, Medium, High: the current level is lit, the others switch to theirs
  el('detail')
    .querySelectorAll('button')
    .forEach((button, i) => {
      const buttonLevel = (2 - i) as Level;
      if (buttonLevel === level) button.className = 'on';
      else button.onclick = () => actions.onLevel(buttonLevel);
    });
  // losing the mouse (Esc, or switching away) opens the menu; taking it closes the menu
  document.addEventListener('pointerlockchange', () => show(document.pointerLockElement !== canvas));

  return {
    get open() {
      return open;
    },
    progress(text, fraction) {
      if (failed) return;
      status.textContent = text;
      bar.style.transform = `scaleX(${fraction})`;
    },
    ready: () => show(true),
    fail(message) {
      failed = true;
      open = true;
      body.className = 'loading failed';
      status.textContent = message;
    },
    show,
  };
}
