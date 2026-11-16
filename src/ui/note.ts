// A line of text that comes up at the bottom of the picture for a few seconds: for things a key has changed
// that would otherwise change silently.

/** @returns a function that shows a line for a few seconds, replacing any line still up */
export function createNote(element: HTMLElement): (text: string) => void {
  let timer = 0;
  return (text) => {
    element.textContent = text;
    element.className = 'on';
    clearTimeout(timer);
    timer = window.setTimeout(() => (element.className = ''), 4500);
  };
}
