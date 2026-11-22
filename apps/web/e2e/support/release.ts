import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import type { BrowserContext } from '@playwright/test';
import { EXTENSION_ROOT } from './build-extension';

// Xomoni's releases as the one-click update (#305, ADR-0033) downloads them, for the extension's browser tests (#345).
// The build people install trusts no signing key yet, so its updater is dormant; these tests also build Xomoni as it
// will be once the maintainer adds the key: the same build, trusting a throwaway key made for the test run instead. A
// release is that build at a newer version, zipped as the release workflow zips it and signed with the throwaway key,
// served at GitHub's release URLs. Nothing is published, and no key is kept.

/** Where this repository's release files are, by tag, as `apps/extension/src/update/download.ts` names it. */
export const RELEASE_DOWNLOADS = 'https://github.com/pirdehi/xomoni/releases/download/';

/** The zip of `version` and its signature, at the URLs the update downloads them from (`releaseUrls`). */
export function releaseUrls(version: string): { zip: string; signature: string } {
  const zip = `${RELEASE_DOWNLOADS}v${version}/xomoni-extension-${version}.zip`;
  return { zip, signature: `${zip}.sig` };
}

/** One file of a release: its path in the zip, and its bytes. */
export interface ReleaseFile {
  path: string;
  data: Buffer;
}

/** A throwaway Ed25519 key: its public half as `release-keys.json` lists keys, and a signer, as the workflow signs. */
export interface ThrowawayKey {
  /** Base64 of the 32 raw bytes. */
  publicKey: string;
  /** The Ed25519 signature of `data`'s bytes (OpenSSL's `pkeyutl -rawin`). */
  sign(data: Buffer): Buffer;
}

/** A new Ed25519 key pair, made for one run and never kept. */
export function throwawayKey(): ThrowawayKey {
  const pair = generateKeyPairSync('ed25519');
  const jwk = pair.publicKey.export({ format: 'jwk' });
  return {
    publicKey: Buffer.from(jwk.x ?? '', 'base64url').toString('base64'),
    sign: (data) => sign(null, data, pair.privateKey),
  };
}

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
 * Vite's build of the dashboard and the service worker as `npm run build` makes it, but for `release-keys.json`, which
 * `signature.ts` imports: the file named by `XOMONI_E2E_RELEASE_KEYS` takes its place. Run with `node -e` in
 * apps/extension, so Vite and the extension's own config load from there.
 */
const BUILD_TRUSTING = `
import { build } from 'vite';
const keys = process.env.XOMONI_E2E_RELEASE_KEYS;
await build({
  configFile: 'vite.config.ts',
  logLevel: 'warn',
  build: { outDir: process.env.XOMONI_E2E_OUT_DIR, emptyOutDir: true },
  plugins: [{
    name: 'xomoni-e2e-trusted-key',
    enforce: 'pre',
    resolveId: (source, importer) =>
      source === './release-keys.json' && importer?.replace(/\\\\/g, '/').endsWith('/src/update/signature.ts') ? keys : null,
  }],
});
`;

/**
 * Builds Xomoni as `npm run build` does into a new temporary folder, trusting `publicKey` to sign its releases, as a
 * build will once the maintainer has added the release key (docs/RELEASING.md). Returns the folder; the caller removes
 * it with `rmSync`.
 */
export function buildTrusting(publicKey: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'xomoni-e2e-trusted-'));
  const keys = path.join(mkdtempSync(path.join(os.tmpdir(), 'xomoni-e2e-keys-')), 'release-keys.json');
  writeFileSync(keys, JSON.stringify({ keys: [publicKey] }));
  try {
    run('node', ['--input-type=module', '-e', BUILD_TRUSTING], {
      XOMONI_E2E_OUT_DIR: dir,
      XOMONI_E2E_RELEASE_KEYS: keys,
    });
    run('node', ['scripts/build-content.mjs', '--outdir', dir]);
  } finally {
    rmSync(path.dirname(keys), { recursive: true, force: true });
  }
  return dir;
}

/** Every file of the build in `dir`, by its path from there with `/`, in a stable order. */
export function buildFiles(dir: string): ReleaseFile[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort()
    .map((file) => ({ path: path.relative(dir, file).split(path.sep).join('/'), data: readFileSync(file) }));
}

/** The manifest of a build's files. */
export function manifestOf(files: readonly ReleaseFile[]): Record<string, unknown> {
  const manifest = files.find((file) => file.path === 'manifest.json');
  if (!manifest) throw new Error('The build has no manifest.json');
  return JSON.parse(manifest.data.toString('utf8')) as Record<string, unknown>;
}

/**
 * The files of the release `version` made from a build's `files`: the same files, with the manifest at that version
 * and `change` applied to it (another `key`, more access…), listed last as the release workflow's zip lists it.
 */
export function releaseOf(
  files: readonly ReleaseFile[],
  version: string,
  change: (manifest: Record<string, unknown>) => Record<string, unknown> = (m) => m,
): ReleaseFile[] {
  const manifest = change({ ...manifestOf(files), version });
  return [
    ...files.filter((file) => file.path !== 'manifest.json'),
    { path: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) },
  ];
}

/** The next patch version after `version` (`0.5.2` → `0.5.3`). */
export function nextVersion(version: string): string {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  return `${String(major)}.${String(minor)}.${String(patch + 1)}`;
}

/** A ZIP of `files`, each deflated, as `zip -r` writes the release's: local headers, data, the central directory. */
export function zipOf(files: readonly ReleaseFile[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { path: name, data } of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const packed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** The hex SHA-256 of `data`, as the update writes it to the activity log and `SHA256SUMS` lists it. */
export const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

/** What GitHub answers for one release file: its bytes, a status, or no answer at all (`offline`). */
export type GitHubAnswer = Buffer | number | 'offline';

/**
 * Serves the release `version` at GitHub's release URLs in `context` from now on: `zip` and `signature` as given, 404
 * for any other file. GitHub sends no CORS headers; the extension reads them with the host access it asks for, which
 * these tests answer at the page (`allowGitHub` in the spec), so the answers carry `access-control-allow-origin`.
 * Returns the URLs asked for, as they come.
 */
export async function serveRelease(
  context: BrowserContext,
  version: string,
  { zip, signature }: { zip: GitHubAnswer; signature: GitHubAnswer },
): Promise<string[]> {
  const urls = releaseUrls(version);
  const asked: string[] = [];
  await context.route(
    (url) => url.host === 'github.com' || url.host === 'release-assets.githubusercontent.com',
    async (route) => {
      const url = route.request().url();
      asked.push(url);
      const answer = url === urls.zip ? zip : url === urls.signature ? signature : 404;
      if (answer === 'offline') return route.abort('internetdisconnected');
      const headers = { 'access-control-allow-origin': '*' };
      if (typeof answer === 'number') return route.fulfill({ status: answer, headers, body: '' });
      return route.fulfill({ status: 200, headers, contentType: 'application/octet-stream', body: answer });
    },
  );
  return asked;
}
