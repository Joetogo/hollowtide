// The renderer: owns the shared scene resources, the size-dependent targets and the passes, and draws a frame.
// So far the scene pass only clears; terrain, plants and life are added pass by pass in the next milestones.
import { createCamera, type Camera } from '../camera/camera';
import type { Quality } from '../config/quality';
import type { Gpu } from '../gpu/context';
import { createFrameTimer } from '../gpu/timing';
import type { WorldData } from '../world/data';
import { createCullView, updateCullView } from './cull';
import { MAX_PIXELS } from './dynres';
import { writeFrame } from './frame';
import { createBlit } from './passes/blit';
import { createBloom } from './passes/bloom';
import { bakeDetail } from './passes/detail';
import { createPost } from './passes/post';
import { createScenePass, skipped } from './passes/scene';
import { createShadowBake } from './passes/shadow';
import { createShafts } from './passes/shafts';
import { createWater } from './passes/water';
import { createScene, type Scene } from './scene';
import { createTargets, renderSize, type Targets } from './targets';
import { uploadWorld, type WorldBuffers } from './world';
import type { BodyMeshes } from '../body/meshes';
import { createBodyParts, type BodyParts } from '../body/rig';
import { createBodyPass } from './passes/body';
import type { Tuning } from '../config/tuning';

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
  /** The swimmer's body as it is to be drawn in the next frame: the app poses it, `count` 0 draws none. */
  readonly body: BodyParts;
  /** Gives the body its meshes. */
  setBody(meshes: BodyMeshes): void;
  /** Uploads a world and bakes the shadow map for it. */
  setWorld(data: WorldData): Promise<void>;
  /** Matches the render size to the canvas. Returns true if the targets were rebuilt. */
  resize(): boolean;
  /** Draws one frame for `time` seconds. */
  render(time: number): void;
}

/** @param onGpuTime called with each frame's GPU time in milliseconds, a few frames late, where the GPU can measure it */
export async function createRenderer(
  gpu: Gpu,
  quality: Quality,
  tuning: Tuning,
  onGpuTime: (ms: number) => void = () => undefined,
): Promise<Renderer> {
  const { device, queue, canvas, context } = gpu;
  const scene = createScene(gpu, quality);
  const [blit, post, shadow, sceneDraw, shafts, bodyDraw] = await Promise.all([
    createBlit(gpu, scene.linearSampler),
    createPost(gpu, scene.frameBuffer, scene.linearSampler, quality.samples),
    createShadowBake(gpu, scene, quality, tuning),
    createScenePass(gpu, scene, quality, tuning),
    createShafts(gpu, scene, quality),
    createBodyPass(gpu, scene, quality),
  ]);
  const [water] = await Promise.all([createWater(gpu, blit, scene.water), bakeDetail(gpu, blit, scene.detail)]);
  const bloom = createBloom(blit);
  const timer = createFrameTimer(gpu, onGpuTime);
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
    body: createBodyParts(),
    setBody: (meshes) => bodyDraw.setMeshes(meshes),

    async setWorld(data) {
      const next = await uploadWorld(gpu, scene, data, tuning.cullSprites);
      renderer.world?.destroy();
      renderer.world = next;
      shadow.bake(next);
      void queue.onSubmittedWorkDone().then(() => performance.mark('hollowtide:shadows'));
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
      shafts.resize(targets);
      bloom.resize(targets);
      post.resize(targets);
      return true;
    },

    render(time) {
      const { targets } = renderer;
      writeFrame(scene.frameData, renderer.camera, targets.width, targets.height, time, renderer.detail);
      queue.writeBuffer(scene.frameBuffer, 0, scene.frameData);
      const encoder = device.createCommandEncoder();
      const stamps = timer.begin();
      if (!skipped('water')) water.encode(encoder, time, stamps?.first);
      if (!renderer.holdScene) {
        const pass = encoder.beginRenderPass(scenePass);
        if (renderer.world) {
          updateCullView(cullView, targets.width, targets.height, renderer.detail);
          bodyDraw.encode(pass, renderer.body); // nearest first
          sceneDraw.encode(pass, renderer.world, cullView);
        }
        pass.end();
        // with no world there is no shadow map to march through, and the shafts stay empty
        if (renderer.world) shafts.encode(encoder, skipped('shafts'));
      }
      if (!skipped('bloom')) bloom.encode(encoder);
      post.encode(encoder, context.getCurrentTexture().createView(), stamps?.last);
      timer.resolve(encoder);
      queue.submit([encoder.finish()]);
      timer.submitted();
    },
  };
  renderer.resize();
  return renderer;
}
