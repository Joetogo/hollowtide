// The render targets whose size follows the canvas. They are rebuilt together whenever the render size changes.
import { DEPTH, HDR, type Gpu } from '../gpu/context';

export const BLOOM_LEVELS = 6;

export interface Targets {
  readonly width: number;
  readonly height: number;
  /** 4 with anti-aliasing, 1 without. */
  readonly samples: number;
  /** Multisampled colour the scene is drawn into; null without anti-aliasing (the scene then goes straight to `scene`). */
  readonly msaa: GPUTexture | null;
  /** Scene depth, reversed: 1 at the near plane, 0 infinitely far. Multisampled when `samples` > 1. */
  readonly depth: GPUTexture;
  /** The resolved HDR scene. */
  readonly scene: GPUTexture;
  /** Half-resolution light shafts: as marched, and after the depth-aware blur. Alpha holds view depth. */
  readonly shafts: GPUTexture;
  readonly shaftsBlurred: GPUTexture;
  /** Bloom pyramid: level i is the scene at 1 / 2^(i+1) size. Level 0 ends up holding the finished bloom. */
  readonly bloom: readonly GPUTexture[];
  destroy(): void;
}

export function createTargets(gpu: Gpu, width: number, height: number, samples: number): Targets {
  const { device } = gpu;
  // harness builds also copy into and out of the targets, to feed them reference data and read results back
  const extra = __HARNESS__ ? GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST : 0;
  const sampled = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | extra;
  const make = (label: string, w: number, h: number, format: GPUTextureFormat, usage: number, sampleCount = 1) =>
    device.createTexture({ label, size: [w, h], format, usage, sampleCount });

  const msaa = samples > 1 ? make('scene msaa', width, height, HDR, GPUTextureUsage.RENDER_ATTACHMENT, samples) : null;
  const depth = make(
    'scene depth',
    width,
    height,
    DEPTH,
    GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    samples,
  );
  const scene = make('scene', width, height, HDR, sampled);
  const shafts = make('shafts', width / 2, height / 2, HDR, sampled);
  const shaftsBlurred = make('shafts blurred', width / 2, height / 2, HDR, sampled);
  const bloom: GPUTexture[] = [];
  for (let i = 0; i < BLOOM_LEVELS; i++) {
    bloom.push(make(`bloom ${i}`, Math.max(1, width >> (i + 1)), Math.max(1, height >> (i + 1)), HDR, sampled));
  }
  const all = [msaa, depth, scene, shafts, shaftsBlurred, ...bloom];
  return {
    width,
    height,
    samples,
    msaa,
    depth,
    scene,
    shafts,
    shaftsBlurred,
    bloom,
    destroy: () => all.forEach((t) => t?.destroy()),
  };
}

/**
 * The size to render at for a canvas of `clientWidth` x `clientHeight` CSS pixels: the device-pixel size, scaled
 * down evenly until it fits the pixel budget, and rounded to even numbers (half-size targets rely on that).
 */
export function renderSize(
  clientWidth: number,
  clientHeight: number,
  devicePixelRatio: number,
  pixelBudget: number,
): [width: number, height: number] {
  const deviceWidth = Math.max(2, Math.round(clientWidth * devicePixelRatio));
  const deviceHeight = Math.max(2, Math.round(clientHeight * devicePixelRatio));
  const scale = Math.min(1, Math.sqrt(pixelBudget / (deviceWidth * deviceHeight)));
  return [Math.max(2, Math.round(deviceWidth * scale) & ~1), Math.max(2, Math.round(deviceHeight * scale) & ~1)];
}
