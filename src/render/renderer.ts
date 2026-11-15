// The renderer: owns the shared scene resources, the size-dependent targets and the passes, and draws a frame.
// So far the scene pass only clears; terrain, plants and life are added pass by pass in the next milestones.
import { createCamera, type Camera } from '../camera/camera';
import type { Quality } from '../config/quality';
import type { Gpu } from '../gpu/context';
import type { WorldData } from '../world/data';
import { createCullView, updateCullView } from './cull';
import { writeFrame } from './frame';
import { createBlit } from './passes/blit';
import { createBloom } from './passes/bloom';
import { bakeDetail } from './passes/detail';
import { createPost } from './passes/post';
import { createScenePass } from './passes/scene';
import { createShadowBake } from './passes/shadow';
import { createWater } from './passes/water';
import { createScene, type Scene } from './scene';
import { createTargets, renderSize, type Targets } from './targets';
import { uploadWorld, type WorldBuffers } from './world';

/** The most pixels a frame is rendered at; a larger canvas is scaled up from that. */
export const MAX_PIXELS = 2560 * 1440;

export interface Renderer {
  readonly gpu: Gpu;
  readonly camera: Camera;
  /** Samplers, the frame block and the textures every scene shader shares. */
  readonly scene: Scene;
  /** The world on the GPU, once setWorld() has been given one. */
  world: WorldBuffers | null;
  /** Draw-distance scale, 1 = full. */
  detail: number;
  /** Pixel budget for the render size. */
  pixelBudget: number;
  /** The current targets; replaced whenever the render size changes. */
  targets: Targets;
  /** While set, the scene pass is skipped and whatever the scene target holds is composited (used by the harness). */
  holdScene: boolean;
  /** Uploads a world and bakes the shadow map for it. */
  setWorld(data: WorldData): void;
  /** Matches the render size to the canvas. Returns true if the targets were rebuilt. */
  resize(): boolean;
  /** Draws one frame for `time` seconds. */
  render(time: number): void;
}

export async function createRenderer(gpu: Gpu, quality: Quality): Promise<Renderer> {
  const { device, queue, canvas, context } = gpu;
  const scene = createScene(gpu, quality);
  const [blit, post, shadow, sceneDraw] = await Promise.all([
    createBlit(gpu, scene.linearSampler),
    createPost(gpu, scene.frameBuffer, scene.linearSampler, quality.samples),
    createShadowBake(gpu, scene, quality),
    createScenePass(gpu, scene, quality),
  ]);
  const [water] = await Promise.all([createWater(gpu, blit, scene.water), bakeDetail(gpu, blit, scene.detail)]);
  const bloom = createBloom(blit);
  let scenePass: GPURenderPassDescriptor;
  const camera = createCamera();
  const cullView = createCullView(camera);

  const renderer: Renderer = {
    gpu,
    camera,
    scene,
    world: null,
    detail: 1,
    pixelBudget: MAX_PIXELS,
    targets: undefined as unknown as Targets, // set by the resize() below
    holdScene: false,

    setWorld(data) {
      renderer.world?.destroy();
      renderer.world = uploadWorld(gpu, scene, data);
      shadow.bake(renderer.world);
    },

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
      writeFrame(scene.frameData, renderer.camera, targets.width, targets.height, time, renderer.detail);
      queue.writeBuffer(scene.frameBuffer, 0, scene.frameData);
      const encoder = device.createCommandEncoder();
      water.encode(encoder, time);
      if (!renderer.holdScene) {
        const pass = encoder.beginRenderPass(scenePass);
        if (renderer.world) {
          updateCullView(cullView, targets.width, targets.height, renderer.detail);
          sceneDraw.encode(pass, renderer.world, cullView);
        }
        pass.end();
      }
      bloom.encode(encoder);
      post.encode(encoder, context.getCurrentTexture().createView());
      queue.submit([encoder.finish()]);
    },
  };
  renderer.resize();
  return renderer;
}
