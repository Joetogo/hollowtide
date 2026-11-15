// Messages between the main thread and the world-generation worker.
// Buffers always travel as transferables: ownership moves, nothing is copied.
import type { Level } from '../config/quality';

export type ToWorker =
  /** a transfer test: the worker sends the buffer straight back */
  | { type: 'echo'; buffer: ArrayBuffer }
  /**
   * Build the world from the density field (as it comes off the GPU). With `checksums`, the worker also reports
   * the SHA-256 of everything it makes, for comparing against the original.
   */
  | { type: 'generate'; density: ArrayBuffer; level: Level; checksums: boolean };

export type FromWorker =
  | { type: 'ready' }
  | { type: 'echo'; buffer: ArrayBuffer; checksum: number }
  | { type: 'checksum'; name: string; length: number; sha256: string }
  | { type: 'done' }
  | { type: 'error'; stage: string; message: string };

/** Sum of the buffer's 32-bit words, wrapped to 32 bits. Cheap proof that a transfer arrived intact. */
export function checksum(buffer: ArrayBuffer): number {
  const words = new Uint32Array(buffer, 0, buffer.byteLength >> 2);
  let sum = 0;
  for (let i = 0; i < words.length; i++) sum = (sum + words[i]!) >>> 0;
  return sum;
}
