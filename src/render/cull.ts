// Culling by cell. Everything scattered over the seabed is sorted by a 16 x 16 grid of 24 m cells, so a frame
// only has to decide which cells are in view and within a distance band; consecutive visible cells of a row are
// drawn as one run. All state lives in preallocated arrays: nothing here allocates per frame.
import type { Camera } from '../camera/camera';
import type { CellTable } from '../world/data';
import { CELLS, CELL_SIZE, ORIGIN_X, ORIGIN_Z } from '../world/grid';
import { TAN_HALF_FOV } from './frame';

/** The camera as the culler needs it, refreshed once a frame by updateCullView(). */
export interface CullView {
  camera: Camera;
  /** width / height of the render size */
  aspect: number;
  /** draw-distance scale, 1 = full */
  detail: number;
  /** grid rows ordered nearest first, so nearer geometry is drawn first and hides more of what follows */
  rowOrder: Uint8Array;
  /** scratch for visibleRuns(): [first item, count] pairs */
  runs: Uint32Array;
}

export function createCullView(camera: Camera): CullView {
  return { camera, aspect: 1, detail: 1, rowOrder: new Uint8Array(CELLS), runs: new Uint32Array(CELLS * CELLS) };
}

export function updateCullView(view: CullView, width: number, height: number, detail: number): void {
  view.aspect = width / height;
  view.detail = detail;
  let row = Math.floor((view.camera.z - ORIGIN_Z) / CELL_SIZE) | 0;
  row = row < 0 ? 0 : row > CELLS - 1 ? CELLS - 1 : row;
  let n = 0;
  view.rowOrder[n++] = row;
  for (let d = 1; d < CELLS; d++) {
    if (row - d >= 0) view.rowOrder[n++] = row - d;
    if (row + d < CELLS) view.rowOrder[n++] = row + d;
  }
}

/**
 * Finds the cells of `cells` that are in view and whose nearest edge is within [minDistance, maxDistance) of the
 * camera on the ground plane, merges neighbours into runs, and writes [first item, count] pairs to view.runs.
 * `margin` grows each cell's box by the reach of what stands in it. The distances shrink with the detail scale
 * unless `fixedDistance` is set (the terrain always draws to its full distance).
 * @returns the number of runs
 */
export function visibleRuns(
  view: CullView,
  cells: CellTable,
  margin: number,
  minDistance: number,
  maxDistance: number,
  fixedDistance = false,
): number {
  const { x: cx, y: cy, z: cz, fx, fy, fz, rx, rz, ux, uy, uz } = view.camera;
  const { start, lo, hi } = cells;
  const { runs, rowOrder } = view;
  const scale = fixedDistance ? 1 : view.detail * view.detail;
  const tanY = TAN_HALF_FOV * view.camera.wide;
  const tanX = tanY * view.aspect;
  const half = CELL_SIZE * 0.5;
  const reach = half + margin;
  const min2 = minDistance * minDistance * scale;
  const max2 = maxDistance * maxDistance * scale;
  let count = 0;
  for (let k = 0; k < CELLS; k++) {
    const rowIndex = rowOrder[k]!;
    const row = rowIndex * CELLS;
    const pz = ORIGIN_Z + (rowIndex + 0.5) * CELL_SIZE - cz;
    const edgeZ = Math.max(Math.abs(pz) - half, 0);
    let run = -1;
    for (let x = 0; x <= CELLS; x++) {
      const c = row + x;
      let visible = false;
      if (x < CELLS) {
        const l = lo[c]!;
        const h = hi[c]!;
        // an empty cell has lo > hi
        if (l <= h) {
          const px = ORIGIN_X + (x + 0.5) * CELL_SIZE - cx;
          const py = (l + h) * 0.5 - cy;
          const reachY = (h - l) * 0.5 + margin;
          const edgeX = Math.max(Math.abs(px) - half, 0);
          const d2 = edgeX * edgeX + edgeZ * edgeZ;
          if (d2 < max2 && d2 >= min2) {
            // the cell's box against the view frustum: furthest it reaches forward, then sideways and upwards
            const forward =
              px * fx + py * fy + pz * fz + reach * Math.abs(fx) + reachY * Math.abs(fy) + reach * Math.abs(fz);
            if (forward >= 0 && Math.abs(px * rx + pz * rz) - reach * (Math.abs(rx) + Math.abs(rz)) <= forward * tanX) {
              visible =
                Math.abs(px * ux + py * uy + pz * uz) - reach * (Math.abs(ux) + Math.abs(uz)) - reachY * Math.abs(uy) <=
                forward * tanY;
            }
          }
        }
      }
      if (visible) {
        if (run < 0) run = c;
      } else if (run >= 0) {
        const first = start[run]!;
        const items = start[c]! - first;
        if (items > 0) {
          runs[count * 2] = first;
          runs[count * 2 + 1] = items;
          count++;
        }
        run = -1;
      }
    }
  }
  return count;
}
