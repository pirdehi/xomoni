// Tests for tooling/release-lib.mjs, run by `node --test tooling/` in `npm run verify`.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { changelogSection, releaseProblems, versionOfTag } from './release-lib.mjs';

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
