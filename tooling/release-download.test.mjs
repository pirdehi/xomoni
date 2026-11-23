// Tests for the release smoke test's download (#419): tooling/release-download.mjs run as a maintainer runs it, against
// a fake `gh` that hands over real zips, made with `zip`, and the real `unzip`.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { unsafeZipEntries } from './release-lib.mjs';
import { fakeCommands } from './test-fakes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'tooling/release-download.mjs');
const TAG = 'v0.5.2';
const ZIP = 'xomoni-extension-0.5.2.zip';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

describe('unsafeZipEntries', () => {
  it('passes the entries of a zip the release packages', () => {
    assert.deepEqual(unsafeZipEntries(['manifest.json', 'assets/dashboard-1a2b.js', 'icons/128.png', 'a..b.js']), []);
  });

  it('names each entry that would land outside the folder, or nowhere', () => {
    const bad = ['../evil.js', 'assets/../../evil.js', '/etc/passwd', 'C:/evil.js', 'c:evil.js', 'assets\\evil.js', ''];
    assert.deepEqual(unsafeZipEntries(['manifest.json', ...bad]), bad);
  });
});

describe('release-download.mjs', () => {
  let work;
  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'xomoni-download-test-'));
  });
  afterEach(() => rmSync(work, { recursive: true, force: true }));

  /** A zip of a folder holding `files` (path → text) and, if given, `links` (path → target), made with `zip`. */
  function zipOf(files, { links = {}, name = 'release.zip' } = {}) {
    const dir = mkdtempSync(join(work, 'src-'));
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    for (const [path, target] of Object.entries(links)) symlinkSync(target, join(dir, path));
    const zip = join(work, name);
    execFileSync('zip', ['-q', '-X', '-r', '-y', zip, '.'], { cwd: dir });
    return zip;
  }

  /** The files of a release of `version`, as its build has them. */
  const release = (version = '0.5.2') => ({
    'manifest.json': JSON.stringify({ manifest_version: 3, name: 'Xomoni', version }),
    'dashboard.html': '<!doctype html><title>Xomoni</title>',
    'assets/sw.js': '// the background',
  });

  /** SHA256SUMS listing `zip` as the release's zip, and the store build beside it. */
  const sumsFor = (zip, name = ZIP) =>
    `${sha256(readFileSync(zip))}  ${name}\n${'0'.repeat(64)}  xomoni-extension-store-0.5.2.zip\n`;

  /** Runs the script with a fake `gh` answering `rules`, and returns its result, its output and gh's calls. */
  function download(args, rules, env = {}) {
    const fake = fakeCommands(['gh'], { gh: rules });
    try {
      const result = spawnSync(process.execPath, [SCRIPT, ...args], {
        cwd: work,
        encoding: 'utf8',
        env: { ...process.env, GH_REPO: '', ...fake.env, ...env },
      });
      return { ...result, calls: fake.calls() };
    } finally {
      fake.cleanup();
    }
  }

  /** gh's answer to `release download` for TAG: the zip at `zip`, and `sums` as SHA256SUMS unless null. */
  const answer = (zip, sums = sumsFor(zip)) => [
    {
      args: ['release', 'download', TAG],
      copies: { [ZIP]: zip },
      ...(sums == null ? {} : { files: { SHA256SUMS: sums } }),
    },
  ];

  it('unpacks the release zip into the folder once it matches SHA256SUMS', () => {
    const zip = zipOf(release());
    const out = join(work, 'v0.5.2');
    const result = download([TAG, out], answer(zip));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')).version, '0.5.2');
    assert.equal(readFileSync(join(out, 'assets/sw.js'), 'utf8'), '// the background');
    assert.match(
      result.stdout,
      new RegExp(`Xomoni 0\\.5\\.2 in .*v0\\.5\\.2 \\(${ZIP}, sha256 ${sha256(readFileSync(zip))}\\)`),
    );
    // Only the zip people install and its checksums, from the project's repository, with no token on the line.
    assert.equal(result.calls.length, 1);
    const [call] = result.calls;
    assert.deepEqual(call.args.slice(0, 9), [
      'release',
      'download',
      TAG,
      '--repo',
      'pirdehi/xomoni',
      '--pattern',
      ZIP,
      '--pattern',
      'SHA256SUMS',
    ]);
    assert.equal(call.args[9], '--dir');
    assert.ok(!call.args.some((arg) => /token|ghp_|github_pat_/i.test(arg)));
    // The downloads were in a folder of their own, removed afterwards.
    assert.equal(existsSync(call.args[10]), false);
  });

  it('downloads from GH_REPO when it is set, as a fork would', () => {
    const zip = zipOf(release());
    const result = download([TAG, join(work, 'out')], answer(zip), { GH_REPO: 'someone/xomoni-fork' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.calls[0].args[4], 'someone/xomoni-fork');
  });

  it('unpacks into an empty folder that already exists', () => {
    const zip = zipOf(release());
    const out = join(work, 'empty');
    mkdirSync(out);
    const result = download([TAG, out], answer(zip));
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(out, 'manifest.json')));
  });

  it('refuses a zip changed after SHA256SUMS, and unpacks nothing', () => {
    const zip = zipOf(release());
    const sums = sumsFor(zip);
    writeFileSync(zip, Buffer.concat([readFileSync(zip), Buffer.from('changed')]));
    const out = join(work, 'out');
    const result = download([TAG, out], answer(zip, sums));
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`${ZIP} doesn't match SHA256SUMS`));
    assert.equal(existsSync(out), false);
  });

  it('refuses a zip SHA256SUMS does not list', () => {
    const zip = zipOf(release());
    const result = download([TAG, join(work, 'out')], answer(zip, sumsFor(zip, 'xomoni-extension.zip')));
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`SHA256SUMS doesn't list ${ZIP}`));
  });

  it('refuses a SHA256SUMS it cannot read', () => {
    const zip = zipOf(release());
    const result = download([TAG, join(work, 'out')], answer(zip, `${sha256(readFileSync(zip))} ${ZIP}\n`));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /SHA256SUMS: line 1 is not/);
  });

  it('refuses a release without SHA256SUMS', () => {
    const zip = zipOf(release());
    const result = download([TAG, join(work, 'out')], answer(zip, null));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /v0\.5\.2 has no SHA256SUMS/);
  });

  it('says why when gh cannot download the release', () => {
    const result = download(
      ['v9.9.9', join(work, 'out')],
      [{ args: ['release', 'download', 'v9.9.9'], stderr: 'release not found\n', status: 1 }],
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /gh release download v9\.9\.9 failed: release not found/);
    assert.equal(existsSync(join(work, 'out')), false);
  });

  it('refuses a zip with an entry outside its folder, before unpacking anything', () => {
    const zip = zipOf(release());
    // Added from a folder below, so the zip names it ../evil.js, as zip keeps it.
    mkdirSync(join(work, 'below', 'deeper'), { recursive: true });
    writeFileSync(join(work, 'below', 'evil.js'), 'evil');
    execFileSync('zip', ['-q', zip, '../evil.js'], { cwd: join(work, 'below', 'deeper') });
    const out = join(work, 'deep', 'out');
    const result = download([TAG, out], answer(zip));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /entries outside its folder: \.\.\/evil\.js/);
    assert.equal(existsSync(join(work, 'deep')), false);
  });

  it('refuses a zip that unpacks a link', () => {
    const zip = zipOf(release(), { links: { 'assets/home.js': '/etc/hosts' } });
    const out = join(work, 'out');
    const result = download([TAG, out], answer(zip));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /has links: assets\/home\.js/);
    assert.equal(existsSync(out), false);
  });

  it('refuses a zip whose manifest names another version', () => {
    const zip = zipOf(release('0.5.1'));
    const result = download([TAG, join(work, 'out')], answer(zip));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /manifest says 0\.5\.1, not 0\.5\.2/);
  });

  it('refuses a zip without a manifest at its root', () => {
    const zip = zipOf({ 'xomoni/manifest.json': JSON.stringify({ version: '0.5.2' }) });
    const result = download([TAG, join(work, 'out')], answer(zip));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /has no manifest\.json at its root/);
  });

  it('never writes into a folder that has files, nor downloads anything', () => {
    const out = join(work, 'used');
    mkdirSync(out);
    writeFileSync(join(out, 'manifest.json'), 'mine');
    const result = download([TAG, out], answer(zipOf(release())));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /used is not empty/);
    assert.deepEqual(result.calls, []);
    assert.equal(readFileSync(join(out, 'manifest.json'), 'utf8'), 'mine');
    assert.deepEqual(readdirSync(out), ['manifest.json']);
  });

  it('takes only a vX.Y.Z tag and a folder', () => {
    for (const args of [['latest', join(work, 'out')], ['0.5.2', join(work, 'out')], [TAG], []]) {
      const result = download(args, []);
      assert.equal(result.status, 1, args.join(' '));
      assert.match(result.stderr, /is not v<major>|Name the folder/);
      assert.deepEqual(result.calls, []);
    }
  });
});
