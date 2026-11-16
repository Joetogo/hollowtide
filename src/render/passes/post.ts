// The composite pass: scene + light shafts + bloom, graded and written to the canvas.
import { group, type Group } from '../../gpu/bindings';
import type { Gpu } from '../../gpu/context';
import { shaderModule } from '../../gpu/shader';
import postSource from '../../shaders/post.wgsl';
import { Frame } from '../frame';
import type { Targets } from '../targets';

/** The scene depth is multisampled when anti-aliasing is on, which is a different WGSL texture type. */
export const postGroup = (multisampled: boolean) =>
  group(0, {
    frame: Frame,
    linearSampler: 'sampler',
    sceneTexture: 'texture_2d<f32>',
    shaftsTexture: 'texture_2d<f32>',
    bloomTexture: 'texture_2d<f32>',
    depthTexture: multisampled ? 'texture_depth_multisampled_2d' : 'texture_depth_2d',
  });

export interface Post {
  resize(targets: Targets): void;
  /** The frame's last pass, so it can carry the closing timestamp. */
  encode(encoder: GPUCommandEncoder, canvasView: GPUTextureView, timestamp?: GPURenderPassTimestampWrites): void;
}

export async function createPost(
  gpu: Gpu,
  frameBuffer: GPUBuffer,
  linearSampler: GPUSampler,
  samples: number,
  coarse = false,
): Promise<Post> {
  const { device } = gpu;
  const Group: Group<ReturnType<typeof postGroup>['resources']> = postGroup(samples > 1);
  const layout = Group.layout(device, GPUShaderStage.FRAGMENT);
  const module = shaderModule(device, 'post', [Group], postSource);
  // one pipeline for each size the shafts come in (see passes/shafts.ts)
  const compositeAt = (scale: number) =>
    device.createRenderPipelineAsync({
      label: 'composite',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'fullscreenVertex' },
      fragment: {
        module,
        entryPoint: 'composite',
        targets: [{ format: gpu.format }],
        constants: { SHAFT_STEP: 1 / scale },
      },
    });
  const [pipeline, pipelineCoarse] = await Promise.all([compositeAt(2), coarse ? compositeAt(3) : null]);
  let scale = 2;
  let bindGroup: GPUBindGroup | null = null;
  const attachment: GPURenderPassColorAttachment = {
    view: undefined as unknown as GPUTextureView, // set every frame: the canvas hands out a new texture each time
    loadOp: 'clear',
    storeOp: 'store',
    clearValue: [0, 0, 0, 1],
  };
  const pass: GPURenderPassDescriptor = { colorAttachments: [attachment] };
  return {
    resize(targets) {
      scale = targets.shaftScale;
      bindGroup = Group.bind(device, layout, {
        frame: { buffer: frameBuffer },
        linearSampler,
        sceneTexture: targets.scene.createView(),
        shaftsTexture: targets.shaftsBlurred.createView(),
        bloomTexture: targets.bloom[0]!.createView(),
        depthTexture: targets.depth.createView(),
      });
    },
    encode(encoder, canvasView, timestamp) {
      attachment.view = canvasView;
      pass.timestampWrites = timestamp;
      const p = encoder.beginRenderPass(pass);
      p.setPipeline(scale === 3 && pipelineCoarse ? pipelineCoarse : pipeline);
      p.setBindGroup(0, bindGroup);
      p.draw(3);
      p.end();
    },
  };
}
