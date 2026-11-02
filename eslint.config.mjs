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
  {
    // Rules are changed here, with a reason, never switched off from inside the code (ADR-0016).
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
  },
  js.configs.recommended,
  // Type-aware rules (#101): they read each file's types through the workspace's tsconfig, so floating
  // promises, unsafe `any`, non-exhaustive switches and needless conditions fail the lint.
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        // vite.config.ts runs in Node, outside the extension's browser tsconfig; it has its own.
        projectService: {
          allowDefaultProject: ['apps/extension/vite.config.ts'],
          defaultProject: 'apps/extension/tsconfig.node.json',
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      // `() => setOpen(false)` is the idiomatic React handler; a void value used anywhere else still fails.
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      // Numbers read naturally in messages; objects, null and undefined in a template still fail.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true, requireDefaultForNonUnion: false },
      ],
      eqeqeq: ['error', 'smart'],
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
    },
  },
  {
    // Plain JavaScript (configs, build scripts, tooling) has no types to check.
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // The page-world interceptor keeps X's own fetch and XMLHttpRequest methods to call them later with the
    // page's `this`: holding unbound methods is the point there (ADR-0016).
    files: ['apps/extension/src/inject/interceptor.ts'],
    rules: { '@typescript-eslint/unbound-method': 'off' },
  },
  {
    // Tests (ADR-0016): a missing value fails the test anyway, so `!` is allowed; Vitest and Playwright
    // callbacks are async by contract; mocks are asserted through their methods; and Vitest types its
    // asymmetric matchers (`expect.any(String)`) as `any`.
    files: ['**/*.test.{ts,tsx}', '**/tests/**/*.{ts,tsx}', '**/e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
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
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      // The CSP allows inline scripts (ADR-0014), so the site must never render raw HTML.
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'The website never renders raw HTML: its CSP allows inline scripts (ADR-0014).',
        },
      ],
    },
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
