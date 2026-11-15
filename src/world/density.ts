// Fills the density grid on the GPU and reads it back. Runs on the main thread, which owns the device; the result
// is handed to the generator worker.
import { shaderModule } from '../gpu/shader';
import densitySource from '../shaders/density.wgsl';
import { NX, NY, NZ, ORIGIN_X, ORIGIN_Y, ORIGIN_Z, VOXEL } from './grid';
import { ARCHES, CLEARINGS, ROCK_MASSES, TUNNELS } from './layout';

/** The layout's shapes packed for the shader: eight floats each, in the order rock masses, arches, tunnels, clearings. */
export function packShapes(): Float32Array {
  const packed: number[] = [];
  const add = (shape: readonly number[]) => {
    for (let i = 0; i < 8; i++) packed.push(shape[i] ?? 0);
  };
  for (const list of [ROCK_MASSES, ARCHES, TUNNELS, CLEARINGS]) list.forEach(add);
  return new Float32Array(packed);
}

/** The density of every voxel, x fastest then y then z: positive inside rock. About 84 MB. */
export async function computeDensity(device: GPUDevice): Promise<Float32Array<ArrayBuffer>> {
  const module = shaderModule(device, 'density', [], densitySource);
  const pipeline = await device.createComputePipelineAsync({
    label: 'density',
    layout: 'auto',
    compute: { module, entryPoint: 'fill' },
  });
  const bytes = NX * NY * NZ * 4;

  // DensityParams: size (vec4u), origin + voxel size (vec4f), counts (vec4u)
  const params = new ArrayBuffer(48);
  new Uint32Array(params, 0, 3).set([NX, NY, NZ]);
  new Float32Array(params, 16, 4).set([ORIGIN_X, ORIGIN_Y, ORIGIN_Z, VOXEL]);
  new Uint32Array(params, 32, 4).set([ROCK_MASSES.length, ARCHES.length, TUNNELS.length, CLEARINGS.length]);
  const shapes = packShapes();

  const paramBuffer = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const shapeBuffer = device.createBuffer({
    size: shapes.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const grid = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(paramBuffer, 0, params);
  device.queue.writeBuffer(shapeBuffer, 0, shapes);

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(
    0,
    device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: paramBuffer } },
        { binding: 1, resource: { buffer: grid } },
        { binding: 2, resource: { buffer: shapeBuffer } },
      ],
    }),
  );
  pass.dispatchWorkgroups(NX / 4, NY / 4, NZ / 4);
  pass.end();
  encoder.copyBufferToBuffer(grid, 0, readback, 0, bytes);
  device.queue.submit([encoder.finish()]);

  await readback.mapAsync(GPUMapMode.READ);
  const density = new Float32Array(readback.getMappedRange().slice(0));
  readback.unmap();
  for (const buffer of [paramBuffer, shapeBuffer, grid, readback]) buffer.destroy();
  return density;
}
