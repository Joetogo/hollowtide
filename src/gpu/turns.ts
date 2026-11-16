// Taking turns with the page. Long jobs on the main thread (copying a hundred megabytes to the GPU) are cut into
// slices with a breathe() between them, so input and the loading bar's animation are never held up for long.

const channel = typeof MessageChannel === 'undefined' ? null : new MessageChannel();
const waiting: (() => void)[] = [];
if (channel) channel.port1.onmessage = () => waiting.shift()?.();

/**
 * Resolves in a new task: everything already queued (input, a frame of the loading bar) runs first. A message
 * to oneself rather than setTimeout, which browsers hold back by 4 ms once timers nest: over the fifty-odd
 * slices of a world upload that would be a quarter of a second of waiting for nothing.
 */
export function breathe(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!channel) return void setTimeout(resolve);
    waiting.push(resolve);
    channel.port2.postMessage(0);
  });
}
