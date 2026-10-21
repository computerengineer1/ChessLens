import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'release/**', 'android/**', 'ios/**', 'public/engine/**', 'electron/dist/**', 'dev-dist/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off'
    }
  },
  {
    // Plain-JS node scripts: give them node globals.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        performance: 'readonly',
        fetch: 'readonly',
        crypto: 'readonly',
        navigator: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        Uint8Array: 'readonly',
        Float32Array: 'readonly',
        Float64Array: 'readonly',
        Int32Array: 'readonly',
        Math: 'readonly',
        JSON: 'readonly',
        Date: 'readonly',
        Object: 'readonly',
        Array: 'readonly',
        Promise: 'readonly',
        Error: 'readonly',
        RegExp: 'readonly',
        Map: 'readonly',
        Set: 'readonly',
        isNaN: 'readonly',
        parseInt: 'readonly',
        parseFloat: 'readonly',
        Infinity: 'readonly',
        NaN: 'readonly',
        undefined: 'readonly',
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        globalThis: 'readonly'
      }
    }
  }
);
