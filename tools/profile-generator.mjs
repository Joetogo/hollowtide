// Where the world generator's time goes: runs its stages in Node on the original's dumped density field
// (npm run ref:dump) and prints how long each takes; with --cpu, also the functions that take the most time.
//   node tools/profile-generator.mjs [level, default 0] [--cpu]
// The lines are those of the bundle esbuild makes of the generator, which keeps the source's names and layout.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const upstream = JSON.parse(readFileSync(path.join(root, 'tools/reference/upstream.json'), 'utf8'));
const level = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '0';
const field = path.join(root, '.cache/reference', upstream.sha.slice(0, 7), 'L' + level, 'fixtures/densityRaw.bin');
if (!existsSync(field)) {
  console.error(`${path.relative(root, field)} is missing: run \`npm run ref:dump -- --level ${level}\``);
  process.exit(2);
}
const dir = mkdtempSync(path.join(os.tmpdir(), 'abyssal-profile-'));
try {
  const script = path.join(dir, 'generator.mjs');
  await build({
    entryPoints: [path.join(root, 'tools/profile/generator-entry.ts')],
    outfile: script,
    bundle: true,
    platform: 'node',
    format: 'esm',
    define: { __DEV__: 'false', __HARNESS__: 'false' },
    logLevel: 'warning',
  });
  const cpu = process.argv.includes('--cpu');
  const flags = cpu ? ['--cpu-prof', '--cpu-prof-dir', dir, '--cpu-prof-interval', '200'] : [];
  process.stdout.write(execFileSync(process.execPath, [...flags, script, field, level], { encoding: 'utf8' }));
  if (cpu) {
    const profile = JSON.parse(
      readFileSync(
        path.join(
          dir,
          readdirSync(dir).find((f) => f.endsWith('.cpuprofile')),
        ),
        'utf8',
      ),
    );
    // self time per function: each sample belongs to the node on top of the stack
    const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
    const self = new Map();
    profile.samples.forEach((id, i) => {
      const { functionName, lineNumber } = nodes.get(id).callFrame;
      const key = `${functionName || '(anonymous)'}:${lineNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
    });
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    console.log(`\nself time by function (name:line in the bundle), of ${total.toFixed(0)} ms sampled`);
    for (const [key, ms] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 28))
      console.log(`  ${ms.toFixed(0).padStart(6)} ms  ${((ms / total) * 100).toFixed(1).padStart(5)} %  ${key}`);
    // and by line: the profiler counts its samples per line of the bundle, shown here with the line's text
    const perTick = total / profile.samples.length;
    const lines = new Map();
    for (const node of profile.nodes)
      for (const { line, ticks } of node.positionTicks ?? []) lines.set(line, (lines.get(line) ?? 0) + ticks * perTick);
    const text = readFileSync(script, 'utf8').split('\n');
    console.log('\nby line of the bundle');
    for (const [line, ms] of [...lines].sort((a, b) => b[1] - a[1]).slice(0, 40))
      console.log(`  ${ms.toFixed(0).padStart(6)} ms  ${(text[line - 1] ?? '').trim().slice(0, 120)}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
