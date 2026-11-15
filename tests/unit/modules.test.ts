/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

// main.ts picks a role and boots as soon as it loads, so it is the one module left out
const modules = import.meta.glob(['../../src/**/*.ts', '!../../src/main.ts', '!../../src/**/*.d.ts']);

describe('modules', () => {
  it('all load without a DOM, as they must inside the worker', async () => {
    expect(typeof document).toBe('undefined');
    expect(Object.keys(modules).length).toBeGreaterThan(3);
    for (const load of Object.values(modules)) await load();
  });
});
