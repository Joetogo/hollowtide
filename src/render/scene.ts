// What every scene shader binds: the frame block, three samplers, the five shared textures and the lamp.
import type { Quality } from '../config/quality';
import { group } from '../gpu/bindings';
import { DEPTH, HDR, type Gpu } from '../gpu/context';
import { NX, NY, NZ } from '../world/grid';
import { createFrameData, Frame } from './frame';
import { createLampData, Lamp } from './lamp';

export const SceneGroup = group(0, {
  frame: Frame,
  repeatSampler: 'sampler', // tiling textures: water, rock detail
  clampSampler: 'sampler', // volume, ground map
  shadowSampler: 'sampler_comparison',
  shadowMap: 'texture_depth_2d',
  waterTexture: 'texture_2d<f32>',
  detailTexture: 'texture_2d<f32>',
  volumeTexture: 'texture_3d<f32>',
  groundMap: 'texture_2d<f32>',
  lamp: Lamp, // the swimmer's light (render/lamp.ts)
});

export const DETAIL_SIZE = 1024;
export const GROUND_MAP_SIZE = 512;

export interface Scene {
  readonly layout: GPUBindGroupLayout;
  readonly pipelineLayout: GPUPipelineLayout;
  /** The frame block of the main view, and the buffer it is uploaded to. */
  readonly frameData: Float32Array;
  readonly frameBuffer: GPUBuffer;
  /** The lamp block (render/lamp.ts), uploaded with every frame. */
  readonly lampData: Float32Array;
  readonly lampBuffer: GPUBuffer;
  readonly linearSampler: GPUSampler;
  readonly repeatSampler: GPUSampler;
  readonly shadowSampler: GPUSampler;
  readonly shadowMap: GPUTexture;
  readonly shadowSize: number;
  readonly water: GPUTexture;
  readonly waterSize: number;
  readonly detail: GPUTexture;
  readonly volume: GPUTexture;
  readonly groundMap: GPUTexture;
  /** For drawing the scene. */
  readonly bindGroup: GPUBindGroup;
  /** For the shadow bake: the view is the sun's, and the shadow map (being drawn to) is swapped for a dummy. */
  readonly shadowBindGroup: GPUBindGroup;
}

export function createScene(gpu: Gpu, quality: Quality): Scene {
  const { device, queue } = gpu;
  const { shadowSize, waterSize } = quality;
  // harness builds also read the bakes back, to compare them with the original's
  const readable = __HARNESS__ ? GPUTextureUsage.COPY_SRC : 0;
  const drawn = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | readable;
  const uploaded = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;

  const repeatSampler = device.createSampler({
    addressModeU: 'repeat',
    addressModeV: 'repeat',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    maxAnisotropy: quality.low ? 1 : 8,
  });
  const linearSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const shadowSampler = device.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' });

  const shadowMap = device.createTexture({
    label: 'shadow map',
    size: [shadowSize, shadowSize],
    format: DEPTH,
    usage: drawn,
  });
  const shadowDummy = device.createTexture({ label: 'shadow dummy', size: [1, 1], format: DEPTH, usage: drawn });
  const water = device.createTexture({
    label: 'water',
    size: [waterSize, waterSize],
    format: HDR,
    usage: drawn,
    mipLevelCount: 5,
  });
  const detail = device.createTexture({
    label: 'rock detail',
    size: [DETAIL_SIZE, DETAIL_SIZE],
    format: 'rgba8unorm',
    usage: drawn,
    mipLevelCount: 11,
  });
  const volume = device.createTexture({
    label: 'volume',
    size: [NX / 2, NY / 2, NZ / 2],
    dimension: '3d',
    format: 'rg8unorm',
    usage: uploaded,
  });
  const groundMap = device.createTexture({
    label: 'ground map',
    size: [GROUND_MAP_SIZE, GROUND_MAP_SIZE],
    format: 'rgba8unorm',
    usage: uploaded,
  });

  const frameData = createFrameData();
  const uniform = (label: string) =>
    device.createBuffer({ label, size: Frame.size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const frameBuffer = uniform('frame');

  // The sun's view for the shadow bake: the shadow matrix is also the view-projection, time stands still at 0,
  // and a render size of 0 tells the vertex shaders that this is the bake.
  const shadowFrame = createFrameData();
  shadowFrame.copyWithin(Frame.at.viewProj, Frame.at.shadowMat, Frame.at.shadowMat + 16);
  shadowFrame[Frame.at.camPos + 1] = -20;
  shadowFrame[Frame.at.shaftGain] = 0;
  shadowFrame[Frame.at.detail] = 1;
  const shadowFrameBuffer = uniform('shadow frame');
  queue.writeBuffer(shadowFrameBuffer, 0, shadowFrame);

  const lampData = createLampData();
  const lampBuffer = device.createBuffer({
    label: 'lamp',
    size: Lamp.size,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  queue.writeBuffer(lampBuffer, 0, lampData);

  const layout = SceneGroup.layout(device);
  const bind = (frame: GPUBuffer, shadow: GPUTexture) =>
    SceneGroup.bind(device, layout, {
      frame: { buffer: frame },
      repeatSampler,
      clampSampler: linearSampler,
      shadowSampler,
      shadowMap: shadow.createView(),
      waterTexture: water.createView(),
      detailTexture: detail.createView(),
      volumeTexture: volume.createView(),
      groundMap: groundMap.createView(),
      lamp: { buffer: lampBuffer },
    });

  return {
    layout,
    pipelineLayout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    frameData,
    frameBuffer,
    lampData,
    lampBuffer,
    linearSampler,
    repeatSampler,
    shadowSampler,
    shadowMap,
    shadowSize,
    water,
    waterSize,
    detail,
    volume,
    groundMap,
    bindGroup: bind(frameBuffer, shadowMap),
    shadowBindGroup: bind(shadowFrameBuffer, shadowDummy),
  };
}
