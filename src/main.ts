// One bundle, two roles. The page runs this script as the main thread; the main thread then starts the
// world-generation worker from a Blob of the same source, so a single self-contained HTML file is enough and it
// also runs from file://. Every module is therefore loaded in both places: nothing may touch the DOM at import
// time (tests/unit/modules.test.ts checks that).
import { bootMain } from './app/boot';
import { bootWorker, type WorkerScope } from './world/generate';

if (typeof document !== 'undefined') {
  // currentScript only exists while the script is first running, so its text has to be taken here
  const source = document.currentScript?.textContent ?? '';
  void bootMain(() => new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))));
} else {
  bootWorker(self as unknown as WorkerScope);
}
