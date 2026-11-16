import { describe, expect, it } from 'vitest';
import { sortSprites } from '../../src/render/world';
import { CELL_COUNT } from '../../src/world/data';
import { CELLS, CELL_SIZE, ORIGIN_X, ORIGIN_Z } from '../../src/world/grid';

describe('sorting sprites into culling cells', () => {
  let seed = 3;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
  // 5000 sprites all over (and a little beyond) the world: position, then five more floats, the sixth a height
  const sprites = new Float32Array(5000 * 8);
  for (let i = 0; i < 5000; i++) {
    sprites.set([random() * 420 - 210, -random() * 50, random() * 420 - 210, i, 0, 0, random() * 10, 0], i * 8);
  }

  it('keeps every sprite, in its cell, in its original order within the cell', async () => {
    const { instances, cells } = await sortSprites(sprites, (s, at) => s[at + 6]!);
    expect(instances.length).toBe(sprites.length);
    expect(cells.start[CELL_COUNT]).toBe(5000);
    const seen = new Set<number>();
    for (let c = 0; c < CELL_COUNT; c++) {
      let last = -1;
      for (let i = cells.start[c]!; i < cells.start[c + 1]!; i++) {
        const [x, y, z, id, , , rise] = instances.subarray(i * 8, i * 8 + 8) as unknown as number[];
        // it lies in this cell (sprites beyond the world's edge go to the cells along it)
        const cx = Math.min(CELLS - 1, Math.max(0, Math.floor((x! - ORIGIN_X) / CELL_SIZE)));
        const cz = Math.min(CELLS - 1, Math.max(0, Math.floor((z! - ORIGIN_Z) / CELL_SIZE)));
        expect(cx + CELLS * cz).toBe(c);
        // the cell's height range covers it and how far it rises
        expect(y!).toBeGreaterThanOrEqual(cells.lo[c]!);
        expect(y! + rise!).toBeLessThanOrEqual(cells.hi[c]! + 1e-4);
        expect(id!).toBeGreaterThan(last); // the order it had
        last = id!;
        seen.add(id!);
        // and it is the sprite it was, all eight floats
        expect([...instances.subarray(i * 8, i * 8 + 8)]).toEqual([...sprites.subarray(id! * 8, id! * 8 + 8)]);
      }
    }
    expect(seen.size).toBe(5000);
  });

  it('marks an empty cell as empty', async () => {
    const one = new Float32Array([0, -10, 0, 0, 0, 0, 2, 0]);
    const { cells } = await sortSprites(one, (s, at) => s[at + 6]!);
    const empty = [...cells.lo].filter((lo, c) => lo > cells.hi[c]!).length;
    expect(empty).toBe(CELL_COUNT - 1);
  });
});
