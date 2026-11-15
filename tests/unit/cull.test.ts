import { describe, expect, it } from 'vitest';
import { createCamera, lookAt } from '../../src/camera/camera';
import { createCullView, updateCullView, visibleRuns } from '../../src/render/cull';
import { CELL_COUNT, type CellTable } from '../../src/world/data';
import { CELLS } from '../../src/world/grid';

/** One item in every cell, spanning the given height range. */
function fullTable(lo = -45, hi = -30): CellTable {
  const start = new Uint32Array(CELL_COUNT + 1);
  for (let c = 0; c <= CELL_COUNT; c++) start[c] = c;
  return { start, lo: new Float32Array(CELL_COUNT).fill(lo), hi: new Float32Array(CELL_COUNT).fill(hi) };
}

/** The cells covered by the runs of the last visibleRuns() call (items and cells coincide in fullTable). */
function cellsOf(view: ReturnType<typeof createCullView>, n: number): number[] {
  const cells: number[] = [];
  for (let i = 0; i < n; i++) for (let k = 0; k < view.runs[i * 2 + 1]!; k++) cells.push(view.runs[i * 2]! + k);
  return cells;
}

function viewFrom(x: number, y: number, z: number, tx: number, ty: number, tz: number) {
  const camera = createCamera();
  lookAt(camera, x, y, z, tx, ty, tz);
  const view = createCullView(camera);
  updateCullView(view, 1280, 720, 1);
  return view;
}

describe('visibleRuns', () => {
  it('keeps what is ahead and drops what is behind', () => {
    const view = viewFrom(0, -40, 0, 0, -40, -100); // at the centre, looking towards -z
    const cells = cellsOf(view, visibleRuns(view, fullTable(), 3, 0, 500));
    const rows = new Set(cells.map((c) => Math.floor(c / CELLS)));
    expect(cells.length).toBeGreaterThan(20);
    expect(cells.length).toBeLessThan(CELL_COUNT / 2 + CELLS * 2);
    expect(Math.max(...rows)).toBeLessThanOrEqual(8); // row 8 holds the camera; rows beyond it are behind
    expect(rows.has(0)).toBe(true);
  });

  it('merges neighbouring cells of a row into one run', () => {
    const view = viewFrom(0, 60, 0, 0, -45, -0.001); // high above, looking straight down
    const n = visibleRuns(view, fullTable(), 3, 0, 500);
    const perRow = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const row = Math.floor(view.runs[i * 2]! / CELLS);
      perRow.set(row, (perRow.get(row) ?? 0) + 1);
    }
    expect([...perRow.values()].every((runs) => runs === 1)).toBe(true);
  });

  it('visits rows nearest first', () => {
    const view = viewFrom(0, 60, 30, 0, -45, 29.999);
    const n = visibleRuns(view, fullTable(), 3, 0, 500);
    const rows = Array.from({ length: n }, (_, i) => Math.floor(view.runs[i * 2]! / CELLS));
    expect(rows[0]).toBe(9); // z = 30 is in row 9
    expect(new Set(rows.slice(0, 3))).toEqual(new Set([9, 8, 10]));
  });

  it('honours the distance band, and the detail scale unless told otherwise', () => {
    const view = viewFrom(0, 60, 0, 0, -45, -0.001);
    const table = fullTable();
    const near = cellsOf(view, visibleRuns(view, table, 3, 0, 40));
    const far = cellsOf(view, visibleRuns(view, table, 3, 40, 150));
    expect(near.length).toBeGreaterThan(0);
    expect(far.length).toBeGreaterThan(0);
    expect(near.filter((c) => far.includes(c))).toEqual([]); // a cell is in exactly one band
    view.detail = 0.5;
    expect(cellsOf(view, visibleRuns(view, table, 3, 0, 150)).length).toBeLessThan(near.length + far.length);
    expect(cellsOf(view, visibleRuns(view, table, 3, 0, 150, true)).length).toBe(near.length + far.length);
  });

  it('never draws an empty cell', () => {
    const view = viewFrom(0, 60, 0, 0, -45, -0.001);
    const table = fullTable();
    table.lo.fill(1e9); // the generator marks an empty cell with lo > hi
    table.hi.fill(-1e9);
    expect(visibleRuns(view, table, 3, 0, 500)).toBe(0);
  });
});
