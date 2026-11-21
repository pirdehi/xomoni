// Tests for tooling/release-lib.mjs, run by `node --test 'tooling/*.test.mjs'` in `npm run verify`.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  changelogSection,
  filesUnder,
  isStoreManifest,
  releaseKeyWarning,
  releaseProblems,
  releaseZips,
  reproducibleZip,
  trustedReleaseKeys,
  versionOfTag,
  zipChecksums,
} from './release-lib.mjs';

const CHANGELOG = `# Changelog

## [Unreleased]

## [0.2.0] - 2026-11-02

### Added
- Pairing with xomoni.com.

## [0.1.0] - 2026-10-30

- First version.
`;

describe('release checks', () => {
  it('reads the version of a v-tag, and nothing else', () => {
    assert.equal(versionOfTag('v0.2.0'), '0.2.0');
    assert.equal(versionOfTag('0.2.0'), null);
    assert.equal(versionOfTag('v0.2'), null);
    assert.equal(versionOfTag(undefined), null);
  });

  it('finds a changelog section up to the next one', () => {
    assert.equal(changelogSection(CHANGELOG, '0.2.0'), '### Added\n- Pairing with xomoni.com.');
    assert.equal(changelogSection(CHANGELOG, '0.1.0'), '- First version.');
    assert.equal(changelogSection(CHANGELOG, '9.9.9'), null);
  });

  it('passes when versions agree, the tag names them and the changelog has them', () => {
    const base = { manifestVersion: '0.2.0', packageVersion: '0.2.0', changelog: CHANGELOG };
    assert.deepEqual(releaseProblems(base), []);
    assert.deepEqual(releaseProblems({ ...base, tag: 'v0.2.0' }), []);
  });

  it('names every problem', () => {
    const problems = releaseProblems({
      manifestVersion: '0.3.0',
      packageVersion: '0.2.0',
      changelog: CHANGELOG,
      tag: 'v0.3.0',
    });
    assert.equal(problems.length, 2);
    assert.match(problems[0], /manifest\.json says 0\.3\.0/);
    assert.match(problems[1], /no section for 0\.3\.0/);
    assert.match(
      releaseProblems({ manifestVersion: '1.0.0', packageVersion: '1.0.0', changelog: '', tag: 'latest' })[0],
      /not v<major>/,
    );
  });
});

