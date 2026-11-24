// Choosing other keys: every key cap in the panel's list is a button. Pressed, it waits for the key that is to
// do its job from now on; Esc leaves things as they are. A key that already had a job swaps with it.
import { ACTIONS, assignKey, keyName, keyOf, type Keys } from '../config/keys';
import type { Note } from './note';

export interface Rebind {
  /** Writes every key cap on the page again (the names of the keys may have been learnt since). */
  refresh(): void;
  /** Stops waiting for a key, if it was. */
  cancel(): void;
}

/** @param changed called when a key has been chosen, to remember it */
export function bindKeys(keys: Keys, note: Note, changed: () => void): Rebind {
  const usual = document.getElementById('usual')!;
  const scene = document.getElementById('scene')!;
  const name = (action: string) => keyName(keyOf(keys, action));
  const refresh = () => {
    for (const cap of document.querySelectorAll<HTMLElement>('[data-k]')) {
      const action = cap.dataset.k!;
      cap.textContent = name(action);
      if (cap.tagName === 'BUTTON') {
        cap.setAttribute('aria-label', `The key for ${ACTIONS[action]!}: ${name(action)}. Press to choose another`);
      }
    }
    usual.hidden = !Object.keys(keys).length;
    scene.setAttribute(
      'aria-label',
      `The underwater world. ${['KeyW', 'KeyA', 'KeyS', 'KeyD'].map(name).join(' ')} swim, the arrow keys ` +
        'look around, Escape opens the panel',
    );
  };
  /** the action a key is being waited for */
  let waiting = '';
  const cancel = () => {
    if (waiting) note.clear();
    waiting = '';
  };
  // before anything else on the page hears of the key: it is not a key press like the others
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  addEventListener(
    'keydown',
    (event) => {
      if (!waiting) return;
      swallow(event);
      // (and a button in focus is not to take the key's release for a press of itself)
      addEventListener('keyup', swallow, { capture: true, once: true });
      const action = waiting;
      waiting = '';
      if (event.code === 'Escape') return note.clear();
      const other = assignKey(keys, action, event.code);
      if (other === null) return note(`${keyName(event.code)} is not a key that can be chosen`);
      refresh();
      changed();
      note(
        `${name(action)} is now the key for ${ACTIONS[action]!}` +
          (other ? ` · and ${name(other)} for ${ACTIONS[other]!}` : ''),
      );
    },
    true,
  );
  // a press anywhere else is a change of mind
  addEventListener('pointerdown', cancel, true);
  for (const cap of document.querySelectorAll<HTMLElement>('#keys button[data-k]')) {
    cap.onclick = () => {
      waiting = cap.dataset.k!;
      note.hold(`Press the key for ${ACTIONS[waiting]!} · Esc leaves it as it is`);
    };
  }
  usual.onclick = () => {
    for (const action of Object.keys(keys)) delete keys[action];
    refresh();
    changed();
    note('The usual keys are back');
  };
  refresh();
  return { refresh, cancel };
}
