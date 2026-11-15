// Messages between the main thread and the world-generation worker.
// Buffers always travel as transferables: ownership moves, nothing is copied.

export type ToWorker = { type: 'echo'; buffer: ArrayBuffer };

export type FromWorker =
  | { type: 'ready' }
  | { type: 'echo'; buffer: ArrayBuffer; checksum: number }
  | { type: 'error'; stage: string; message: string };

/** Sum of the buffer's 32-bit words, wrapped to 32 bits. Cheap proof that a transfer arrived intact. */
export function checksum(buffer: ArrayBuffer): number {
  const words = new Uint32Array(buffer, 0, buffer.byteLength >> 2);
  let sum = 0;
  for (let i = 0; i < words.length; i++) sum = (sum + words[i]!) >>> 0;
  return sum;
}
