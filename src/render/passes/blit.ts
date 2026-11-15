// Full-screen copies: mip generation and the bloom steps share one shader module and one bind group shape.
import { group } from '../../gpu/bindings';
import { HDR, type Gpu } from '../../gpu/context';
import { shaderModule } from '../../gpu/shader';
import blitSource from '../../shaders/blit.wgsl';

export const BlitGroup = group(0, { sourceTexture: 'texture_2d<f32>', linearSampler: 'sampler' });

const ADDITIVE: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'one' },
  alpha: { srcFactor: 'one', dstFactor: 'one' },
};

export interface Blit {
  readonly mip8: GPURenderPipeline; // rgba8unorm targets
  readonly mip16: GPURenderPipeline; // HDR targets
  readonly bloomDownFirst: GPURenderPipeline;
  readonly bloomDown: GPURenderPipeline;
  readonly bloomUp: GPURenderPipeline; // additive
  /** A bind group that reads `view` through the linear clamp sampler. */
  source(view: GPUTextureView): GPUBindGroup;
}

export async function createBlit(gpu: Gpu, linearSampler: GPUSampler): Promise<Blit> {
  const { device } = gpu;
  const layout = BlitGroup.layout(device, GPUShaderStage.FRAGMENT);
  const module = shaderModule(device, 'blit', [BlitGroup], blitSource);
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const pipeline = (entryPoint: string, format: GPUTextureFormat, blend?: GPUBlendState) =>
    device.createRenderPipelineAsync({
      label: entryPoint,
      layout: pipelineLayout,
      vertex: { module, entryPoint: 'fullscreenVertex' },
      fragment: { module, entryPoint, targets: [{ format, blend }] },
    });
  const [mip8, mip16, bloomDownFirst, bloomDown, bloomUp] = await Promise.all([
    pipeline('mip', 'rgba8unorm'),
    pipeline('mip', HDR),
    pipeline('bloomDownFirst', HDR),
    pipeline('bloomDown', HDR),
    pipeline('bloomUp', HDR, ADDITIVE),
  ]);
  return {
    mip8,
    mip16,
    bloomDownFirst,
    bloomDown,
    bloomUp,
    source: (view) => BlitGroup.bind(device, layout, { sourceTexture: view, linearSampler }),
  };
}
