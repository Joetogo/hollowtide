// A scripted swim, played into the original and into Hollowtide: both must trace the same path.
// Each step is one frame: how long it took, which keys are down, and how far the mouse moved.
// Starts at the first viewpoint and covers easing in, turning, sprinting into rock (collision and sliding),
// vertical movement, backing off, an over-long frame (the time step is capped) and coasting to a stop.
export function swimScript() {
  const steps = [];
  const add = (count, ms, keys = {}, dx = 0, dy = 0) => {
    for (let i = 0; i < count; i++) steps.push({ ms, f: 0, b: 0, l: 0, r: 0, u: 0, d: 0, s: 0, dx, dy, ...keys });
  };
  add(60, 1000 / 60, { f: 1 });
  add(60, 1000 / 60, { f: 1, r: 1 }, 3, -1);
  add(1, 250, { f: 1 }); // a hitch: longer than the 0.1 s cap
  add(120, 1000 / 60, { f: 1, s: 1 }, -2, 0.5);
  add(40, 1000 / 30, { u: 1, s: 1 });
  add(60, 1000 / 120, { b: 1, l: 1 }, 5, 2);
  add(90, 1000 / 60, { f: 1, s: 1 }, 0, 1.5);
  add(45, 1000 / 60, { d: 1 });
  add(60, 1000 / 60);
  return { pose: 0, steps };
}
