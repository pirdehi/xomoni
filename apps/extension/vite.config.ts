import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type Plugin, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/** The component that offers one-click updates of a zip install (#305), and its stand-in in a store build. */
const ONE_CLICK = resolve(import.meta.dirname, 'src/ui/components/OneClickUpdate.tsx');
const ONE_CLICK_STORE = resolve(import.meta.dirname, 'src/ui/components/OneClickUpdate.store.tsx');

/** What only the one-click update reaches (`src/update/download.ts`): GitHub's release downloads, and their host. */
const UPDATE_SOURCES = [
  'https://github.com/pirdehi/xomoni/releases/download/',
  'https://release-assets.githubusercontent.com',
];
const UPDATE_HOSTS = ['https://github.com/*', 'https://release-assets.githubusercontent.com/*'];

/** The manifest of a store build: without the optional access to GitHub and the CSP sources the update needs. */
function storeManifest(manifest: Record<string, unknown>): Record<string, unknown> {
  const store = { ...manifest };
  const hosts = ((store.optional_host_permissions as string[] | undefined) ?? []).filter(
    (host) => !UPDATE_HOSTS.includes(host),
  );
  if (hosts.length) store.optional_host_permissions = hosts;
  else delete store.optional_host_permissions;
  const csp = store.content_security_policy as { extension_pages: string };
  store.content_security_policy = {
    ...csp,
    extension_pages: csp.extension_pages
      .split(';')
      .map((directive) =>
        directive
          .split(' ')
          .filter((source) => !UPDATE_SOURCES.includes(source))
          .join(' '),
      )
      .join(';'),
  };
  return store;
}

/**
 * The store build (`vite build --mode store`, `npm run build:store`, ADR-0033): a store updates Xomoni itself, so the
 * build carries no updater. `OneClickUpdate.tsx` is replaced by a stand-in that shows nothing, so nothing imports
 * `src/update/`, and the manifest loses the GitHub access and CSP sources only the update uses.
 * `tooling/store-build.test.mjs` builds it and checks both.
 */
function storeBuild(): Plugin {
  let outDir = '';
  return {
    name: 'xomoni-store-build',
    enforce: 'pre',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async resolveId(source, importer, options) {
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved?.id === ONE_CLICK ? ONE_CLICK_STORE : null;
    },
    // The public folder, manifest.json with it, is copied before the bundle is written.
    writeBundle() {
      const path = join(outDir, 'manifest.json');
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      writeFileSync(path, `${JSON.stringify(storeManifest(manifest), null, 2)}\n`);
    },
  };
}

// The dashboard page and the service worker are built here. Content scripts
// must be classic (non-module) scripts, so they are bundled separately by
// scripts/build-content.mjs.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'store' ? [storeBuild()] : [])],
  base: './',
  // `XOMONI_PAYWALL=off` builds Xomoni with every paid part open (ADR-0042, decision 7): the one variable besides
  // Vite's own that reaches the code, as `import.meta.env.XOMONI_PAYWALL`.
  envPrefix: ['VITE_', 'XOMONI_PAYWALL'],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome111',
    modulePreload: false,
    rolldownOptions: {
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
    // Half the machine's cores: component tests wait on rendering, and with a worker on every core they ran past
    // their waits whenever other apps were busy too. Fewer workers finished the suite faster and every time.
    maxWorkers: '50%',
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
}));
