// Hooks for tests and for comparing against the original. Compiled into dev and harness builds only; the shipped
// file has none of this.
import { lookAt } from '../camera/camera';
import { createIntent, createSwimmer, stepSwimmer } from '../camera/controls';
import { flyPoint } from '../camera/path';
import type { Level } from '../config/quality';
import { shaderErrors } from '../gpu/shader';
import { skippedDraws } from '../render/passes/scene';
import { MAX_PIXELS } from '../render/dynres';
import type { Renderer } from '../render/renderer';
import type { CellTable, MeshRange, WorldData } from '../world/data';
import { generateWorld } from '../world/client';
import { rockDistance, type CollisionField } from '../world/collision';
import { createBodyState, poseBody, poseHands, type BodyState } from '../body/rig';
import { createArmTarget, type ArmTarget } from '../body/skeleton';
import { aimLamp } from '../render/lamp';

export interface FrameDiff {
  pixels: number;
  /** pixels where any channel differs at all */
  differing: number;
  /** pixels where any channel differs by more than one 8-bit step */
  over1: number;
  /** largest difference in any channel, in 8-bit steps */
  max: number;
  /** on request: a PNG data URL, the first image dimmed with every differing pixel marked (red: by more than 1) */
  heatmap?: string;
}

export interface TextureDiff {
  values: number;
  /** values whose bits differ */
  differing: number;
  /** largest absolute difference between two values */
  max: number;
}

export interface Harness {
  /**
   * Plays a scripted swim from a pose: one frame per step, with its length in milliseconds, the keys held
   * (f, b, l, r, u, d, s as 0 or 1) and the mouse movement. Resolves with x, y, z, yaw, pitch after every step.
   */
  trace(pose: number[], steps: SwimStep[]): number[];
  /** Where the camera is, where it looks, and how far it is from the rock (negative: in open water). */
  camera(): { x: number; y: number; z: number; yaw: number; pitch: number; rockDistance: number };
  /** Distance to the rock at a point, metres: positive inside it (NaN before the collision field has arrived). */
  rockAt(x: number, y: number, z: number): number;
  /**
   * Frame cost, measured the way the reference rig measures the original: frames are submitted `batch` at a time
   * (default one) and waited for until the GPU has finished them. `poses` gives the camera for each frame (one
   * pose: it is held, and time advances by 1/60 s a frame; several: one frame each, at `seconds` of scene time).
   * `pixels` is the render size's pixel budget. Resolves with the JavaScript part and the whole of every frame,
   * in milliseconds (a batch's time is shared equally among its frames).
   */
  frameCost(
    poses: number[][],
    frames: number,
    pixels: number,
    seconds?: number[],
    batch?: number,
  ): Promise<{ cpuMs: number[]; totalMs: number[]; size: number[] }>;
  /**
   * Puts the swimmer's body in view for the frames that follow, in the given state (see BodyState; what is left
   * out is at rest, fully shown). With null, the body is taken out again, which is how every test starts.
   */
  poseBody(state: Partial<BodyState> | null): void;
  /**
   * Holds the hands where they are told for the frames that follow (see ArmTarget; what is left out is a flat
   * open hand): for looking at them closely.
   */
  poseHands(right: Partial<ArmTarget>, left: Partial<ArmTarget>): void;
  /** The meshes of the body parts that the next frame will draw (PART in src/body/meshes.ts); empty when none. */
  bodyParts(): number[];
  /** Draws a frame from where the camera is and sums it up: the mean colour (0..255) and the share of dark pixels. */
  frameStats(time: number): { mean: number[]; dark: number };
  /** The six viewpoints of the world being drawn: eye xyz, target xyz. */
  viewpoints(): number[][];
  /** The jellyfish in the water, eight floats each: home x, y, z, radius, then seed, drift, colour, beat. */
  jellies(): number[];
  /** Switches the lamp on (1) or off (0) for the frames captured from now on. */
  lamp(level: number): void;
  /** The turtles, eight floats each: the middle of the loop and its radius, then phase, speed, size, phase. */
  turtles(): number[];
  /** The first few hundred fish as generated, eight floats each (orbit, then motion): for finding a school. */
  fish(): number[];
  /** Leaves out draws by name (see skippedDraws in render/passes/scene.ts) until called again; no names draws all. */
  skipDraws(...names: string[]): void;
  /** The pose [eye xyz, target xyz] of the scripted fly-through at `seconds`. */
  flyPose(seconds: number): number[];
  /** Shader compile errors and uncaptured GPU validation errors so far. */
  gpuErrors(): string[];
  /** Draws one frame from a pose [eye xyz, target xyz] and returns it with the uniform block that produced it. */
  capture(pose: number[], time: number): { png: string; uniforms: number[]; width: number; height: number };
  /**
   * Replaces the scene with a dumped frame of the original (`hdr_<id>_scene.bin` under `baseUrl`) and holds it:
   * the scene pass is skipped until releaseScene(). The light shafts are zeroed.
   */
  holdReferenceScene(baseUrl: string, id: string): Promise<void>;
  releaseScene(): void;
  /** Draws a frame and compares it with a PNG, pixel by pixel. `heatmap` adds a picture of where they differ. */
  compareFrame(pose: number[], time: number, pngUrl: string, heatmap?: boolean): Promise<FrameDiff>;
  /** Compares two PNGs of the canvas's size: used to measure how much the original varies from run to run. */
  compareImages(urlA: string, urlB: string, heatmap?: boolean): Promise<FrameDiff>;
  /** Compares a texture with a raw dump of the original's (call after a frame has been drawn). */
  compareTexture(name: TextureName, dumpUrl: string): Promise<TextureDiff>;
  /**
   * Runs Hollowtide's own world generator and resolves with the SHA-256 of everything it made, under the names
   * the reference rig gives the same data.
   */
  generate(level: Level, seed?: number): Promise<Record<string, Made>>;
  /** Runs Hollowtide's own generator and draws its world from then on. Resolves with the six viewpoints. */
  useGeneratedWorld(level: Level): Promise<number[][]>;
  /** SHA-256 of a texture's contents, to tell whether two renders produced the same values. */
  textureHash(name: TextureName | 'shafts' | 'shaftsBlurred'): Promise<string>;
  /**
   * Builds the world from a dump of the original (index.json and the .bin files under `baseUrl`) and uploads it.
   * Resolves with its six viewpoints.
   */
  loadReferenceWorld(baseUrl: string): Promise<number[][]>;
}