describe('release signing keys (#305)', () => {
  const KEY = 'PUAXw+hDiVqStwqnTRt+vJyYLM8uxJaMwM1V8Sr0Zgw=';

  it('reads the keys the extension trusts, and refuses anything that isn’t one', () => {
    assert.deepEqual(trustedReleaseKeys('{"keys": []}'), []);
    assert.deepEqual(trustedReleaseKeys(JSON.stringify({ keys: [KEY] })), [KEY]);
    assert.throws(() => trustedReleaseKeys('{}'), /no "keys" list/);
    assert.throws(() => trustedReleaseKeys(JSON.stringify({ keys: [KEY, 'oops'] })), /oops/);
    assert.throws(() => trustedReleaseKeys(JSON.stringify({ keys: [KEY.slice(1)] })), /aren't base64/);
  });

  it('is the source of truth for the extension, which reads the same file', () => {
    const file = readFileSync(join(import.meta.dirname, '../apps/extension/src/update/release-keys.json'), 'utf8');
    assert.ok(Array.isArray(trustedReleaseKeys(file)));
  });

  it('lets a tag be released while no key is trusted, unsigned and with a warning', () => {
    const base = { manifestVersion: '0.2.0', packageVersion: '0.2.0', changelog: CHANGELOG };
    assert.deepEqual(releaseProblems({ ...base, tag: 'v0.2.0' }), []);
    assert.match(releaseKeyWarning([]), /trusts no signing key yet: this release will go out unsigned/);
    assert.equal(releaseKeyWarning([KEY]), null);
  });
});

describe('reproducible zip (#142)', () => {
  /** A small build folder with the given file dates (epoch seconds) and modes. */
  const build = (root, time, mode) => {
    const dist = join(root, 'dist');
    mkdirSync(join(dist, 'assets'), { recursive: true });
    const files = { 'manifest.json': '{"version":"0.2.0"}', 'assets/app.js': 'console.log(1)', 'sw.js': '// sw' };
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(join(dist, name), text);
      chmodSync(join(dist, name), mode);
      utimesSync(join(dist, name), time, time);
    }
    return dist;
  };
  const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

  it('lists files sorted, without folders', () => {
    const root = mkdtempSync(join(tmpdir(), 'xomoni-zip-'));
    try {
      assert.deepEqual(filesUnder(build(root, 1, 0o644)), ['assets/app.js', 'manifest.json', 'sw.js']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('gives the same bytes for the same files, whatever their dates, modes or the time zone', () => {
    const roots = [mkdtempSync(join(tmpdir(), 'xomoni-zip-')), mkdtempSync(join(tmpdir(), 'xomoni-zip-'))];
    try {
      const a = build(roots[0], 1_700_000_000, 0o600);
      const b = build(roots[1], 1_800_000_000, 0o755);
      const tz = process.env.TZ;
      reproducibleZip(a, join(roots[0], 'x.zip'), 1_762_000_000);
      process.env.TZ = 'Asia/Tehran';
      reproducibleZip(b, join(roots[1], 'x.zip'), 1_762_000_000);
      if (tz === undefined) Reflect.deleteProperty(process.env, 'TZ');
      else process.env.TZ = tz;
      assert.equal(sha(join(roots[0], 'x.zip')), sha(join(roots[1], 'x.zip')));

      reproducibleZip(a, join(roots[0], 'y.zip'), 1_762_000_002);
      assert.notEqual(sha(join(roots[0], 'y.zip')), sha(join(roots[0], 'x.zip')), 'the epoch is in the zip');
    } finally {
      roots.forEach((root) => rmSync(root, { recursive: true, force: true }));
    }
  });
});

describe('the store build in a release (#303)', () => {
  const source = JSON.parse(readFileSync(join(import.meta.dirname, '../apps/extension/public/manifest.json'), 'utf8'));
  /** What `vite build --mode store` makes of the manifest: no GitHub host access, no GitHub CSP sources. */
  const storeCopy = (manifest) => {
    const { optional_host_permissions: _hosts, ...rest } = manifest;
    const pages = manifest.content_security_policy.extension_pages
      .split(';')
      .map((directive) =>
        directive
          .split(' ')
          .filter((part) => !/githubusercontent|releases\/download/.test(part))
          .join(' '),
      )
      .join(';');
    return { ...rest, content_security_policy: { ...manifest.content_security_policy, extension_pages: pages } };
  };

  it('names the store build apart from the GitHub zips, with the version in its name', () => {
    assert.deepEqual(releaseZips('0.5.0'), {
      latest: 'xomoni-extension.zip',
      versioned: 'xomoni-extension-0.5.0.zip',
      store: 'xomoni-extension-store-0.5.0.zip',
    });
  });

  it('tells the store build from the default one by its manifest', () => {
    assert.equal(isStoreManifest(source), false, 'the default build may download releases from GitHub');
    assert.equal(isStoreManifest(storeCopy(source)), true);
    // Half a store build is still the default one: either kind of GitHub access is enough.
    const { optional_host_permissions: _hosts, ...withoutHosts } = source;
    assert.equal(isStoreManifest(withoutHosts), false);
    assert.equal(
      isStoreManifest({ ...storeCopy(source), optional_host_permissions: source.optional_host_permissions }),
      false,
    );
  });

  it('lists every zip in SHA256SUMS, sorted, and nothing else', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xomoni-sums-'));
    try {
      assert.equal(zipChecksums(dir), '');
      const zips = releaseZips('0.5.0');
      const files = {
        [zips.latest]: 'default build',
        [zips.versioned]: 'default build',
        [zips.store]: 'store build',
        [`${zips.latest}.sig`]: 'signature',
        'release-keys': '',
        'release-notes.md': 'notes',
      };
      for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
      const hash = (text) => createHash('sha256').update(text).digest('hex');
      assert.equal(
        zipChecksums(dir),
        [
          `${hash('default build')}  xomoni-extension-0.5.0.zip`,
          `${hash('store build')}  xomoni-extension-store-0.5.0.zip`,
          `${hash('default build')}  xomoni-extension.zip`,
          '',
        ].join('\n'),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
