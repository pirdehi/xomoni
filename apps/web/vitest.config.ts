import path from 'node:path';
import { defineConfig } from 'vitest/config';

const fake = (name: string) => path.join(__dirname, 'test/fakes', name);

// Unit and component tests. They run without Supabase, Next.js's server or Cloudflare: domain rules, use
// cases and adapter mappers in Node; React components in happy-dom (`// @vitest-environment happy-dom`),
// with Next.js's navigation and the Turnstile widget replaced by the fakes in test/fakes. Pages and route
// handlers in src/app are covered end to end by Playwright (e2e/).
export default defineConfig({
  resolve: {
    alias: {
      '@test': path.join(__dirname, 'test'),
      '@': path.join(__dirname, 'src'),
      'server-only': fake('server-only.ts'),
      'next/navigation': fake('navigation.ts'),
      '@marsidev/react-turnstile': fake('turnstile.tsx'),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['test/setup.ts'],
    testTimeout: 15_000,
    // The public settings the site reads at import time; tests never reach these addresses.
    env: {
      NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/app/**', 'src/**/*.test.{ts,tsx}'],
      reporter: ['text-summary', 'html'],
      // The level reached when the test standard was adopted (ADR-0017); raise it as coverage grows, never lower it.
      thresholds: { lines: 96, statements: 95, branches: 92, functions: 93 },
    },
  },
});
