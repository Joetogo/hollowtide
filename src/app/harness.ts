// Hooks for tests and for comparing against the original. Compiled into dev and harness builds only; the shipped
// file has none of this.
import { lookAt } from '../camera/camera';
import { shaderErrors } from '../gpu/shader';
import type { Renderer } from '../render/renderer';
import type { CellTable, MeshRange, WorldData } from '../world/data';

export interface FrameDiff {
  pixels: number;
  /** pixels where any channel differs at all */
  differing: number;
  /** pixels where any channel differs by more than one 8-bit step */
  over1: number;
  /** largest difference in any channel, in 8-bit steps */
  max: number;
}

export interface TextureDiff {
  values: number;
  /** values whose bits differ */
  differing: number;
  /** largest absolute difference between two values */
  max: number;
}

export interface Harness {
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
  /** Draws a frame and compares it with a PNG, pixel by pixel. */
  compareFrame(pose: number[], time: number, pngUrl: string): Promise<FrameDiff>;
  /** Compares a texture with a raw dump of the original's (call after a frame has been drawn). */
  compareTexture(name: TextureName, dumpUrl: string): Promise<TextureDiff>;
  /**
   * Builds the world from a dump of the original (index.json and the .bin files under `baseUrl`) and uploads it.
   * Resolves with its six viewpoints.
   */
  loadReferenceWorld(baseUrl: string): Promise<number[][]>;
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

export function createHarness(renderer: Renderer): Harness {
  const { device, queue, canvas } = renderer.gpu;
  const errors: string[] = [];
  device.addEventListener('uncapturederror', (event) => errors.push(event.error.message));

  const setPose = (pose: number[]) => {
    const [x, y, z, tx, ty, tz] = pose as [number, number, number, number, number, number];
    lookAt(renderer.camera, x, y, z, tx, ty, tz);
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

    async compareFrame(pose, time, pngUrl) {
      setPose(pose);
      renderer.render(time);
      const mine = readCanvas();
      const bitmap = await createImageBitmap(new Blob([await bytesFrom(pngUrl)], { type: 'image/png' }));
      if (bitmap.width !== canvas.width || bitmap.height !== canvas.height) {
        throw new Error(
          `${pngUrl} is ${bitmap.width}x${bitmap.height}, the canvas is ${canvas.width}x${canvas.height}`,
        );
      }
      const copy = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d', { willReadFrequently: true })!;
      copy.drawImage(bitmap, 0, 0);
      const theirs = copy.getImageData(0, 0, bitmap.width, bitmap.height).data;
      const diff: FrameDiff = { pixels: mine.length / 4, differing: 0, over1: 0, max: 0 };
      for (let i = 0; i < mine.length; i += 4) {
        const d = Math.max(
          Math.abs(mine[i]! - theirs[i]!),
          Math.abs(mine[i + 1]! - theirs[i + 1]!),
          Math.abs(mine[i + 2]! - theirs[i + 2]!),
        );
        if (d > 0) diff.differing++;
        if (d > 1) diff.over1++;
        if (d > diff.max) diff.max = d;
      }
      return diff;
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
        snow: await floats('snow'),
        volume: await bytes('volume'),
        groundMap: await bytes('groundMap'),
        viewpoints: index.meta.poses,
      };
      renderer.setWorld(data);
      return data.viewpoints;
    },
  };
}
