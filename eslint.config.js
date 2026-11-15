import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // the capture hooks run inside upstream's function scope and use its names, so they cannot be linted on their own
  { ignores: ['dist', '.cache', 'node_modules', 'test-results', 'tools/reference/capture-*.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['src/**/*.ts'], languageOptions: { globals: globals.browser } },
  // build tools and harnesses run in Node; the harnesses also pass functions into the page
  {
    files: ['tools/**/*.mjs', 'tests/**/*.mjs', '*.config.*'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
