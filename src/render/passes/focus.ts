// Depth of field, for photographs: the scene is drawn again with what is nearer or further than one distance out
// of focus (src/shaders/focus.wgsl), and the composite pass is given that instead of the scene. Nothing of it
// exists until it is first asked for, and its textures are let go when it is switched off.
import { group } from '../../gpu/bindings';
import { HDR, type Gpu } from '../../gpu/context';
import { shaderModule } from '../../gpu/shader';
import focusSource from '../../shaders/focus.wgsl';
import { Frame } from '../frame';
import type { Targets } from '../targets';
import type { Blit } from './blit';

/** The scene depth is multisampled when anti-aliasing is on, which is a different WGSL texture type. */
export const focusGroup = (multisampled: boolean) =>
  group(0, {
    frame: Frame,
    linearSampler: 'sampler',
    sceneTexture: 'texture_2d<f32>',
    halfTexture: 'texture_2d<f32>',
    depthTexture: multisampled ? 'texture_depth_multisampled_2d' : 'texture_depth_2d',
    focusTexture: 'texture_2d<f32>',
  });

export interface Focus {
  /** The picture has another size: what was made for the old one is let go. */
  resize(targets: Targets): void;
  /** Lets go of the textures: the focus has been switched off. */
  release(): void;
  /**
   * Draws the scene softened and returns a view of the result, for the composite pass. With `take`, first notes
   * how far away the middle of the picture is: the lens is held at that distance until the next time. Call it
   * after the scene pass.
   */
  encode(encoder: GPUCommandEncoder, take: boolean): GPUTextureView;
}

interface Step {
  pipeline: GPURenderPipeline;
  source: GPUBindGroup;
  pass: GPURenderPassDescriptor;
}

export function createFocus(
  gpu: Gpu,
  frameBuffer: GPUBuffer,
  linearSampler: GPUSampler,
  blit: Blit,
  samples: number,
): Focus {
  const { device } = gpu;
  const Group = focusGroup(samples > 1);
  const layout = Group.layout(device, GPUShaderStage.FRAGMENT);
  const module = shaderModule(device, 'focus', [Group], focusSource);
  const pipeline = (entryPoint: string) =>
    device.createRenderPipeline({
      label: entryPoint,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'fullscreenVertex' },
      fragment: { module, entryPoint, targets: [{ format: HDR }] },
    });
  const latch = pipeline('latch');
  const soften = pipeline('soften');
  const texture = (label: string, width: number, height: number) =>
    device.createTexture({
      label,
      size: [width, height],
      format: HDR,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
  const into = (view: GPUTextureView): GPURenderPassDescriptor => ({
    colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
  });
  // the distance the lens is held at: one texel, which outlives every change of size
  const held = texture('focus distance', 1, 1).createView();
  let targets: Targets | null = null;
  let made: { textures: GPUTexture[]; half: Step; take: Step; soft: Step; view: GPUTextureView } | null = null;
  const release = () => {
    made?.textures.forEach((each) => each.destroy());
    made = null;
  };
  return {
    resize(next) {
      targets = next;
      release();
    },
    release,
    encode(encoder, take) {
      if (!made) {
        const { width, height, scene, depth } = targets!;
        const half = texture('scene at half size', width >> 1, height >> 1);
        const soft = texture('scene softened', width, height);
        const [sceneView, halfView, view] = [scene.createView(), half.createView(), soft.createView()];
        const bind = (focusTexture: GPUTextureView) =>
          Group.bind(device, layout, {
            frame: { buffer: frameBuffer },
            linearSampler,
            sceneTexture: sceneView,
            halfTexture: halfView,
            depthTexture: depth.createView(),
            focusTexture,
          });
        made = {
          textures: [half, soft],
          half: { pipeline: blit.mip16, source: blit.source(sceneView), pass: into(halfView) },
          // (while the distance is being written it cannot also be read: that binding is given the scene, unread)
          take: { pipeline: latch, source: bind(sceneView), pass: into(held) },
          soft: { pipeline: soften, source: bind(held), pass: into(view) },
          view,
        };
      }
      for (const step of take ? [made.half, made.take, made.soft] : [made.half, made.soft]) {
        const pass = encoder.beginRenderPass(step.pass);
        pass.setPipeline(step.pipeline);
        pass.setBindGroup(0, step.source);
        pass.draw(3);
        pass.end();
      }
      return made.view;
    },
  };
}
