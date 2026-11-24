// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { classifyArchiveFile, parseArchiveAccount, parseYtd } from '../src/shared/archive';
import { db } from '../src/shared/db';
import { snowflakeTime } from '../src/shared/time';
import { importArchive } from '../src/ui/importArchive';
import { listZip, readZipEntry } from '../src/shared/zip';
import {
  ARCHIVE_NAME,
  ARCHIVE_OWNER,
  GENERATED_AT,
  OTHER_OWNER,
  archiveSpecs,
  buildArchive,
  manifestText,
  syntheticId,
  syntheticLikes,
  syntheticTweets,
} from './support/archive';
import { account, resetDb } from './support/fixtures';

// The vault's archive builder (#424, CV.1.6) is tested on its own: what it makes must be what X sends, or every test
// built on it proves nothing.

const utf8 = new TextDecoder();

/** The text of `path` in `zip`, read with Xomoni's own reader. */
async function entryText(zip: File, path: string): Promise<string> {
  const entry = (await listZip(zip)).find((e) => e.path === path);
  if (!entry) throw new Error(`${path} is not in the ZIP`);
  return utf8.decode(await readZipEntry(zip, entry));
}

/** `data/manifest.js` read as the object X writes after `window.__THAR_CONFIG =`. */
async function manifestOf(zip: File): Promise<Record<string, unknown>> {
  const text = await entryText(zip, 'data/manifest.js');
  expect(text.startsWith('window.__THAR_CONFIG = ')).toBe(true);
  return JSON.parse(text.slice(text.indexOf('=') + 1)) as Record<string, unknown>;
}

const owner = account({ id: ARCHIVE_OWNER.id, handle: ARCHIVE_OWNER.handle });

