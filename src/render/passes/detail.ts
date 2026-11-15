// The rock detail texture: drawn once at start-up, then reduced into its mip chain.
import type { Gpu } from '../../gpu/context';
import { shaderModule } from '../../gpu/shader';
import detailSource from '../../shaders/detail.wgsl';
import type { Blit } from './blit';

export async function bakeDetail(gpu: Gpu, blit: Blit, texture: GPUTexture): Promise<void> {
  const { device, queue } = gpu;
  const module = shaderModule(device, 'detail', [], detailSource);
  const pipeline = await device.createRenderPipelineAsync({
    label: 'detail bake',
    layout: 'auto',
    vertex: { module, entryPoint: 'fullscreenVertex' },
    fragment: { module, entryPoint: 'bakeDetail', targets: [{ format: texture.format }] },
  });
  const level = (mip: number) => texture.createView({ baseMipLevel: mip, mipLevelCount: 1 });
  const encoder = device.createCommandEncoder();
  const draw = (target: GPUTextureView, run: (pass: GPURenderPassEncoder) => void) => {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
    });
    run(pass);
    pass.draw(3);
    pass.end();
  };
  draw(level(0), (pass) => pass.setPipeline(pipeline));
  for (let mip = 1; mip < texture.mipLevelCount; mip++) {
    draw(level(mip), (pass) => {
      pass.setPipeline(blit.mip8);
      pass.setBindGroup(0, blit.source(level(mip - 1)));
    });
  }
  queue.submit([encoder.finish()]);
}
