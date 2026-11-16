// A line of text that comes up at the bottom of the picture: for things a key has changed that would
// otherwise change silently, and for what a mode's keys are while it lasts.

export interface Note {
  /** Shows a line for a few seconds, replacing any line still up. */
  (text: string): void;
  /** Shows a line until clear() or another line. */
  hold(text: string): void;
  clear(): void;
}

export function createNote(element: HTMLElement): Note {
  let timer = 0;
  const show = (text: string, seconds: number) => {
    element.textContent = text;
    element.className = 'on';
    clearTimeout(timer);
    if (seconds) timer = window.setTimeout(() => (element.className = ''), seconds * 1000);
  };
  const note = ((text: string) => show(text, 4.5)) as Note;
  note.hold = (text) => show(text, 0);
  note.clear = () => {
    clearTimeout(timer);
    element.className = '';
  };
  return note;
}
