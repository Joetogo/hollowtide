# Contributing to Hollowtide

Faults reported and changes offered are both welcome.

## Reporting a fault

Open an [issue](https://github.com/Richman-Tan/hollowtide/issues) and say:

- the browser and its version, and the machine (a phone, a laptop, which graphics);
- what you did, what you expected and what happened;
- what the stats line says, if the page runs (`H` turns it on);
- anything in the browser's console, if the page does not start.

A link to the view (`L` copies one) helps when it is about a place.

## Offering a change

Pull requests are welcome. A fix, a wording, a control that is awkward on your device, a test that fails on your
machine: send it. For something that changes how the world looks or adds a feature, open an issue first, so that
the work is not done before it is agreed.

Before sending:

1. `npm run check` passes (types, lint, unit tests; no browser).
2. The browser tests that cover what you touched pass. The README's
   [Running it and working on it](README.md#running-it-and-working-on-it) says which test covers what and what
   each needs. `node tests/browser/boot.mjs` is the quickest; what the page says and does is in `shell.mjs` and
   `panel.mjs`.
3. The frames compared with the original are still the original's. There are two sets of numbers in
   `src/config/tuning.ts`: the faithful one and the tuned one, which ships. Something new is zero or absent in the
   faithful set.
4. `npm run build` is within the size budget it prints.

In the commit message, say what was wrong or missing and what it is now, in plain words: the history is written
to be read.

## Licence

Hollowtide is MIT-licensed, and contributions are taken under the same licence. The world is ported from
[Abyssal Garden](https://github.com/Noniv/abyssal-garden) by Noniv (Maksymilian Dendura), also MIT; `LICENSE` keeps
both copyright lines.
