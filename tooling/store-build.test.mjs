// The store build carries no updater (#305, ADR-0033): a store updates Xomoni by itself, and a store may refuse code
// that downloads extension code and writes it. This builds the extension as `npm run build:store` does (the dashboard
// and the service worker; the content scripts don't touch the updater) and checks what would be uploaded.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'apps/extension');
// Vite's command line, from its package.json (the package exports no path to it).
const VITE_PACKAGE = createRequire(join(EXT, 'package.json')).resolve('vite/package.json');
const VITE = join(dirname(VITE_PACKAGE), JSON.parse(readFileSync(VITE_PACKAGE, 'utf8')).bin.vite);

/**
 * Strings only the updater's code holds, each checked to be in `src/update/` first, so their absence from the store
 * bundle means something. (`readwrite` is not one: IndexedDB uses it too.)
 */
const UPDATER = [
  ['release-assets.githubusercontent.com', 'download.ts'],
  ['github.com/pirdehi/xomoni/releases/download/', 'download.ts'],
  ['chrome.runtime.reload', 'update.ts'],
  ['chrome.permissions', 'update.ts'],
  ['xomoni-update', 'update.ts'],
  ['createWritable', 'write.ts'],
];

/** Every file under `dir`, as paths relative to it. */
function filesUnder(dir, prefix = '') {
  return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? filesUnder(dir, path) : [path];
  });
}

describe('the store build (#305)', () => {
  let out = '';
  before(() => {
    out = mkdtempSync(join(tmpdir(), 'xomoni-store-'));
    const build = spawnSync(
      process.execPath,
      [VITE, 'build', '--mode', 'store', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'],
      { cwd: EXT, encoding: 'utf8' },
    );
    assert.equal(build.status, 0, `${build.stdout}${build.stderr}`);
  });
  after(() => rmSync(out, { recursive: true, force: true }));

  it('has a manifest without GitHub’s access or CSP sources, and otherwise the same', () => {
    const source = JSON.parse(readFileSync(join(EXT, 'public/manifest.json'), 'utf8'));
    const built = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    assert.equal(built.optional_host_permissions, undefined);
    // `homepage_url` still names the repository; nothing names where releases are downloaded from.
    assert.doesNotMatch(JSON.stringify(built), /githubusercontent|releases\/download/);
    const connect = (manifest) =>
      manifest.content_security_policy.extension_pages
        .split(';')
        .map((d) => d.trim().split(/\s+/))
        .find(([name]) => name === 'connect-src');
    assert.deepEqual(
      connect(built),
      connect(source).filter((s) => !/githubusercontent|releases\/download/.test(s)),
    );
    const { optional_host_permissions: _hosts, content_security_policy: _csp, ...rest } = source;
    const { content_security_policy: _builtCsp, ...builtRest } = built;
    assert.deepEqual(builtRest, rest);
  });

  it('holds none of the updater’s code', () => {
    const scripts = filesUnder(out).filter((file) => file.endsWith('.js') || file.endsWith('.html'));
    assert.ok(
      scripts.some((file) => file.startsWith('assets/dashboard')),
      'the dashboard is in it',
    );
    for (const [marker, file] of UPDATER) {
      assert.ok(readFileSync(join(EXT, 'src/update', file), 'utf8').includes(marker), `${marker} is in ${file}`);
      const found = scripts.filter((script) => readFileSync(join(out, script), 'utf8').includes(marker));
      assert.deepEqual(found, [], marker);
    }
  });
});
