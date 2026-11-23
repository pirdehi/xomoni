import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EXTENSION_ROOT } from './build-extension';

// Xomoni as it will be built once a store lists it (#304), for the extension's browser tests (#345). The store
// listings are empty in the code until the stores approve Xomoni, so the card that brings a zip install to its store
// never shows in the build people have today. These tests also build it as it will be: the same build, with the two
// listings in `src/shared/store-listings.ts` set to a test's addresses. Nothing in the extension's code reads a test's
// value; only this build differs.

/** Xomoni's listings for a test build, each a listing page of its own store, or left out where it isn't listed. */
export interface TestListings {
  chrome?: string;
  edge?: string;
}

/**
 * Vite's build of the dashboard and the service worker as `npm run build` makes it, but with
 * `src/shared/store-listings.ts`'s two constants set to `XOMONI_E2E_STORE_LISTINGS` (JSON). It fails when either
 * constant isn't written as expected, so a change there can't leave the test build quietly unlisted. Run with `node -e`
 * in apps/extension, so Vite and the extension's own config load from there.
 */
const BUILD_LISTED = `
import { build } from 'vite';
const listings = JSON.parse(process.env.XOMONI_E2E_STORE_LISTINGS);
const constants = { CHROME_WEB_STORE_URL: listings.chrome ?? '', EDGE_ADDONS_URL: listings.edge ?? '' };
await build({
  configFile: 'vite.config.ts',
  logLevel: 'warn',
  build: { outDir: process.env.XOMONI_E2E_OUT_DIR, emptyOutDir: true },
  plugins: [{
    name: 'xomoni-e2e-store-listings',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replace(/\\\\/g, '/').endsWith('/src/shared/store-listings.ts')) return null;
      let listed = code;
      for (const [name, value] of Object.entries(constants)) {
        const empty = 'export const ' + name + " = '';";
        if (!listed.includes(empty)) throw new Error('store-listings.ts no longer has ' + empty);
        listed = listed.replace(empty, 'export const ' + name + ' = ' + JSON.stringify(value) + ';');
      }
      return listed;
    },
  }],
});
`;

/** Runs one build step in apps/extension, failing with its output when it fails. */
function run(command: string, args: string[], env: Record<string, string> = {}) {
  const { status, stdout, stderr } = spawnSync(command, args, {
    cwd: EXTENSION_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  if (status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${String(status)}):\n${stdout}\n${stderr}`);
}

/**
 * Builds Xomoni as `npm run build` does into a new temporary folder, listed in the stores `listings` names, as a build
 * will be once the stores approve it (`src/shared/store-listings.ts`, docs/RELEASING.md). Returns the folder; the
 * caller removes it with `rmSync`.
 */
export function buildListedIn(listings: TestListings): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'xomoni-e2e-listed-'));
  run('node', ['--input-type=module', '-e', BUILD_LISTED], {
    XOMONI_E2E_OUT_DIR: dir,
    XOMONI_E2E_STORE_LISTINGS: JSON.stringify(listings),
  });
  run('node', ['scripts/build-content.mjs', '--outdir', dir]);
  return dir;
}
