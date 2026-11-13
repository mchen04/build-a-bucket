import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['.claude/skills/**/*.mjs'],
    languageOptions: {
      globals: Object.fromEntries(
        ['process', 'console', 'fetch', 'AbortSignal', 'performance', 'setTimeout', 'window', 'document', 'localStorage', 'requestAnimationFrame', 'PerformanceObserver'].map((name) => [name, 'readonly']),
      ),
    },
    rules: { 'no-empty': ['error', { allowEmptyCatch: true }] },
  },
);
