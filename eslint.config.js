import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import job4me from './packages/tooling/eslint/job4me-plugin.js';

// Packages the browser bundle must never import: they hold secrets or server code (ADR 0002).
const SERVER_ONLY = [
  '@job4me/db',
  '@job4me/db/*',
  '@job4me/security',
  '@job4me/security/*',
  '@job4me/config',
  '@job4me/config/*',
  '@job4me/logger',
  '@job4me/logger/*',
  'pg',
  'pg-boss',
  'web-push',
  'nodemailer',
  '@node-rs/*',
  'node:*',
];

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/only-throw-error': 'error',
    },
  },
  {
    // Plain JavaScript files are not part of a TypeScript project.
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Command-line tools and scripts talk to the terminal.
    files: ['scripts/**', 'apps/api/src/cli/**', '**/*-cli.ts', 'tests/**'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { job4me },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: SERVER_ONLY,
              message: 'Server-only code: the browser bundle must not import it (ADR 0002).',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Raw HTML injection is forbidden (threat model, XSS).',
        },
      ],
    },
  },
  {
    files: ['apps/web/src/**/*.tsx'],
    ignores: ['apps/web/src/**/*.test.tsx', 'apps/web/src/dev/**'],
    rules: { 'job4me/no-jsx-literals': 'error' },
  },
  {
    files: ['apps/web/public/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
);
