import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The dashboard page and the service worker are built here. Content scripts
// must be classic (non-module) scripts, so they are bundled separately by
// scripts/build-content.mjs.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome111',
    modulePreload: false,
    rollupOptions: {
      input: {
        dashboard: resolve(import.meta.dirname, 'dashboard.html'),
        sw: resolve(import.meta.dirname, 'src/background/sw.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // The demo-data preview is a development tool, never shipped (rule ext-dev-is-not-shipped).
      exclude: ['src/dev/**'],
      reporter: ['text-summary', 'html'],
      // The level reached when the test standard was adopted (ADR-0017); raise it as coverage grows, never lower it.
      thresholds: { lines: 87, statements: 85, branches: 81, functions: 92 },
    },
  },
});
