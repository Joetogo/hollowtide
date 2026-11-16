// GPU time per frame, from timestamp queries around the first and the last pass. Results arrive a few frames
// late, through a small ring of read-back buffers, so nothing waits and nothing is allocated per frame.
import type { Gpu } from './context';

export interface FrameTimer {
  /**
   * Call before encoding a frame. Returns the timestampWrites for the first and the last pass, or null when no
   * read-back buffer is free this frame (or timestamps are not available).
   */
  begin(): { first: GPURenderPassTimestampWrites; last: GPURenderPassTimestampWrites } | null;
  /** Call after the last pass has ended, with the same encoder: resolves the queries into a read-back buffer. */
  resolve(encoder: GPUCommandEncoder): void;
  /** Call after submit: starts the read-back. `onTime` gets the frame's GPU time in milliseconds. */
  submitted(): void;
}

export function createFrameTimer(gpu: Gpu, onTime: (ms: number) => void): FrameTimer {
  if (!gpu.timestamps) return { begin: () => null, resolve: () => undefined, submitted: () => undefined };
  const { device } = gpu;
  const querySet = device.createQuerySet({ type: 'timestamp', count: 2 });
  const resolved = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
  const slots = Array.from({ length: 6 }, () => {
    const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const slot = {
      buffer,
      busy: false,
      done: () => {
        const stamps = new BigInt64Array(buffer.getMappedRange());
        const ms = Number(stamps[1]! - stamps[0]!) / 1e6;
        buffer.unmap();
        slot.busy = false;
        onTime(ms);
      },
    };
    return slot;
  });
  const writes = {
    first: { querySet, beginningOfPassWriteIndex: 0 },
    last: { querySet, endOfPassWriteIndex: 1 },
  };
  let current: (typeof slots)[number] | null = null;
  return {
    begin() {
      current = null;
      for (const slot of slots) {
        if (!slot.busy) {
          current = slot;
          break;
        }
      }
      return current ? writes : null;
    },
    resolve(encoder) {
      if (!current) return;
      encoder.resolveQuerySet(querySet, 0, 2, resolved, 0);
      encoder.copyBufferToBuffer(resolved, 0, current.buffer, 0, 16);
    },
    submitted() {
      if (!current) return;
      current.busy = true;
      void current.buffer.mapAsync(GPUMapMode.READ).then(current.done);
    },
  };
}
