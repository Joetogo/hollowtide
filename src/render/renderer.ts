// The renderer: owns the frame uniforms, the size-dependent targets and the passes, and draws a frame.
// So far the scene pass only clears; terrain, plants and life are added pass by pass in the next milestones.
import { createCamera, type Camera } from '../camera/camera';
import type { Quality } from '../config/quality';
import type { Gpu } from '../gpu/context';
import { createFrameData, Frame, writeFrame } from './frame';
import { createBlit } from './passes/blit';
import { createBloom } from './passes/bloom';
import { createPost } from './passes/post';
import { createTargets, renderSize, type Targets } from './targets';

/** The most pixels a frame is rendered at; a larger canvas is scaled up from that. */
export const MAX_PIXELS = 2560 * 1440;

export interface Renderer {
  readonly gpu: Gpu;
  readonly camera: Camera;
  /** The frame uniform block as last written. */
  readonly frameData: Float32Array;
  /** Draw-distance scale, 1 = full. */
  detail: number;
  /** Pixel budget for the render size. */
  pixelBudget: number;
  /** The current targets; replaced whenever the render size changes. */
  targets: Targets;
  /** While set, the scene pass is skipped and whatever the scene target holds is composited (used by the harness). */
  holdScene: boolean;
  /** Matches the render size to the canvas. Returns true if the targets were rebuilt. */
  resize(): boolean;
  /** Draws one frame for `time` seconds. */
  render(time: number): void;
}

export async function createRenderer(gpu: Gpu, quality: Quality): Promise<Renderer> {
  const { device, queue, canvas, context } = gpu;
  const linearSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const frameData = createFrameData();
  const frameBuffer = device.createBuffer({
    label: 'frame',
    size: Frame.size,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const [blit, post] = await Promise.all([
    createBlit(gpu, linearSampler),
    createPost(gpu, frameBuffer, linearSampler, quality.samples),
  ]);
  const bloom = createBloom(blit);
  let scenePass: GPURenderPassDescriptor;

  const renderer: Renderer = {
    gpu,
    camera: createCamera(),
    frameData,
    detail: 1,
    pixelBudget: MAX_PIXELS,
    targets: undefined as unknown as Targets, // set by the resize() below
    holdScene: false,

    resize() {
      const [width, height] = renderSize(
        canvas.clientWidth,
        canvas.clientHeight,
        window.devicePixelRatio,
        renderer.pixelBudget,
      );
      const old = renderer.targets as Targets | undefined;
      if (old && old.width === width && old.height === height) return false;
      old?.destroy();
      canvas.width = width;
      canvas.height = height;
      context.configure({ device, format: gpu.format, alphaMode: 'opaque' });
      const targets = (renderer.targets = createTargets(gpu, width, height, quality.samples));
      const sceneView = targets.scene.createView();
      scenePass = {
        colorAttachments: [
          targets.msaa
            ? {
                view: targets.msaa.createView(),
                resolveTarget: sceneView,
                loadOp: 'clear',
                storeOp: 'discard',
                clearValue: [0, 0, 0, 1],
              }
            : { view: sceneView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
        ],
        // reversed depth: cleared to 0, which is infinitely far
        depthStencilAttachment: {
          view: targets.depth.createView(),
          depthClearValue: 0,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      };
      bloom.resize(targets);
      post.resize(targets);
      return true;
    },

    render(time) {
      const { targets } = renderer;
      writeFrame(frameData, renderer.camera, targets.width, targets.height, time, renderer.detail);
      queue.writeBuffer(frameBuffer, 0, frameData);
      const encoder = device.createCommandEncoder();
      if (!renderer.holdScene) encoder.beginRenderPass(scenePass).end();
      bloom.encode(encoder);
      post.encode(encoder, context.getCurrentTexture().createView());
      queue.submit([encoder.finish()]);
    },
  };
  renderer.resize();
  return renderer;
}
