import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The environment variable naming the built extension the tests load. Set it to test a copy built elsewhere, such as a
 * release zip unpacked; otherwise this setup builds one and sets it for the test workers.
 */
export const EXTENSION_DIR_ENV = 'XOMONI_E2E_EXTENSION';

/** The extension's folder in the repository, where its build runs. */
export const EXTENSION_ROOT = path.join(__dirname, '..', '..', '..', 'extension');

/** Runs one build step in apps/extension, failing the run with its output when it fails. */
function run(command: string, args: string[]) {
  const { status, stdout, stderr } = spawnSync(command, args, { cwd: EXTENSION_ROOT, encoding: 'utf8' });
  if (status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${String(status)}):\n${stdout}\n${stderr}`);
}

/**
 * Playwright's global setup for the extension's browser tests (`playwright.extension.config.ts`, #342): builds the
 * extension as `npm run build -w @xomoni/extension` does, into a folder of its own, so a run never tests a stale build
 * nor rewrites the `dist` someone has loaded in Chrome. Returns the teardown that removes it.
 */
export default function buildExtension(): (() => void) | undefined {
  const given = process.env[EXTENSION_DIR_ENV];
  if (given) {
    if (!existsSync(path.join(given, 'manifest.json')))
      throw new Error(`${EXTENSION_DIR_ENV}=${given} has no manifest.json`);
    return undefined;
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), 'xomoni-e2e-extension-'));
  run('npx', ['vite', 'build', '--outDir', dir, '--emptyOutDir', '--logLevel', 'warn']);
  run('node', ['scripts/build-content.mjs', '--outdir', dir]);
  process.env[EXTENSION_DIR_ENV] = dir;
  return () => rmSync(dir, { recursive: true, force: true });
}