describe('the made-up archive', () => {
  beforeEach(resetDb);

  it('is a ZIP Xomoni’s reader opens, laid out as X lays it out', async () => {
    const zip = await buildArchive();
    expect(zip.name).toBe(ARCHIVE_NAME);
    expect((await listZip(zip)).map((e) => e.path)).toEqual([
      'Your archive.html',
      'data/account.js',
      'data/tweets.js',
      'data/like.js',
      'data/tweets_media/9000000000000000100-photo.jpg',
      'data/manifest.js',
    ]);
    const accountRows = parseYtd(await entryText(zip, 'data/account.js'));
    expect(parseArchiveAccount(accountRows)).toEqual({ accountId: ARCHIVE_OWNER.id, handle: ARCHIVE_OWNER.handle });
    expect(parseYtd(await entryText(zip, 'data/tweets.js'))).toHaveLength(3);
    expect(parseYtd(await entryText(zip, 'data/like.js'))).toHaveLength(2);
    expect(classifyArchiveFile('data/manifest.js')).toBeNull();
  });

  it('is imported by today’s archive import, posts and likes', async () => {
    const zip = await buildArchive({ tweets: syntheticTweets(14), likes: syntheticLikes(5) });
    const result = await importArchive([zip], owner, () => undefined);
    expect(result).toEqual({ tweets: 14, likes: 5 });
    const items = await db.items.where('accountId').equals(owner.id).toArray();
    expect(items.filter((i) => i.kind === 'like')).toHaveLength(5);
    expect(items.filter((i) => i.kind === 'repost')).toHaveLength(2);
    expect(items.filter((i) => i.kind === 'reply')).toHaveLength(2);
    // X's escaped text is decoded, as the import does with a real archive.
    expect(items.find((i) => i.id === syntheticId(100))?.text).toBe('Made-up post 1 & nothing real');
  });

  it('belongs to another account when asked, and today’s import refuses it', async () => {
    const zip = await buildArchive({ account: OTHER_OWNER });
    await expect(importArchive([zip], owner, () => undefined)).rejects.toThrow(
      `This archive belongs to @${OTHER_OWNER.handle}, not @${ARCHIVE_OWNER.handle}. Nothing was imported.`,
    );
    expect(await db.items.count()).toBe(0);
  });

  it('writes a manifest whose counts match what the archive holds, with X’s names and the date X made it', async () => {
    const zip = await buildArchive({ tweets: syntheticTweets(7), likes: syntheticLikes(4) });
    const manifest = await manifestOf(zip);
    expect(manifest.userInfo).toEqual({
      accountId: ARCHIVE_OWNER.id,
      userName: ARCHIVE_OWNER.handle,
      displayName: ARCHIVE_OWNER.name,
    });
    expect(manifest.archiveInfo).toMatchObject({
      generationDate: new Date(GENERATED_AT).toISOString(),
      isPartialArchive: false,
      sizeBytes: '123456789',
    });
    const types = manifest.dataTypes as Record<string, { files: { fileName: string; count: string }[] }>;
    expect(types.tweets?.files[0]).toMatchObject({ fileName: 'data/tweets.js', count: '7' });
    expect(types.like?.files[0]).toMatchObject({ fileName: 'data/like.js', count: '4' });
    expect(types.account?.files[0]?.count).toBe('1');
  });

  it('leaves the manifest out, or makes it say what a test needs', async () => {
    const without = await buildArchive({ manifest: false });
    expect((await listZip(without)).map((e) => e.path)).not.toContain('data/manifest.js');
    const partial = await manifestOf(
      await buildArchive({ manifest: { isPartialArchive: true, generationDate: Date.UTC(2026, 0, 2) } }),
    );
    expect(partial.archiveInfo).toMatchObject({ isPartialArchive: true, generationDate: '2026-01-02T00:00:00.000Z' });
    const text = manifestText(ARCHIVE_OWNER, {
      generationDate: GENERATED_AT,
      isPartialArchive: false,
      sizeBytes: 1,
      counts: { follower: 3 },
    });
    expect(text).toContain('"fileName": "data/follower.js"');
  });

  it('takes a feature’s own files, and leaves out what a test asks', async () => {
    const zip = await buildArchive({
      extra: [{ path: 'data/follower.js', data: 'window.YTD.follower.part0 = []' }],
      without: ['data/account.js'],
    });
    const paths = (await listZip(zip)).map((e) => e.path);
    expect(paths).toContain('data/follower.js');
    expect(paths).not.toContain('data/account.js');
    await expect(importArchive([zip], owner, () => undefined)).rejects.toThrow('account.js is missing');
  });

  it('writes ZIP64 records, as X does for a large archive, and Xomoni still reads it', async () => {
    const many = Array.from({ length: 300 }, (_, i) => ({
      path: `data/tweets_media/${syntheticId(1_000 + i)}-photo.jpg`,
      data: new Uint8Array([0xff, 0xd8, i & 0xff]),
      method: 0,
    }));
    const zip = await buildArchive({ zip64: true, extra: many });
    const tail = new DataView(await zip.slice(zip.size - 22).arrayBuffer());
    // The end record defers to the ZIP64 one: its count and offset are all ones.
    expect(tail.getUint16(10, true)).toBe(0xffff);
    expect(tail.getUint32(16, true)).toBe(0xffffffff);
    expect(await listZip(zip)).toHaveLength(306);
    expect(await importArchive([zip], owner, () => undefined)).toEqual({ tweets: 3, likes: 2 });
  });

  it('uses only ids X hasn’t issued, and no real handle', () => {
    for (const tweet of syntheticTweets(2_000)) {
      expect(tweet.id_str).toMatch(/^9000000000000\d{6}$/);
      // Its snowflake time is decades from now, so Xomoni reads no time from it: no real post has such an id.
      expect(snowflakeTime(tweet.id_str)).toBeNull();
    }
    for (const like of syntheticLikes(10)) expect(like.tweetId.startsWith('9000000000000')).toBe(true);
    const text = archiveSpecs()
      .map((spec) => (typeof spec.data === 'string' ? spec.data : ''))
      .join('\n');
    for (const handle of text.match(/@\w+/g) ?? []) expect(['@fixture_friend']).toContain(handle);
    expect(syntheticId(5)).toBe('9000000000000000005');
  });
});

describe('the synthetic analytics exports (apps/web/e2e/fixtures/analytics)', () => {
  // Read as text by Vite (`?raw`), as `store-listings.test.ts` reads the website's files: the apps don't import each other.
  const exports = import.meta.glob<string>('../../web/e2e/fixtures/analytics/*.csv', {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  const files = Object.entries(exports).map(([where, text]) => [where.split('/').pop() ?? where, text] as const);

  it('are the five the vault’s tests read', () => {
    expect(files.map(([name]) => name).sort()).toEqual([
      'broken.csv',
      'content-2026.csv',
      'not-analytics.csv',
      'overview-2026.csv',
      'tweet-activity-legacy.csv',
    ]);
  });

  it.each(files)('%s holds no real id or handle', (_, text) => {
    // Whole numbers of 12 digits or more are ids; a rate such as 0.0288… is not one.
    for (const id of text.match(/(?<![\d.])\d{12,}(?![\d.])/g) ?? [])
      expect(id.startsWith('9000000000000'), id).toBe(true);
    for (const handle of text.match(/@\w+|(?:x|twitter)\.com\/\w+/g) ?? []) {
      expect(['@fixture_friend', 'x.com/xomoni_fixture', 'twitter.com/xomoni_fixture'], handle).toContain(handle);
    }
  });
});
