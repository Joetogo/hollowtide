// Keys, mouse and touch, turned into what the swimmer is asking for (src/camera/controls.ts).
import type { Intent } from '../camera/controls';

export interface InputActions {
  /** any click, key or touch: lets the sound start */
  onGesture(): void;
  /** true while the menu is open: then only the stats and mute keys work */
  menuOpen(): boolean;
  /** a key that is not a movement key, by its KeyboardEvent.code */
  onKey(code: string): void;
  /** how fast the view turns (1 = as shipped), negative for an inverted up and down */
  lookSpeed(): [x: number, y: number];
}

export interface Input {
  /** Asks the browser to capture the mouse for looking around. */
  capture(): void;
  /** Lets go of every key and touch (the menu opened, or the window lost focus). */
  release(): void;
}

export function bindInput(canvas: HTMLCanvasElement, intent: Intent, actions: InputActions): Input {
  // a phone held upright has the page turned on its side (see the template), and the touch axes with it
  const turned = matchMedia('(orientation:portrait) and (pointer:coarse)');
  const keys = { forward: 0, back: 0, left: 0, right: 0, up: 0, down: 0, fast: 0 };
  let touchId = -1; // the finger that steers
  let touches = 0;
  let startX = 0,
    startY = 0,
    lastX = 0,
    lastY = 0;

  const apply = () => {
    // one finger down swims forward; a second finger goes faster
    intent.forward = touchId >= 0 ? 0.7 : keys.forward - keys.back;
    intent.right = keys.right - keys.left;
    intent.up = keys.up - keys.down;
    intent.fast = !!keys.fast || touches > 1;
    if (touchId < 0) intent.turnX = intent.turnY = 0;
  };
  const release = () => {
    keys.forward = keys.back = keys.left = keys.right = keys.up = keys.down = keys.fast = 0;
    touchId = -1;
    touches = 0;
    apply();
  };

  const key = (event: KeyboardEvent, down: 0 | 1) => {
    switch (event.code) {
      case 'KeyW':
        keys.forward = down;
        break;
      case 'KeyS':
        keys.back = down;
        break;
      case 'KeyA':
        keys.left = down;
        break;
      case 'KeyD':
        keys.right = down;
        break;
      case 'KeyE':
        keys.up = down;
        break;
      case 'KeyQ':
        keys.down = down;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        keys.fast = down;
        break;
      default:
        if (down && !event.repeat) actions.onKey(event.code);
    }
    apply();
  };
  addEventListener('keydown', (event) => {
    if (actions.menuOpen() && event.code !== 'KeyH' && event.code !== 'KeyM') return;
    actions.onGesture();
    key(event, 1);
  });
  addEventListener('keyup', (event) => key(event, 0));
  addEventListener('blur', release);

  const capture = () => {
    actions.onGesture();
    // raw mouse movement where the browser offers it; the plain request where it does not
    const request = canvas.requestPointerLock({ unadjustedMovement: true }) as Promise<void> | undefined;
    request?.catch(() => canvas.requestPointerLock())?.catch(() => 0);
  };
  canvas.addEventListener('click', capture);
  addEventListener('mousemove', (event) => {
    if (document.pointerLockElement === canvas) {
      const [sx, sy] = actions.lookSpeed();
      intent.lookX += event.movementX * sx;
      intent.lookY += event.movementY * sy;
    }
  });

  const touch = (event: TouchEvent) => {
    event.preventDefault();
    actions.onGesture();
    touches = event.touches.length;
    let finger: Touch | null = null;
    let first = false;
    for (let i = 0; i < touches; i++) if (event.touches[i]!.identifier === touchId) finger = event.touches[i]!;
    if (!finger) {
      touchId = -1;
      if (touches) {
        finger = event.touches[0]!;
        touchId = finger.identifier;
        first = true;
      }
    }
    if (finger) {
      const x = turned.matches ? finger.clientY : finger.clientX;
      const y = turned.matches ? -finger.clientX : finger.clientY;
      const scale = 1100 / Math.min(innerWidth, innerHeight);
      if (first) {
        startX = x;
        startY = y;
      } else {
        // the view follows the finger at once...
        const [sx, sy] = actions.lookSpeed();
        intent.lookX += (x - lastX) * scale * sx;
        intent.lookY += (y - lastY) * scale * sy;
      }
      lastX = x;
      lastY = y;
      // ...and holding it away from where it went down keeps turning, like a joystick
      const reach = 4 / (innerWidth < innerHeight ? innerWidth : innerHeight);
      const jx = (x - startX) * reach,
        jy = (y - startY) * reach;
      intent.turnX = jx > 1 ? 1 : jx < -1 ? -1 : jx;
      intent.turnY = jy > 1 ? 1 : jy < -1 ? -1 : jy;
    }
    apply();
  };
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const) {
    canvas.addEventListener(type, touch, { passive: false });
  }

  return { capture, release };
}
