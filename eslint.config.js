import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/studio/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['packages/runtime/**/*.ts', '*.config.{js,ts}', 'e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // The engine must stay pure (SPEC 5.8, CLAUDE.md): no Node, no browser, no clock, no randomness.
    files: ['packages/core/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...[
          'window',
          'document',
          'process',
          'setTimeout',
          'setInterval',
          'fetch',
          'performance',
        ].map((name) => ({
          name,
          message: 'packages/core must stay pure (no Node or browser APIs).',
        })),
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message: 'The engine takes time only from the tick counter.',
        },
        { object: 'Math', property: 'random', message: 'The engine must be deterministic.' },
      ],
      'no-restricted-imports': ['error', { patterns: ['node:*', 'fs', 'path', 'os', 'http'] }],
    },
  },
);