/** One frame of a scripted swim. */
export interface SwimStep {
  ms: number;
  f: number;
  b: number;
  l: number;
  r: number;
  u: number;
  d: number;
  s: number;
  dx: number;
  dy: number;
}

/** Something the generator made: how many values, and their SHA-256. */
export interface Made {
  length: number;
  sha256: string;
}

export type TextureName = 'scene' | 'bloom0' | 'water' | 'detail' | 'shadow';

/** The part of a fixture dump's index.json that describes the world. */
interface DumpIndex {
  meta: { poses: number[][]; meshes: MeshRange[]; solidRanges: [number, number][] };
}

const bytesFrom = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

/** IEEE half float to number. */
function half(h: number): number {
  const exponent = (h >> 10) & 31;
  const mantissa = h & 1023;
  const sign = h & 0x8000 ? -1 : 1;
  if (exponent === 0) return sign * 2 ** -14 * (mantissa / 1024);
  if (exponent === 31) return mantissa ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + mantissa / 1024);
}

/** Compares two RGBA images of the same size, channel by channel (alpha ignored). */
function diffImages(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  width: number,
  height: number,
  heatmap: boolean,
): FrameDiff {
  if (a.length !== b.length || a.length !== width * height * 4) throw new Error('images differ in size');
  const diff: FrameDiff = { pixels: a.length / 4, differing: 0, over1: 0, max: 0 };
  const marked = heatmap ? new ImageData(width, height) : null;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i]! - b[i]!), Math.abs(a[i + 1]! - b[i + 1]!), Math.abs(a[i + 2]! - b[i + 2]!));
    if (d > 0) diff.differing++;
    if (d > 1) diff.over1++;
    if (d > diff.max) diff.max = d;
    if (marked) {
      const out = marked.data;
      // the picture at a third of its brightness; a differing pixel in yellow, or red if off by more than 1
      out[i] = d > 0 ? 255 : a[i]! / 3;
      out[i + 1] = d > 1 ? 0 : d > 0 ? 255 : a[i + 1]! / 3;
      out[i + 2] = d > 0 ? 0 : a[i + 2]! / 3;
      out[i + 3] = 255;
    }
  }
  if (marked) {
    const picture = document.createElement('canvas');
    picture.width = width;
    picture.height = height;
    picture.getContext('2d')!.putImageData(marked, 0, 0);
    diff.heatmap = picture.toDataURL('image/png');
  }
  return diff;
}

