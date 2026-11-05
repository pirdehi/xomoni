import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  currentUpdateNotice,
  dismissUpdate,
  isNewer,
  parseReleaseNews,
  saveReleaseNews,
  updateNotice,
} from '../src/cloud/release';
import { resetDb } from './support/fixtures';

describe('versions compare as numbers (#151)', () => {
  it.each([
    ['0.2.0', '0.1.0', true],
    ['0.10.0', '0.9.0', true],
    ['1.0.0', '0.99.99', true],
    ['0.1.1', '0.1.0', true],
    ['0.1.0', '0.1.0', false],
    ['0.9.0', '0.10.0', false],
    ['0.2', '0.1.0', false],
    ['0.2.0', 'dev', false],
  ])('%s is newer than %s: %s', (a, b, newer) => {
    expect(isNewer(a, b)).toBe(newer);
  });
});

describe('the answer to a status report', () => {
  it('names the newest release and whether a security fix came out since', () => {
    expect(parseReleaseNews({ latest: '0.2.0', security: true })).toEqual({ latest: '0.2.0', security: true });
    expect(parseReleaseNews({ latest: '0.2.0' })).toEqual({ latest: '0.2.0', security: false });
    expect(parseReleaseNews({ latest: '0.2.0', security: 'yes' })).toEqual({ latest: '0.2.0', security: false });
  });

  it('carries nothing from an older server, or a version that isn’t one', () => {
    for (const answer of [null, '', [], {}, { latest: null }, { latest: 'v0.2.0' }, { latest: '<b>1.0.0</b>' }]) {
      expect(parseReleaseNews(answer)).toBeNull();
    }
  });
});

describe('the notice', () => {
  const NEWS = { latest: '0.2.0', security: false };

  it('shows a newer version until the person dismisses it', () => {
    expect(updateNotice(NEWS, '0.1.0', null)).toEqual({ version: '0.2.0', security: false });
    expect(updateNotice(NEWS, '0.1.0', '0.2.0')).toBeNull();
    // A dismissal holds only for the version it was given for.
    expect(updateNotice({ ...NEWS, latest: '0.3.0' }, '0.1.0', '0.2.0')).toEqual({ version: '0.3.0', security: false });
  });

  it('can’t be dismissed when the release fixes a vulnerability', () => {
    expect(updateNotice({ ...NEWS, security: true }, '0.1.0', '0.2.0')).toEqual({ version: '0.2.0', security: true });
  });

  it('says nothing to an up-to-date or newer browser, or without news', () => {
    expect(updateNotice(NEWS, '0.2.0', null)).toBeNull();
    expect(updateNotice(NEWS, '0.3.0', null)).toBeNull();
    expect(updateNotice(null, '0.1.0', null)).toBeNull();
  });

  describe('as stored', () => {
    beforeEach(async () => {
      await resetDb();
    });

    it('comes from the last answer and the last dismissal', async () => {
      expect(await currentUpdateNotice('0.1.0')).toBeNull();
      await saveReleaseNews(NEWS);
      expect(await currentUpdateNotice('0.1.0')).toEqual({ version: '0.2.0', security: false });
      await dismissUpdate('0.2.0');
      expect(await currentUpdateNotice('0.1.0')).toBeNull();
    });
  });
});
