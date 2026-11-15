// Bloom: the scene is reduced through six half-size steps, then each level is added back onto the one above.
// Level 0 ends up as the finished bloom, which the composite pass mixes in.
import type { Targets } from '../targets';
import type { Blit } from './blit';

interface Step {
  pipeline: GPURenderPipeline;
  source: GPUBindGroup;
  pass: GPURenderPassDescriptor;
}

export interface Bloom {
  resize(targets: Targets): void;
  encode(encoder: GPUCommandEncoder): void;
}

export function createBloom(blit: Blit): Bloom {
  let steps: Step[] = [];
  const attachment = (view: GPUTextureView, clear: boolean): GPURenderPassDescriptor => ({
    colorAttachments: [{ view, loadOp: clear ? 'clear' : 'load', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
  });
  return {
    resize(targets) {
      const views = targets.bloom.map((t) => t.createView());
      const scene = targets.scene.createView();
      steps = [];
      // down: scene -> 0 -> 1 -> ... -> 5
      for (let i = 0; i < views.length; i++) {
        steps.push({
          pipeline: i === 0 ? blit.bloomDownFirst : blit.bloomDown,
          source: blit.source(i === 0 ? scene : views[i - 1]!),
          pass: attachment(views[i]!, true),
        });
      }
      // up: 5 -> 4 -> ... -> 0, added onto what is there
      for (let i = views.length - 1; i > 0; i--) {
        steps.push({ pipeline: blit.bloomUp, source: blit.source(views[i]!), pass: attachment(views[i - 1]!, false) });
      }
    },
    encode(encoder) {
      for (const step of steps) {
        const pass = encoder.beginRenderPass(step.pass);
        pass.setPipeline(step.pipeline);
        pass.setBindGroup(0, step.source);
        pass.draw(3);
        pass.end();
      }
    },
  };
}
