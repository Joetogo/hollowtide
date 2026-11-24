// Which key does what, for the keys that can be chosen.
//
// An action is known by the code of the key it has to begin with ('KeyW': swimming forward), and the rest of
// the program goes on asking for it by that name. What is kept is only which actions have another key: a key
// pressed is turned into the action it now stands for before anything looks at it.

/** The actions a key can be chosen for, and what each is called when the page speaks of it. */
export const ACTIONS: Readonly<Record<string, string>> = {
  KeyW: 'swimming forward',
  KeyA: 'swimming left',
  KeyS: 'swimming back',
  KeyD: 'swimming right',
  KeyQ: 'going down',
  KeyE: 'going up',
  ShiftLeft: 'the scooter',
  KeyM: 'the sound',
  KeyH: 'the stats line',
  KeyF: 'the lamp',
  KeyC: 'the classic glide',
  KeyL: 'a link to the view',
  KeyT: 'the tour',
  KeyP: 'photo mode',
  KeyZ: 'running the moment back',
  KeyX: 'running the moment on',
  KeyV: 'a darker photo',
  KeyB: 'a brighter photo',
  KeyG: "the photo's grid",
  KeyO: "the photo's focus",
};

/** The actions that have another key than their own: action, then the code of the key chosen for it. */
export type Keys = Record<string, string>;

/** Keys that are not to be had: the panel and the browser need them. */
const REFUSED = /^(Escape|Enter|Tab|Meta|OS|F\d|CapsLock|ContextMenu|Unidentified|$)/;
/** (the two Shift keys are one key) */
const one = (code: string): string => (code === 'ShiftRight' ? 'ShiftLeft' : code);

/** The key an action is on. */
export const keyOf = (keys: Keys, action: string): string => keys[action] ?? action;

/**
 * What a key pressed stands for: the action it was chosen for; or nothing (''), for a key whose own action has
 * gone to another key; or, for any other key, itself (Escape, the arrows, the digits and the rest are as ever).
 */
export function actionOf(keys: Keys, code: string): string {
  code = one(code);
  for (const action in ACTIONS) if (keyOf(keys, action) === code) return action;
  return code in ACTIONS ? '' : code;
}

/**
 * Puts an action on another key. A key that had an action gives it up for the one this action had, so that
 * nothing is left without a key. Returns that other action, '' if there was none, or null if the key is not to
 * be had.
 */
export function assignKey(keys: Keys, action: string, code: string): string | null {
  code = one(code);
  if (REFUSED.test(code)) return null;
  const old = keyOf(keys, action);
  const other = actionOf(keys, code);
  const put = (on: string, key: string) => {
    if (key === on) delete keys[on];
    else keys[on] = key;
  };
  put(action, code);
  if (!(other in ACTIONS) || other === action) return '';
  put(other, old);
  return other;
}

/** What was remembered, with anything that is not an action and a key left out. */
export function saneKeys(stored: unknown): Keys {
  const keys: Keys = {};
  if (stored && typeof stored === 'object') {
    for (const [action, code] of Object.entries(stored)) {
      if (action in ACTIONS && typeof code === 'string' && !REFUSED.test(code)) keys[action] = code;
    }
  }
  return keys;
}

const NAMES: Record<string, string> = {
  ShiftLeft: 'Shift',
  ControlLeft: 'Ctrl',
  AltLeft: 'Alt',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};
/** what this keyboard has printed on its keys, where the browser can say (see learnLayout) */
const printed = new Map<string, string>();

/** What a key is called on the page: W for 'KeyW' (or what this keyboard has there), Shift, an arrow. */
export const keyName = (code: string): string => NAMES[code] ?? printed.get(code) ?? code.replace(/^(Key|Digit)/, '');

/**
 * Asks the browser what is printed on this keyboard's keys, where it can tell: the keys are known by their place
 * (W A S D are the same four on every keyboard), and on one that is not laid out as QWERTY they bear other
 * letters. Resolves when the names are in use (at once where the browser cannot tell).
 */
export async function learnLayout(): Promise<void> {
  type Keyboard = { getLayoutMap?: () => Promise<Map<string, string>> };
  try {
    const map = await (navigator as Navigator & { keyboard?: Keyboard }).keyboard?.getLayoutMap?.();
    map?.forEach((letter, code) => {
      if (letter.length === 1 && !code.startsWith('Digit')) printed.set(code, letter.toUpperCase());
    });
  } catch {
    // not allowed here (a frame without the permission): the keys keep their usual names
  }
}
