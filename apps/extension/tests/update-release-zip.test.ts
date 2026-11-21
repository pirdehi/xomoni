import { describe, expect, it } from 'vitest';
import { UpdateFailure } from '../src/update/problems';
import { MAX_RELEASE_FILES, minimumChrome, readRelease, safePath } from '../src/update/release-zip';
import { releaseFiles, releaseManifest, releaseZip } from './support/release';
import type { ZipSpec } from './support/zip';

/** The failure `readRelease` throws for these files, or null when it reads them. */
async function refusal(files: ZipSpec[], version = '0.5.0'): Promise<UpdateFailure | null> {
  try {
    await readRelease(new Blob([await releaseZip(files)]), version);
    return null;
  } catch (err) {
    if (err instanceof UpdateFailure) return err;
    throw err;
  }
}

describe('paths a release may write (zip-slip, #305)', () => {
  it.each([
    'manifest.json',
    'sw.js',
    'assets/dashboard-Bz_1x-9a.js',
    'icons/icon128.png',
    '_locales/en/messages.json',
    'a/b/c/d/e/f.txt',
  ])('allows %s', (path) => {
    expect(safePath(path)).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['../evil.js', 'parent'],
    ['assets/../../evil.js', 'parent inside'],
    ['..', 'parent alone'],
    ['./sw.js', 'dot'],
    ['/etc/passwd', 'absolute'],
    ['C:/Windows/evil.js', 'drive letter'],
    ['C:evil.js', 'drive-relative'],
    ['assets\\evil.js', 'backslash'],
    ['..\\evil.js', 'backslash parent'],
    ['assets//evil.js', 'empty part'],
    ['assets/', 'folder'],
    ['.git/config', 'hidden'],
    ['assets/.htaccess', 'hidden inside'],
    ['_metadata/verified_contents.json', 'Chrome’s own folder'],
    ['assets/_locales/x.json', '_locales not at the top'],
    ['_locales', '_locales as a file'],
    ['con', 'device name'],
    ['assets/AUX.js', 'device name with extension'],
    ['lpt1.txt', 'printer'],
    ['sw.js.', 'trailing dot'],
    ['sw.js ', 'trailing space'],
    ['assets/evil\u0000.js', 'NUL'],
    ['assets/evil\n.js', 'newline'],
    ['assets/évil.js', 'not ASCII'],
    ['assets/evil:stream', 'alternate data stream'],
    ['a/b/c/d/e/f/g.txt', 'too deep'],
    [`${'a'.repeat(101)}.js`, 'part too long'],
    [`${'abcdefghi/'.repeat(20)}x`, 'too long'],
  ])('refuses %j (%s)', (path) => {
    expect(safePath(path)).toBe(false);
  });
});

describe('the browser a release needs (#305)', () => {
  it('reads the major version of minimum_chrome_version, or none', () => {
    expect(minimumChrome({})).toBeNull();
    expect(minimumChrome({ minimum_chrome_version: '137' })).toBe(137);
    expect(minimumChrome({ minimum_chrome_version: '137.0.7151.55' })).toBe(137);
  });

  it('reads a value it can’t understand as one no browser meets', () => {
    for (const value of ['soon', '', '137a', '1.2.3.4.5', 137, null]) {
      expect(minimumChrome({ minimum_chrome_version: value }), String(value)).toBe(Number.POSITIVE_INFINITY);
    }
  });
});

