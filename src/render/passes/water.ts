// The animated water texture, redrawn at the start of every frame, with its mip chain.
import { group } from '../../gpu/bindings';
import type { Gpu } from '../../gpu/context';
import { shaderModule } from '../../gpu/shader';
import { struct } from '../../gpu/struct';
import waterSource from '../../shaders/water.wgsl';
import type { Blit } from './blit';

export const WaterClock = struct('WaterClock', { time: 'f32' });
export const WaterGroup = group(0, { clock: WaterClock });

export interface Water {
  /** Draws the texture for `time` seconds. */
  encode(encoder: GPUCommandEncoder, time: number): void;
}

export async function createWater(gpu: Gpu, blit: Blit, texture: GPUTexture): Promise<Water> {
  const { device, queue } = gpu;
  const layout = WaterGroup.layout(device, GPUShaderStage.FRAGMENT);
  const module = shaderModule(device, 'water', [WaterGroup], waterSource);
  const pipeline = await device.createRenderPipelineAsync({
    label: 'water',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'fullscreenVertex' },
    fragment: {
      module,
      entryPoint: 'drawWater',
      targets: [{ format: texture.format }],
      constants: { WATER_SIZE: texture.width },
    },
  });
  const clock = new Float32Array(4); // a uniform buffer cannot be smaller than 16 bytes
  const clockBuffer = device.createBuffer({
    label: 'water clock',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const clockGroup = WaterGroup.bind(device, layout, { clock: { buffer: clockBuffer } });

  const views = Array.from({ length: texture.mipLevelCount }, (_, mip) =>
    texture.createView({ baseMipLevel: mip, mipLevelCount: 1 }),
  );
  const passes = views.map((view): GPURenderPassDescriptor => ({
    colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
  }));
  const sources = views.map((view) => blit.source(view));

  return {
    encode(encoder, time) {
      clock[WaterClock.at.time] = time;
      queue.writeBuffer(clockBuffer, 0, clock);
      let pass = encoder.beginRenderPass(passes[0]!);
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, clockGroup);
      pass.draw(3);
      pass.end();
      for (let mip = 1; mip < passes.length; mip++) {
        pass = encoder.beginRenderPass(passes[mip]!);
        pass.setPipeline(blit.mip16);
        pass.setBindGroup(0, sources[mip - 1]!);
        pass.draw(3);
        pass.end();
      }
    },
  };
}
