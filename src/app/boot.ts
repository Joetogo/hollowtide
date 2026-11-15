// Main-thread start-up. At this milestone it proves the scaffold end to end and reports what it found:
//   - the worker starts from the page's own script and a 16 MB buffer survives a round trip by transfer
//   - a struct and bind group defined in TypeScript compile, validate and put the right colour on screen
// The real boot sequence (device, world generation, frame loop) replaces the self-tests from milestone 2 on.
import { declarations, group } from '../gpu/bindings';
import { struct } from '../gpu/struct';
import selfTestSource from '../shaders/selftest.wgsl';
import { checksum, type FromWorker, type ToWorker } from '../world/protocol';

export interface BootReport {
  worker: { megabytes: number; roundTripMs: number; detached: boolean; intact: boolean };
  /** null where WebGPU is not available */
  gpu: { adapter: string; errors: string[]; pixel: number[]; expected: number[] } | null;
}

declare global {
  interface Window {
    /** A small handle for tests and harnesses; `ready` is set once start-up has finished or failed. */
    __abyssal?: { ready?: boolean; error?: string; report?: BootReport };
  }
}

const SelfTest = struct('SelfTest', { shallow: 'vec3f', gain: 'f32', deep: 'vec3f' });
const SelfTestGroup = group(0, { selfTest: SelfTest });
const SHALLOW = [0.2, 0.6, 0.8];
const DEEP = [0.0, 0.2, 0.4];
const TRANSFER_BYTES = 16 << 20;

/**
 * Test builds only (`--report`): tells a listener on 127.0.0.1 how start-up is going. Safari cannot be driven
 * without a setting the user has to switch on, so the page reports for itself. Loopback only, and only on request.
 */
function tell(key: string, value: unknown): void {
  if (!__REPORT__) return;
  const to = new URLSearchParams(location.search).get('report');
  if (to && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(to)) {
    new Image().src = `${to}?${key}=${encodeURIComponent(JSON.stringify(value))}`;
  }
}

/** The next message of one type from the worker; rejects if the worker reports or throws an error first. */
function reply<T extends FromWorker['type']>(
  worker: Worker,
  type: T,
  timeoutMs = 15_000,
): Promise<Extract<FromWorker, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new Error(`the worker did not answer "${type}" within ${timeoutMs / 1000} s`));
    }, timeoutMs);
    const stop = () => {
      clearTimeout(timer);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };
    const onMessage = ({ data }: MessageEvent<FromWorker>) => {
      if (data.type === 'error') {
        stop();
        reject(new Error(`worker failed in ${data.stage}: ${data.message}`));
      } else if (data.type === type) {
        stop();
        resolve(data as Extract<FromWorker, { type: T }>);
      }
    };
    const onError = (event: ErrorEvent) => {
      stop();
      reject(new Error(`worker error: ${event.message}`));
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
  });
}

async function workerRoundTrip(createWorker: () => Worker): Promise<BootReport['worker']> {
  const worker = createWorker();
  await reply(worker, 'ready');
  const buffer = new ArrayBuffer(TRANSFER_BYTES);
  const words = new Uint32Array(buffer);
  for (let i = 0; i < words.length; i++) words[i] = Math.imul(i, 2654435761);
  const expected = checksum(buffer);
  const start = performance.now();
  worker.postMessage({ type: 'echo', buffer } satisfies ToWorker, [buffer]);
  const detached = buffer.byteLength === 0; // a transferred buffer is empty on the sending side
  const echo = await reply(worker, 'echo');
  const roundTripMs = performance.now() - start;
  worker.terminate();
  const intact =
    echo.buffer.byteLength === TRANSFER_BYTES && echo.checksum === expected && checksum(echo.buffer) === expected;
  return { megabytes: TRANSFER_BYTES >> 20, roundTripMs, detached, intact };
}

async function gpuSelfTest(canvas: HTMLCanvasElement): Promise<BootReport['gpu']> {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const format = navigator.gpu.getPreferredCanvasFormat();
  canvas.width = Math.max(2, canvas.clientWidth);
  canvas.height = Math.max(2, canvas.clientHeight);
  const context = canvas.getContext('webgpu')!;
  context.configure({ device, format, alphaMode: 'opaque' });

  const errors: string[] = [];
  device.pushErrorScope('validation');
  const module = device.createShaderModule({ code: declarations(SelfTestGroup) + selfTestSource });
  for (const m of (await module.getCompilationInfo()).messages) {
    if (m.type === 'error') errors.push(`line ${m.lineNum}: ${m.message}`);
  }
  const layout = SelfTestGroup.layout(device);
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'fullscreenVertex' },
    fragment: { module, entryPoint: 'fragment', targets: [{ format }] },
  });
  const data = new Float32Array(SelfTest.size / 4);
  data.set(SHALLOW, SelfTest.at.shallow);
  data[SelfTest.at.gain] = 1;
  data.set(DEEP, SelfTest.at.deep);
  const buffer = device.createBuffer({ size: SelfTest.size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(buffer, 0, data);
  const bindGroup = SelfTestGroup.bind(device, layout, { selfTest: { buffer } });

  const encoder = device.createCommandEncoder();
  const view = context.getCurrentTexture().createView();
  const pass = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3);
  pass.end();
  device.queue.submit([encoder.finish()]);

  // read the middle pixel back through a 2D canvas, in the same task as the draw (the frame is gone after it)
  const probe = document.createElement('canvas');
  probe.width = canvas.width;
  probe.height = canvas.height;
  const probeContext = probe.getContext('2d')!;
  probeContext.drawImage(canvas, 0, 0);
  const pixel = Array.from(probeContext.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data.subarray(0, 3));

  const validation = await device.popErrorScope();
  if (validation) errors.push(validation.message);
  const info = adapter.info;
  return {
    adapter: [info.vendor, info.architecture, info.description].filter(Boolean).join(' '),
    errors,
    pixel,
    expected: SHALLOW.map((s, i) => Math.round(((s + DEEP[i]!) / 2) * 255)),
  };
}

export async function bootMain(createWorker: () => Worker): Promise<void> {
  const status = document.getElementById('s')!;
  const hook: NonNullable<Window['__abyssal']> = (window.__abyssal = {});
  try {
    tell('stage', 'started');
    const worker = await workerRoundTrip(createWorker);
    tell('stage', 'worker done');
    const gpu = await gpuSelfTest(document.getElementById('c') as HTMLCanvasElement);
    hook.report = { worker, gpu };
    status.textContent = [
      `worker: ${worker.megabytes} MB there and back in ${worker.roundTripMs.toFixed(1)} ms` +
        (worker.detached && worker.intact ? '' : '  (FAILED)'),
      gpu
        ? `gpu: ${gpu.adapter || 'adapter'}; middle pixel ${gpu.pixel.join(',')} (expected ${gpu.expected.join(',')})` +
          (gpu.errors.length ? `\n${gpu.errors.join('\n')}` : '')
        : 'gpu: WebGPU is not available in this browser',
    ].join('\n');
  } catch (error) {
    hook.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
    status.textContent = 'Failed to start: ' + (error instanceof Error ? error.message : String(error));
    console.error(error);
  }
  hook.ready = true;
  tell('result', { error: hook.error, report: hook.report, userAgent: navigator.userAgent });
}
