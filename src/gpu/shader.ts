// Shader modules: the WGSL of a file, with the declarations of the bind groups it uses put in front.
import { declarations, type Group } from './bindings';

/** Compile errors seen so far, in dev and harness builds. Tests assert that this stays empty. */
export const shaderErrors: string[] = [];

export function shaderModule(device: GPUDevice, label: string, groups: Group[], source: string): GPUShaderModule {
  const module = device.createShaderModule({ label, code: declarations(...groups) + source });
  if (__DEV__ || __HARNESS__) {
    void module.getCompilationInfo().then((info) => {
      for (const m of info.messages) if (m.type === 'error') shaderErrors.push(`${label}:${m.lineNum}: ${m.message}`);
    });
  }
  return module;
}
