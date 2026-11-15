import { defineConfig } from 'vitest/config';
import { loadWgsl } from './tools/wgsl.mjs';

export default defineConfig({
  define: { __DEV__: 'true', __REPORT__: 'false' },
  // the package's "main" is a CommonJS file inside a "type": "module" package, which Node cannot load
  resolve: { alias: { wgsl_reflect: 'wgsl_reflect/wgsl_reflect.module.js' } },
  // the same include resolver the build uses, so tests see the shader text the app would
  plugins: [
    {
      name: 'wgsl',
      load(id) {
        if (id.endsWith('.wgsl')) return `export default ${JSON.stringify(loadWgsl(id).code)}`;
      },
    },
  ],
  test: { include: ['tests/unit/**/*.test.ts'] },
});