describe('reading a release (#305)', () => {
  it('reads every file of a complete release, and its key', async () => {
    const release = await readRelease(new Blob([await releaseZip(releaseFiles('0.5.0'))]), '0.5.0');
    expect(release.version).toBe('0.5.0');
    expect(release.key).toBeNull();
    expect(release.files.map((f) => f.path)).toEqual([
      'assets/dashboard-NEW123.js',
      'content.js',
      'dashboard.html',
      'icons/icon16.png',
      'sw.js',
      'manifest.json',
    ]);
    expect(new TextDecoder().decode(release.files[4]!.data)).toBe('// sw 0.5.0');
    expect(release.manifest).toEqual(releaseManifest('0.5.0'));

    const keyed = await readRelease(
      new Blob([await releaseZip(releaseFiles('0.5.0', releaseManifest('0.5.0', { key: 'MIIBIj…' })))]),
      '0.5.0',
    );
    expect(keyed.key).toBe('MIIBIj…');
  });

  it('refuses a zip that would write outside the folder, before reading any file', async () => {
    for (const path of ['../sw.js', '/sw.js', 'assets/../../sw.js', '..\\sw.js', 'C:/sw.js']) {
      const failure = await refusal([...releaseFiles('0.5.0'), { path, data: 'evil' }]);
      expect(failure?.problem, path).toBe('bad-package');
      expect(failure?.detail).toContain('unsafe path');
    }
  });

  it('refuses two files a case-insensitive disk would mix up, and a file that is also a folder', async () => {
    expect((await refusal([...releaseFiles('0.5.0'), { path: 'SW.js', data: 'x' }]))?.detail).toContain('two files');
    expect((await refusal([...releaseFiles('0.5.0'), { path: 'sw.js/x.js', data: 'x' }]))?.detail).toContain(
      'inside a file',
    );
  });

  it('refuses a release without a manifest at the top, or one that isn’t Manifest V3 JSON', async () => {
    const files = releaseFiles('0.5.0');
    const withoutManifest = files.filter((f) => f.path !== 'manifest.json');
    expect((await refusal(withoutManifest))?.detail).toContain('no manifest.json');
    expect((await refusal([...withoutManifest, { path: 'xomoni/manifest.json', data: '{}' }]))?.detail).toContain(
      'no manifest.json',
    );
    expect((await refusal([...withoutManifest, { path: 'manifest.json', data: '[1]' }]))?.detail).toContain(
      'not a JSON object',
    );
    expect((await refusal([...withoutManifest, { path: 'manifest.json', data: '{oops' }]))?.problem).toBe(
      'bad-package',
    );
    const v2 = releaseFiles('0.5.0', releaseManifest('0.5.0', { manifest_version: 2 }));
    expect((await refusal(v2))?.detail).toContain('Manifest V3');
  });

  it('refuses a zip whose manifest names another version than the release', async () => {
    // An older signed release served under a newer name would roll Xomoni back.
    const failure = await refusal(releaseFiles('0.4.0'), '0.5.0');
    expect(failure?.problem).toBe('wrong-version');
    expect(failure?.detail).toBe('the zip says 0.4.0');
  });

  it('refuses a release missing a script its manifest names', async () => {
    const files = releaseFiles('0.5.0').filter((f) => f.path !== 'content.js');
    expect((await refusal(files))?.detail).toBe('content.js is missing');
  });

  it('refuses a damaged zip, a lying entry and too many files', async () => {
    expect((await refusal([]))?.problem).toBe('bad-package');
    const damaged = await refusal([...releaseFiles('0.5.0'), { path: 'assets/x.js', data: 'abc', crc: 1 }]);
    expect(damaged?.problem).toBe('bad-package');
    const bomb = await refusal([
      ...releaseFiles('0.5.0'),
      { path: 'assets/x.js', data: 'a'.repeat(100), declaredSize: 10 },
    ]);
    expect(bomb?.problem).toBe('bad-package');
    const many = Array.from({ length: MAX_RELEASE_FILES + 1 }, (_, i) => ({ path: `f${i}.txt`, data: '', method: 0 }));
    expect((await refusal(many))?.detail).toBe(`${MAX_RELEASE_FILES + 1} files`);
    let failure: unknown;
    try {
      await readRelease(new Blob([new TextEncoder().encode('not a zip at all, but long enough')]), '0.5.0');
    } catch (err) {
      failure = err;
    }
    expect(failure).toBeInstanceOf(UpdateFailure);
  });
});
