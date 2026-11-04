// Tests for tooling/release-lib.mjs, run by `node --test 'tooling/*.test.mjs'` in `npm run verify`.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { changelogSection, filesUnder, releaseProblems, reproducibleZip, versionOfTag } from './release-lib.mjs';

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
