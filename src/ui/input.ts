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
  /** the main button of a gamepad (A, or Start) went down: dive, pause or resume, whichever applies */
  onPadButton(): void;
}

export interface Input {
  /** Asks the browser to capture the mouse for looking around. */
  capture(): void;
  /** Lets go of every key and touch (the menu opened, or the window lost focus). */
  release(): void;
  /** Reads the gamepad, if there is one. Call once a frame. */
  poll(): void;
}

/** A stick this near its middle is taken to be at rest. */
const DEAD = 0.16;
/** A stick's reading with the dead middle taken out, still reaching 1 at the rim. */
export const stick = (value: number): number =>
  Math.abs(value) < DEAD ? 0 : (Math.sign(value) * (Math.abs(value) - DEAD)) / (1 - DEAD);
const unit = (value: number): number => (value > 1 ? 1 : value < -1 ? -1 : value);

export function bindInput(canvas: HTMLCanvasElement, intent: Intent, actions: InputActions): Input {
  // a phone held upright has the page turned on its side (see the template), and the touch axes with it
  const turned = matchMedia('(orientation:portrait) and (pointer:coarse)');
  const keys = {
    forward: 0,
    back: 0,
    left: 0,
    right: 0,
    up: 0,
    down: 0,
    fast: 0,
    turnLeft: 0,
    turnRight: 0,
    turnUp: 0,
    turnDown: 0,
  };
  /** what a gamepad is asking for: sticks -1..1 */
  const pad = { forward: 0, right: 0, up: 0, fast: false, turnX: 0, turnY: 0, button: false, lamp: false, on: false };
  /** the left button is down on the picture: dragging looks around (for when the mouse cannot be captured) */
  let dragging = false;
  let touchId = -1; // the finger that steers
  let touches = 0;
  let startX = 0,
    startY = 0,
    lastX = 0,
    lastY = 0;

  const apply = () => {
    // one finger down swims forward; a second finger goes faster
    intent.forward = touchId >= 0 ? 0.7 : unit(keys.forward - keys.back + pad.forward);
    intent.right = unit(keys.right - keys.left + pad.right);
    intent.up = unit(keys.up - keys.down + pad.up);
    intent.fast = !!keys.fast || touches > 1 || pad.fast;
    if (touchId < 0) {
      // the arrow keys and a gamepad's right stick turn the view at a steady rate, as a held touch does
      const flip = actions.lookSpeed()[1] < 0 ? -1 : 1;
      intent.turnX = unit(keys.turnRight - keys.turnLeft + pad.turnX);
      intent.turnY = unit(keys.turnDown - keys.turnUp + pad.turnY) * flip;
    }
  };
  const release = () => {
    for (const name of Object.keys(keys) as (keyof typeof keys)[]) keys[name] = 0;
    touchId = -1;
    touches = 0;
    dragging = false;
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
      case 'ArrowLeft':
        keys.turnLeft = down;
        break;
      case 'ArrowRight':
        keys.turnRight = down;
        break;
      case 'ArrowUp':
        keys.turnUp = down;
        break;
      case 'ArrowDown':
        keys.turnDown = down;
        break;
      default:
        if (down && !event.repeat) actions.onKey(event.code);
    }
    apply();
  };
  addEventListener('keydown', (event) => {
    if (actions.menuOpen() && event.code !== 'KeyH' && event.code !== 'KeyM') return;
    actions.onGesture();
    if (event.code.startsWith('Arrow')) event.preventDefault(); // or the page would try to scroll
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
  // where the mouse cannot be captured (some embeds refuse it), holding the button down and dragging looks
  canvas.addEventListener('mousedown', (event) => {
    if (event.button === 0) dragging = true;
  });
  addEventListener('mouseup', () => (dragging = false));
  addEventListener('mousemove', (event) => {
    if (document.pointerLockElement === canvas || (dragging && event.buttons & 1 && !actions.menuOpen())) {
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

  const poll = () => {
    let found: Gamepad | null = null;
    for (const each of navigator.getGamepads?.() ?? []) {
      if (each?.connected && each.mapping === 'standard') {
        found = each;
        break;
      }
    }
    if (!found) {
      if (!pad.on) return;
      pad.forward = pad.right = pad.up = pad.turnX = pad.turnY = 0;
      pad.fast = pad.button = pad.lamp = pad.on = false;
      apply();
      return;
    }
    pad.on = true;
    const { axes, buttons } = found;
    const pressed = (i: number) => buttons[i]?.pressed ?? false;
    // A or Start: dive, pause, resume
    const button = pressed(0) || pressed(9);
    if (button && !pad.button) {
      actions.onGesture();
      actions.onPadButton();
    }
    pad.button = button;
    // Y: the lamp
    if (pressed(3) && !pad.lamp && !actions.menuOpen()) actions.onKey('KeyF');
    pad.lamp = pressed(3);
    if (actions.menuOpen()) {
      pad.forward = pad.right = pad.up = pad.turnX = pad.turnY = 0;
      pad.fast = false;
    } else {
      // left stick swims, right stick looks, the bumpers go down and up, the right trigger is the scooter
      pad.right = stick(axes[0] ?? 0);
      pad.forward = -stick(axes[1] ?? 0);
      pad.turnX = stick(axes[2] ?? 0);
      pad.turnY = stick(axes[3] ?? 0);
      pad.up = (pressed(5) ? 1 : 0) - (pressed(4) ? 1 : 0);
      pad.fast = (buttons[7]?.value ?? 0) > 0.3;
    }
    apply();
  };

  return { capture, release, poll };
}
