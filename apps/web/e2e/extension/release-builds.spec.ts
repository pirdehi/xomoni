import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { EXTENSION_DIR_ENV } from '../support/build-extension';
import { PREVIOUS_DIR_ENV, isNewer, releaseBuild, releaseBuilds } from '../support/release-builds';

// The release smoke test's choice of builds (#419, `e2e/support/release-builds.ts`): it runs only on two releases' zips
// the maintainer unpacked, so its checks run here, in every pull request, with no browser.

test.describe('the release smoke test’s builds (#419)', () => {
  let root: string;
  test.beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'xomoni-release-builds-'));
  });
  test.afterEach(() => rmSync(root, { recursive: true, force: true }));

  /** A folder holding `manifest` as manifest.json, as an unpacked zip has, or nothing when it is null. */
  function folder(manifest: Record<string, unknown> | null): string {
    const dir = mkdtempSync(path.join(root, 'build-'));
    if (manifest) writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    return dir;
  }

  test('compares versions by their numbers', () => {
    expect(isNewer('0.5.3', '0.5.2')).toBe(true);
    expect(isNewer('0.10.0', '0.9.1')).toBe(true);
    expect(isNewer('1.0.0', '0.99.99')).toBe(true);
    expect(isNewer('0.5.2', '0.5.2')).toBe(false);
    expect(isNewer('0.5.1', '0.5.2')).toBe(false);
    expect(isNewer('1.0', '1.0.0')).toBe(false);
  });

  test('takes an unpacked zip, and says how to get one when a folder is not one', () => {
    const dir = folder({ name: 'Xomoni', version: '0.5.2' });
    expect(releaseBuild(EXTENSION_DIR_ENV, { [EXTENSION_DIR_ENV]: dir })).toEqual({ dir, version: '0.5.2' });

    const fetch = /node tooling\/release-download\.mjs vX\.Y\.Z <folder>/;
    expect(() => releaseBuild(PREVIOUS_DIR_ENV, {})).toThrow(`${PREVIOUS_DIR_ENV} is not set`);
    expect(() => releaseBuild(PREVIOUS_DIR_ENV, {})).toThrow(fetch);
    const empty = folder(null);
    expect(() => releaseBuild(PREVIOUS_DIR_ENV, { [PREVIOUS_DIR_ENV]: empty })).toThrow(
      `${PREVIOUS_DIR_ENV}=${empty} has no manifest.json`,
    );
    const unversioned = folder({ name: 'Xomoni' });
    expect(() => releaseBuild(PREVIOUS_DIR_ENV, { [PREVIOUS_DIR_ENV]: unversioned })).toThrow('has no version');
  });

  test('needs both releases, the candidate the newer', () => {
    const v051 = folder({ version: '0.5.1' });
    const v052 = folder({ version: '0.5.2' });
    expect(releaseBuilds({ [EXTENSION_DIR_ENV]: v052, [PREVIOUS_DIR_ENV]: v051 })).toEqual({
      candidate: { dir: v052, version: '0.5.2' },
      previous: { dir: v051, version: '0.5.1' },
    });
    expect(() => releaseBuilds({ [EXTENSION_DIR_ENV]: v051, [PREVIOUS_DIR_ENV]: v052 })).toThrow(
      `${EXTENSION_DIR_ENV} is Xomoni 0.5.1, not newer than ${PREVIOUS_DIR_ENV}'s 0.5.2`,
    );
    expect(() => releaseBuilds({ [EXTENSION_DIR_ENV]: v052, [PREVIOUS_DIR_ENV]: v052 })).toThrow('not newer');
    expect(() => releaseBuilds({ [EXTENSION_DIR_ENV]: v052 })).toThrow(`${PREVIOUS_DIR_ENV} is not set`);
  });
});