/** A PNG's pixels as RGBA bytes. */
async function decodePng(url: string): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(new Blob([await bytesFrom(url)], { type: 'image/png' }));
  const copy = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d', { willReadFrequently: true })!;
  copy.drawImage(bitmap, 0, 0);
  return copy.getImageData(0, 0, bitmap.width, bitmap.height).data;
}

export function createHarness(
  renderer: Renderer,
  createWorker: () => Worker,
): Harness & { collision: CollisionField | null; generatedViewpoints: number[][]; fishSample: Float32Array } {
  let collision: CollisionField | null = null;
  let fish: Float32Array = new Float32Array(0);
  let viewpoints: number[][] = [];
  const { device, queue, canvas } = renderer.gpu;
  const errors: string[] = [];
  device.addEventListener('uncapturederror', (event) => errors.push(event.error.message));

  /** Frames for comparison are drawn the way the reference rig draws its own: full size, full draw distance. */
  const fullSize = () => {
    renderer.pixelBudget = MAX_PIXELS;
    renderer.detail = 1;
    renderer.resize();
  };

  /** how far the lamp is switched on for the frames drawn here (0: off, as everywhere but in its own test) */
  let lampLevel = 0;
  const setPose = (pose: number[]) => {
    fullSize();
    const [x, y, z, tx, ty, tz] = pose as [number, number, number, number, number, number];
    lookAt(renderer.camera, x, y, z, tx, ty, tz);
    aimLamp(renderer.scene.lampData, renderer.camera, lampLevel, 0);
  };

  /** The canvas as RGBA bytes. Must run in the task that drew the frame: the canvas texture is gone after it. */
  const readCanvas = () => {
    const copy = new OffscreenCanvas(canvas.width, canvas.height).getContext('2d', { willReadFrequently: true })!;
    copy.drawImage(canvas, 0, 0);
    return copy.getImageData(0, 0, canvas.width, canvas.height).data;
  };

  const readTexture = async (texture: GPUTexture, bytesPerPixel: number) => {
    const { width, height } = texture;
    const stride = Math.ceil((width * bytesPerPixel) / 256) * 256;
    const buffer = device.createBuffer({
      size: stride * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: stride, rowsPerImage: height }, [width, height]);
    queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const padded = new Uint8Array(buffer.getMappedRange());
    const out = new Uint8Array(width * bytesPerPixel * height);
    for (let row = 0; row < height; row++) {
      out.set(padded.subarray(row * stride, row * stride + width * bytesPerPixel), row * width * bytesPerPixel);
    }
    buffer.unmap();
    buffer.destroy();
    return out;
  };

  return {
    /** set by the boot sequence once the generated world exists */
    set collision(field: CollisionField | null) {
      collision = field;
    },
    set generatedViewpoints(points: number[][]) {
      viewpoints = points;
    },
    set fishSample(sample: Float32Array) {
      fish = sample;
    },
    fish: () => Array.from(fish),
    get collision() {
      return collision;
    },

    trace(pose, steps) {
      setPose(pose);
      const camera = renderer.camera;
      const swimmer = createSwimmer();
      const intent = createIntent();
      const path: number[] = [];
      // the loop gets frame times as differences of timestamps, so the script's are replayed the same way
      let now = 0;
      let last = 0;
      for (const step of steps) {
        now += step.ms;
        const frameMs = now - last;
        last = now;
        intent.forward = step.f - step.b;
        intent.right = step.r - step.l;
        intent.up = step.u - step.d;
        intent.fast = !!step.s;
        intent.lookX += step.dx;
        intent.lookY += step.dy;
        stepSwimmer(camera, swimmer, intent, collision, Math.min(frameMs / 1000, 0.1));
        path.push(camera.x, camera.y, camera.z, camera.yaw, camera.pitch);
      }
      return path;
    },

    rockAt: (x, y, z) => (collision ? rockDistance(collision, x, y, z) : NaN),

    camera() {
      const { x, y, z, yaw, pitch } = renderer.camera;
      return { x, y, z, yaw, pitch, rockDistance: collision ? rockDistance(collision, x, y, z) : NaN };
    },

    async frameCost(poses, frames, pixels, seconds, batch = 1) {
      renderer.pixelBudget = pixels;
      renderer.detail = 1;
      renderer.resize();
      const cpuMs: number[] = [];
      const totalMs: number[] = [];
      let time = 2;
      for (let i = 0; i < frames;) {
        const start = performance.now();
        const first = i;
        for (const end = Math.min(frames, i + batch); i < end; i++) {
          const pose = poses[Math.min(i, poses.length - 1)] as [number, number, number, number, number, number];
          lookAt(renderer.camera, ...pose);
          time = seconds ? seconds[i]! : time + 1 / 60;
          renderer.render(time);
        }
        const encoded = performance.now();
        await queue.onSubmittedWorkDone();
        const done = performance.now();
        for (let k = first; k < i; k++) {
          cpuMs.push((encoded - start) / (i - first));
          totalMs.push((done - start) / (i - first));
        }
      }
      return { cpuMs, totalMs, size: [renderer.targets.width, renderer.targets.height] };
    },

    poseBody(state) {
      renderer.body.count = 0;
      if (state) poseBody({ ...createBodyState(), shown: 1, ...state }, renderer.body);
    },

    poseHands(right, left) {
      poseHands(renderer.body, { ...createArmTarget(), ...right }, { ...createArmTarget(), ...left });
    },

    bodyParts: () => [...renderer.body.mesh.slice(0, renderer.body.count)],

    frameStats(time) {
      renderer.render(time);
      const pixels = readCanvas();
      const sum = [0, 0, 0];
      let dark = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        sum[0]! += pixels[i]!;
        sum[1]! += pixels[i + 1]!;
        sum[2]! += pixels[i + 2]!;
        if (pixels[i]! + pixels[i + 1]! + pixels[i + 2]! < 24) dark++;
      }
      const count = pixels.length / 4;
      return { mean: sum.map((v) => Math.round(v / count)), dark: dark / count };
    },

    viewpoints: () => viewpoints,

    jellies: () => Array.from(renderer.jellies ?? []),
    turtles: () => Array.from(renderer.turtles ?? []),
    lamp(level) {
      lampLevel = level;
    },

    skipDraws(...names) {
      skippedDraws.clear();
      for (const name of names) skippedDraws.add(name);
    },

    flyPose(seconds) {
      const pose = new Float64Array(6);
      flyPoint(seconds, pose);
      return Array.from(pose);
    },

    gpuErrors: () => [...shaderErrors, ...errors],

    capture(pose, time) {
      setPose(pose);
      renderer.render(time);
      const { width, height } = renderer.targets;
      return { png: canvas.toDataURL('image/png'), uniforms: Array.from(renderer.scene.frameData), width, height };
    },

    async holdReferenceScene(baseUrl, id) {
      const { scene, shaftsBlurred } = renderer.targets;
      const bytes = await bytesFrom(`${baseUrl}hdr_${id}_scene.bin`);
      if (bytes.length !== scene.width * scene.height * 8) {
        throw new Error(`${id}: the dump is not ${scene.width}x${scene.height}`);
      }
      queue.writeTexture({ texture: scene }, bytes, { bytesPerRow: scene.width * 8 }, [scene.width, scene.height]);
      const { width, height } = shaftsBlurred;
      queue.writeTexture({ texture: shaftsBlurred }, new Uint8Array(width * height * 8), { bytesPerRow: width * 8 }, [
        width,
        height,
      ]);
      renderer.holdScene = true;
    },

    releaseScene() {
      renderer.holdScene = false;
    },

    async compareFrame(pose, time, pngUrl, heatmap = false) {
      setPose(pose);
      renderer.render(time);
      const mine = readCanvas();
      return diffImages(mine, await decodePng(pngUrl), canvas.width, canvas.height, heatmap);
    },

    async compareImages(urlA, urlB, heatmap = false) {
      const a = await decodePng(urlA);
      const b = await decodePng(urlB);
      return diffImages(a, b, canvas.width, canvas.height, heatmap);
    },

    async compareTexture(name, dumpUrl) {
      const { scene, targets } = renderer;
      const texture = {
        scene: targets.scene,
        bloom0: targets.bloom[0]!,
        water: scene.water,
        detail: scene.detail,
        shadow: scene.shadowMap,
      }[name];
      // the values as stored, and how to turn one into a number
      const [View, bytesPerPixel, toNumber] =
        texture.format === 'rgba16float'
          ? ([Uint16Array, 8, half] as const)
          : texture.format === 'depth32float'
            ? ([Float32Array, 4, (x: number) => x] as const)
            : ([Uint8Array, 4, (x: number) => x] as const);
      const mine = new View((await readTexture(texture, bytesPerPixel)).buffer);
      const theirs = new View((await bytesFrom(dumpUrl)).buffer);
      if (mine.length !== theirs.length) {
        throw new Error(`${dumpUrl}: ${theirs.length} values, expected ${mine.length}`);
      }
      const diff: TextureDiff = { values: mine.length, differing: 0, max: 0 };
      for (let i = 0; i < mine.length; i++) {
        if (mine[i] === theirs[i]) continue;
        diff.differing++;
        const d = Math.abs(toNumber(mine[i]!) - toNumber(theirs[i]!));
        if (d > diff.max) diff.max = d;
      }
      return diff;
    },

    async generate(level, seed = 0) {
      const checksums: Record<string, Made> = {};
      const made = await generateWorld(device, createWorker, level, { checksums, seed });
      await Promise.all([made.collision, made.body]); // the collision field's checksums come last
      return checksums;
    },

    async useGeneratedWorld(level) {
      const { world, collision, body } = await generateWorld(device, createWorker, level);
      await Promise.all([collision, body]); // not used here, but the generator should be finished before the next one starts
      await renderer.setWorld(world);
      viewpoints = world.viewpoints;
      return world.viewpoints;
    },

    async textureHash(name) {
      const { scene, targets } = renderer;
      const texture = {
        scene: targets.scene,
        bloom0: targets.bloom[0]!,
        shafts: targets.shafts,
        shaftsBlurred: targets.shaftsBlurred,
        water: scene.water,
        detail: scene.detail,
        shadow: scene.shadowMap,
      }[name];
      const bytes = await readTexture(texture, texture.format === 'rgba16float' ? 8 : 4);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 16);
    },

    async loadReferenceWorld(baseUrl) {
      const index = (await (await fetch(baseUrl + 'index.json')).json()) as DumpIndex;
      const bytes = (name: string) => bytesFrom(`${baseUrl}${name}.bin`);
      const floats = async (name: string) => new Float32Array((await bytes(name)).buffer);
      const words = async (name: string) => new Uint32Array((await bytes(name)).buffer);
      const cells = async (name: string): Promise<CellTable> => ({
        start: await words(name + 'Start'),
        lo: await floats(name + 'Lo'),
        hi: await floats(name + 'Hi'),
      });
      const sorted = async (name: string) => ({ instances: await floats(name), cells: await cells(name) });
      const leaves = async (name: string) => ({ instances: await bytes(name), cells: await cells(name) });
      const data: WorldData = {
        terrain: {
          vertices: await bytes('terrainVertices'),
          indices: await words('terrainIndices'),
          cells: await cells('terrain'),
        },
        meshes: {
          vertices: await bytes('meshVertices'),
          indices: await words('meshIndices'),
          ranges: index.meta.meshes,
        },
        solids: { instances: await floats('solids'), ranges: index.meta.solidRanges },
        chunks: await Promise.all([0, 1, 2, 3, 4, 5, 6].map((i) => sorted('chunks' + i))),
        props: await Promise.all([0, 1, 2, 3, 4, 5].map((i) => sorted('props' + i))),
        leaves: {
          big: await leaves('leavesBig'),
          bigFar: await leaves('leavesBigF'),
          small: await leaves('leavesSmall'),
        },
        glints: await floats('glints'),
        bubbles: await floats('bubbles'),
        fish: await floats('fish'),
        mantas: await floats('mantas'),
        kelp: new Float32Array(0),
        snow: await floats('snow'),
        volume: await bytes('volume'),
        groundMap: await bytes('groundMap'),
        viewpoints: index.meta.poses,
      };
      await renderer.setWorld(data);
      viewpoints = data.viewpoints;
      return data.viewpoints;
    },
  };
}
