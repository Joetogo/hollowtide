// Light shafts: marched at half resolution after the scene, then blurred. The composite pass adds them.
import type { Quality } from '../../config/quality';
import { group } from '../../gpu/bindings';
import { HDR, type Gpu } from '../../gpu/context';
import { shaderModule } from '../../gpu/shader';
import blurSource from '../../shaders/shafts-blur.wgsl';
import shaftsSource from '../../shaders/shafts.wgsl';
import { Frame } from '../frame';
import type { Scene } from '../scene';
import type { Targets } from '../targets';

/** The scene depth is multisampled when anti-aliasing is on, which is a different WGSL texture type. */
export const shaftsGroup = (multisampled: boolean) =>
  group(0, {
    frame: Frame,
    repeatSampler: 'sampler',
    clampSampler: 'sampler',
    shadowSampler: 'sampler_comparison',
    shadowMap: 'texture_depth_2d',
    waterTexture: 'texture_2d<f32>',
    volumeTexture: 'texture_3d<f32>',
    depthTexture: multisampled ? 'texture_depth_multisampled_2d' : 'texture_depth_2d',
  });
export const ShaftsBlurGroup = group(0, { shaftsTexture: 'texture_2d<f32>' });

export interface Shafts {
  resize(targets: Targets): void;
  encode(encoder: GPUCommandEncoder): void;
}

export async function createShafts(gpu: Gpu, scene: Scene, quality: Quality): Promise<Shafts> {
  const { device } = gpu;
  const Group = shaftsGroup(quality.samples > 1);
  const layout = Group.layout(device, GPUShaderStage.FRAGMENT);
  const blurLayout = ShaftsBlurGroup.layout(device, GPUShaderStage.FRAGMENT);
  const marchModule = shaderModule(device, 'shafts', [Group], shaftsSource);
  const blurModule = shaderModule(device, 'shafts blur', [ShaftsBlurGroup], blurSource);
  const [march, blur] = await Promise.all([
    device.createRenderPipelineAsync({
      label: 'shafts',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module: marchModule, entryPoint: 'fullscreenVertex' },
      fragment: {
        module: marchModule,
        entryPoint: 'marchShafts',
        targets: [{ format: HDR }],
        constants: { RAY_STEPS: quality.raySteps },
      },
    }),
    device.createRenderPipelineAsync({
      label: 'shafts blur',
      layout: device.createPipelineLayout({ bindGroupLayouts: [blurLayout] }),
      vertex: { module: blurModule, entryPoint: 'fullscreenVertex' },
      fragment: { module: blurModule, entryPoint: 'blurShafts', targets: [{ format: HDR }] },
    }),
  ]);
  const { repeatSampler, linearSampler, shadowSampler } = scene;
  let marchGroup: GPUBindGroup | null = null;
  let blurGroup: GPUBindGroup | null = null;
  let marchPass: GPURenderPassDescriptor;
  let blurPass: GPURenderPassDescriptor;
  const cleared = (view: GPUTextureView): GPURenderPassDescriptor => ({
    colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
  });
  return {
    resize(targets) {
      const raw = targets.shafts.createView();
      marchGroup = Group.bind(device, layout, {
        frame: { buffer: scene.frameBuffer },
        repeatSampler,
        clampSampler: linearSampler,
        shadowSampler,
        shadowMap: scene.shadowMap.createView(),
        waterTexture: scene.water.createView(),
        volumeTexture: scene.volume.createView(),
        depthTexture: targets.depth.createView(),
      });
      blurGroup = ShaftsBlurGroup.bind(device, blurLayout, { shaftsTexture: raw });
      marchPass = cleared(raw);
      blurPass = cleared(targets.shaftsBlurred.createView());
    },
    encode(encoder) {
      let pass = encoder.beginRenderPass(marchPass);
      pass.setPipeline(march);
      pass.setBindGroup(0, marchGroup);
      pass.draw(3);
      pass.end();
      pass = encoder.beginRenderPass(blurPass);
      pass.setPipeline(blur);
      pass.setBindGroup(0, blurGroup);
      pass.draw(3);
      pass.end();
    },
  };
}
