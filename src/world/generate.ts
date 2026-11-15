// The world-generation worker. For now it only answers the scaffold's transfer test; the generator stages
// (speck removal, collision bricks, terrain, scattering, meshes) arrive in milestones 7 and 8.
import { checksum, type FromWorker, type ToWorker } from './protocol';

/** The part of a dedicated worker's global scope this module uses. */
export interface WorkerScope {
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker, transfer: Transferable[]): void;
}

export function bootWorker(scope: WorkerScope): void {
  scope.onmessage = ({ data }) => {
    try {
      switch (data.type) {
        case 'echo':
          scope.postMessage({ type: 'echo', buffer: data.buffer, checksum: checksum(data.buffer) }, [data.buffer]);
          break;
      }
    } catch (error) {
      scope.postMessage({ type: 'error', stage: data.type, message: String(error) }, []);
    }
  };
  scope.postMessage({ type: 'ready' }, []);
}
