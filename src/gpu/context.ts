// The WebGPU device and the canvas it draws to.

/** An error whose message is written for the person looking at the page and shown as it is. */
export class StartupError extends Error {}

export interface Gpu {
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;
  readonly queue: GPUQueue;
  readonly canvas: HTMLCanvasElement;
  readonly context: GPUCanvasContext;
  /** The canvas format. The composite pass writes gamma-encoded colour itself, so this is never an -srgb format. */
  readonly format: GPUTextureFormat;
  /** Whether GPU timestamp queries are available. */
  readonly timestamps: boolean;
}

/** The scene is rendered in linear light, well above 1.0, and tone-mapped at the end. */
export const HDR: GPUTextureFormat = 'rgba16float';
export const DEPTH: GPUTextureFormat = 'depth32float';

export async function createGpu(canvas: HTMLCanvasElement): Promise<Gpu> {
  if (!navigator.gpu)
    throw new StartupError(
      'This needs WebGPU, which this browser does not have. It runs in a current Chrome, Edge or Safari.',
    );
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new StartupError('No WebGPU adapter found.');
  const timestamps = adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice({ requiredFeatures: timestamps ? ['timestamp-query'] : [] });
  const context = canvas.getContext('webgpu');
  if (!context) throw new StartupError('This browser could not create a WebGPU canvas.');
  return {
    adapter,
    device,
    queue: device.queue,
    canvas,
    context,
    format: navigator.gpu.getPreferredCanvasFormat(),
    timestamps,
  };
}
