// One lint config for the whole monorepo.
// Besides code quality, it enforces the documentation rule: every exported symbol carries a doc
// comment (see docs/ARCHITECTURE.md#documentation-rules). `npm run lint` fails otherwise.
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import { defineConfig, globalIgnores } from 'eslint/config';
import jsdoc from 'eslint-plugin-jsdoc';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Next.js reads these exports by name; their meaning is documented by the framework.
const NEXT_SPECIAL_EXPORTS = 'metadata|viewport|config|dynamic|revalidate|runtime|instant|preferredRegion|maxDuration';

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/.next/',
    '**/next-env.d.ts',
    '**/coverage/',
    '**/playwright-report/',
    '**/test-results/',
    'packages/db/src/database.types.ts',
    'supabase/.temp/',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      eqeqeq: ['error', 'smart'],
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
    },
  },
  {
    files: ['apps/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    settings: { next: { rootDir: 'apps/web/' } },
    rules: { ...nextPlugin.configs.recommended.rules, ...nextPlugin.configs['core-web-vitals'].rules },
  },
  {
    files: ['apps/extension/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.webextensions, ...globals.serviceworker } },
  },
  {
    // Build scripts and tooling run in Node and may log.
    files: ['**/*.{mjs,cjs}', '**/scripts/**', 'tooling/**'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Documentation rules: application source only (tests and generated code are exempt).
    files: ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.ts'],
    ignores: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    plugins: { jsdoc },
    settings: { jsdoc: { mode: 'typescript' } },
    rules: {
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: { esm: true, cjs: false, window: false },
          require: { FunctionDeclaration: true, ClassDeclaration: true, ArrowFunctionExpression: true },
          contexts: [
            'TSInterfaceDeclaration',
            'TSTypeAliasDeclaration',
            'TSEnumDeclaration',
            `ExportNamedDeclaration > VariableDeclaration:not(:has(VariableDeclarator > Identifier.id[name=/^(${NEXT_SPECIAL_EXPORTS})$/]))`,
          ],
          checkConstructors: false,
        },
      ],
      'jsdoc/require-description': ['error', { contexts: ['any'] }],
      'jsdoc/check-tag-names': ['error', { definedTags: ['packageDocumentation', 'remarks'] }],
      'jsdoc/check-param-names': 'error',
      'jsdoc/no-types': 'error',
      'jsdoc/empty-tags': 'error',
      'jsdoc/no-blank-blocks': 'error',
    },
  },
);
