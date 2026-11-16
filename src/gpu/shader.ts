// Shader modules: the WGSL of a file, with the declarations of the bind groups it uses put in front.
import { declarations, type Group } from './bindings';
import { inMood, NOON, type Mood } from '../config/mood';

/** Compile errors seen so far, in dev and harness builds. Tests assert that this stays empty. */
export const shaderErrors: string[] = [];

/** The mood every shader made from now on is in (set once, before any is made: see config/mood.ts). */
let mood: Mood = NOON;
export const setShaderMood = (next: Mood): void => void (mood = next);

export function shaderModule(device: GPUDevice, label: string, groups: Group[], source: string): GPUShaderModule {
  const module = device.createShaderModule({ label, code: declarations(...groups) + inMood(source, mood) });
  if (__DEV__ || __HARNESS__) {
    void module.getCompilationInfo().then((info) => {
      for (const m of info.messages) if (m.type === 'error') shaderErrors.push(`${label}:${m.lineNum}: ${m.message}`);
    });
  }
  return module;
}
