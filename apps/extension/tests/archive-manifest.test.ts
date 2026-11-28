import { describe, expect, it } from 'vitest';
import { MAX_MANIFEST_BYTES, parseThar } from '../src/shared/vault/archive-manifest';
import { ARCHIVE_OWNER, GENERATED_AT, manifestText } from './support/archive';

// `data/manifest.js` of X's archive (#424, CV.1.5): when X made it, whether it is partial, its size and its counts,
// read tolerantly, as X changes the file without notice.

/** A manifest as X writes it, with `config` over the usual one. */
const thar = (config: unknown) => `window.__THAR_CONFIG = ${JSON.stringify(config)}`;

describe('the archive’s manifest (parseThar)', () => {
  it('reads a complete manifest as X writes it', () => {
    const text = manifestText(ARCHIVE_OWNER, {
      generationDate: GENERATED_AT,
      isPartialArchive: false,
      sizeBytes: 123_456_789,
      counts: { account: 1, tweets: 1_200, like: 3_400, follower: 56 },
    });
    expect(parseThar(text)).toEqual({
      generationDate: GENERATED_AT,
      isPartialArchive: false,
      sizeBytes: 123_456_789,
      counts: { account: 1, tweets: 1_200, like: 3_400, follower: 56 },
      accountId: ARCHIVE_OWNER.id,
      userName: ARCHIVE_OWNER.handle,
    });
    expect(MAX_MANIFEST_BYTES).toBe(1024 * 1024);
  });

  it('reads a partial archive, a closing semicolon, and counts split over several files', () => {
    const text = `${thar({
      archiveInfo: { generationDate: '2026-01-02T03:04:05.000Z', isPartialArchive: 'true', sizeBytes: 42 },
      dataTypes: {
        tweets: {
          files: [
            { fileName: 'data/tweets.js', count: '20000' },
            { fileName: 'data/tweets-part1.js', count: 1234 },
          ],
        },
      },
    })};\n`;
    expect(parseThar(text)).toMatchObject({
      generationDate: Date.UTC(2026, 0, 2, 3, 4, 5),
      isPartialArchive: true,
      sizeBytes: 42,
      counts: { tweets: 21_234 },
    });
  });

  it('ignores fields it doesn’t know, and reads a field in a shape it doesn’t know as unknown', () => {
    const read = parseThar(
      thar({
        userInfo: { accountId: 'not-an-id', userName: '<b>me</b>', avatar: 'x' },
        archiveInfo: { generationDate: 'yesterday', isPartialArchive: 'maybe', sizeBytes: '-5', newField: 1 },
        readmeInfo: { anything: true },
        somethingNew: [1, 2, 3],
        dataTypes: {
          tweets: { files: [{ count: 'many' }] },
          '<img src=x>': { files: [{ count: '1' }] },
          like: { files: 'not a list' },
          follower: { files: [{ count: 1.5 }, { count: '3' }] },
        },
      }),
    );
    expect(read).toEqual({
      generationDate: null,
      isPartialArchive: null,
      sizeBytes: null,
      counts: { follower: 3 },
      accountId: null,
      userName: null,
    });
  });

  it('reads an empty manifest as one that says nothing', () => {
    expect(parseThar('window.__THAR_CONFIG = {}')).toEqual({
      generationDate: null,
      isPartialArchive: null,
      sizeBytes: null,
      counts: {},
      accountId: null,
      userName: null,
    });
  });

  it('refuses what isn’t a manifest: broken JSON, another global, a list, no assignment', () => {
    for (const text of [
      '',
      'window.__THAR_CONFIG = {',
      'window.__THAR_CONFIG = [1, 2]',
      'window.__THAR_CONFIG = null',
      'window.YTD.tweets.part0 = {}',
      '{"archiveInfo": {}}',
      'not a manifest at all',
    ]) {
      expect(parseThar(text), text).toBeNull();
    }
  });
});
