// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveImported, db } from '../../src/shared/db';
import { importArchive } from '../../src/ui/importArchive';
import { accountJs, draft, likeJs, seed, tweetsJs, watchNetwork, ytdFile } from '../support/cleanup-pages';
import { ME, account, resetDb } from '../support/fixtures';

const ME_ACCOUNT = account();

const TWEETS = tweetsJs([
  { id: '1000000001', text: 'First post', createdAt: 'Mon Jan 01 12:00:00 +0000 2018', likes: 4 },
  {
    id: '1000000002',
    text: '@bob a reply',
    createdAt: 'Tue Jan 02 12:00:00 +0000 2018',
    inReplyToStatusId: '900',
    inReplyToUserId: '42',
  },
  {
    id: '1000000003',
    text: 'continuing my thread',
    createdAt: 'Wed Jan 03 12:00:00 +0000 2018',
    inReplyToStatusId: '1000000001',
    inReplyToUserId: ME,
  },
  { id: '1000000004', text: 'RT @alice: worth reading', createdAt: 'Thu Jan 04 12:00:00 +0000 2018' },
]);
const LIKES = likeJs([
  { tweetId: '1100000000000000001', fullText: 'A liked post' },
  { tweetId: '1100000000000000002', fullText: 'Another one' },
]);

/** Spies on `text()` of a file, to see which files the importer opened. */
function watchRead(file: File) {
  return vi.spyOn(file, 'text');
}

describe('importArchive', () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('merges tweets and likes of the connected account into the inventory', async () => {
    const progress = vi.fn();
    const result = await importArchive([accountJs(ME, 'me'), TWEETS, LIKES], ME_ACCOUNT, progress);

    expect(result).toEqual({ tweets: 4, likes: 2 });
    const items = await db.items.toArray();
    expect(items).toHaveLength(6);
    expect(items.every((i) => i.accountId === ME && i.sources.join() === 'archive' && i.status === 'present')).toBe(
      true,
    );
    expect(await db.items.get(`${ME}:post:1000000001`)).toMatchObject({
      text: 'First post',
      likes: 4,
      author: 'me',
      createdAt: Date.UTC(2018, 0, 1, 12),
    });
    expect(await db.items.get(`${ME}:reply:1000000002`)).toMatchObject({ inReplyToId: '900', selfReply: false });
    expect(await db.items.get(`${ME}:reply:1000000003`)).toMatchObject({ selfReply: true });
    expect(await db.items.get(`${ME}:repost:1000000004`)).toMatchObject({ author: 'alice', targetId: '' });
    expect(await db.items.get(`${ME}:like:1100000000000000001`)).toMatchObject({
      kind: 'like',
      text: 'A liked post',
    });

    expect(await archiveImported(ME)).toBe(true);
    const logs = await db.logs.toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      accountId: ME,
      jobId: null,
      level: 'success',
      action: 'system',
      message: 'Imported archive: 4 posts/replies/reposts and 2 likes',
    });

    expect(progress).toHaveBeenCalledWith('Reading tweets.js…');
    expect(progress).toHaveBeenCalledWith('Saving tweets.js: 4 / 4');
    expect(progress).toHaveBeenCalledWith('Reading like.js…');
    expect(progress).toHaveBeenCalledWith('Saving like.js: 2 / 2');
  });

  it('refuses an archive of another account before reading anything else from it', async () => {
    const tweets = tweetsJs([{ id: '1000000009', text: 'Not mine', createdAt: 'Mon Jan 01 12:00:00 +0000 2018' }]);
    const likes = likeJs([{ tweetId: '1100000000000000009', fullText: 'Not mine either' }]);
    const tweetsRead = watchRead(tweets);
    const likesRead = watchRead(likes);
    const progress = vi.fn();

    await expect(
      importArchive([tweets, likes, accountJs('acct-other', 'someone')], ME_ACCOUNT, progress),
    ).rejects.toThrow('This archive belongs to @someone, not @me. Nothing was imported.');

    expect(tweetsRead).not.toHaveBeenCalled();
    expect(likesRead).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
    expect(await db.items.count()).toBe(0);
    expect(await db.logs.count()).toBe(0);
    expect(await archiveImported(ME)).toBe(false);
  });

  it('names a foreign archive by its account id when it has no handle', async () => {
    const owner = ytdFile('account.js', 'account', [{ account: { accountId: '777' } }]);
    await expect(importArchive([owner, TWEETS], ME_ACCOUNT, vi.fn())).rejects.toThrow(
      'This archive belongs to @777, not @me.',
    );
  });

  it('needs account.js to check whose archive it is', async () => {
    await expect(importArchive([TWEETS, LIKES], ME_ACCOUNT, vi.fn())).rejects.toThrow(
      'account.js is missing. Include it so Xomoni can check the archive belongs to @me.',
    );
    expect(await db.items.count()).toBe(0);
  });

  it('needs tweets.js or like.js', async () => {
    await expect(importArchive([accountJs(ME, 'me')], ME_ACCOUNT, vi.fn())).rejects.toThrow(
      'No tweets.js or like.js found. Choose the “data” folder inside your unzipped X archive.',
    );
    await expect(importArchive([], ME_ACCOUNT, vi.fn())).rejects.toThrow(/No tweets\.js or like\.js found/);
  });

  it('refuses an account.js it cannot read', async () => {
    const empty = ytdFile('account.js', 'account', [{ account: { username: 'me' } }]);
    await expect(importArchive([empty, TWEETS], ME_ACCOUNT, vi.fn())).rejects.toThrow(
      'Could not read account.js from the archive.',
    );
    const garbage = new File(['not an archive'], 'account.js');
    await expect(importArchive([garbage, TWEETS], ME_ACCOUNT, vi.fn())).rejects.toThrow('Not an X archive data file');
    expect(await db.items.count()).toBe(0);
    expect(await archiveImported(ME)).toBe(false);
  });

  it('opens only account.js, tweets.js and like.js, found by their path in the data folder', async () => {
    const messages = ytdFile(
      'direct-messages.js',
      'direct_messages',
      [{ secret: 'hello' }],
      'x/data/direct-messages.js',
    );
    const deleted = ytdFile('deleted-tweets.js', 'deleted_tweets', [], 'x/data/deleted-tweets.js');
    const media = new File(['binary'], 'photo.jpg');
    const others = [messages, deleted, media].map(watchRead);
    const owner = accountJs(ME, 'me', 'x/data/account.js');
    const part = tweetsJs(
      [{ id: '1000000005', text: 'From part 1', createdAt: 'Fri Jan 05 12:00:00 +0000 2018' }],
      'tweets-part1.js',
      'x/data/tweets-part1.js',
    );

    const partRead = watchRead(part);

    const result = await importArchive([messages, owner, deleted, media, part], ME_ACCOUNT, vi.fn());

    expect(result).toEqual({ tweets: 1, likes: 0 });
    expect(partRead).toHaveBeenCalledOnce();
    for (const read of others) expect(read).not.toHaveBeenCalled();
    expect(await db.items.get(`${ME}:post:1000000005`)).toBeDefined();
  });

  it('adds the archive as a source of items a scan already found, without losing what the scan saw', async () => {
    await seed([draft({ id: '1000000001', text: 'Seen live', likes: 50, createdAt: Date.UTC(2018, 0, 1, 12) })]);
    await importArchive([accountJs(ME, 'me'), TWEETS], ME_ACCOUNT, vi.fn());

    expect(await db.items.get(`${ME}:post:1000000001`)).toMatchObject({
      text: 'Seen live',
      likes: 50,
      sources: ['scan', 'archive'],
    });
  });

  it('saves a large file in chunks and reports each one', async () => {
    const many = tweetsJs(
      Array.from({ length: 2001 }, (_, i) => ({
        id: String(2_000_000_000 + i),
        text: `Post ${i}`,
        createdAt: 'Mon Jan 01 12:00:00 +0000 2018',
      })),
    );
    const progress = vi.fn<(msg: string) => void>();
    const result = await importArchive([accountJs(ME, 'me'), many], ME_ACCOUNT, progress);

    expect(result.tweets).toBe(2001);
    expect(await db.items.count()).toBe(2001);
    expect(progress.mock.calls.map(([msg]) => msg)).toEqual([
      'Reading tweets.js…',
      `Saving tweets.js: ${(2000).toLocaleString()} / ${(2001).toLocaleString()}`,
      `Saving tweets.js: ${(2001).toLocaleString()} / ${(2001).toLocaleString()}`,
    ]);
  });

  it('sends nothing off this computer', async () => {
    const network = watchNetwork();
    await importArchive([accountJs(ME, 'me'), TWEETS, LIKES], ME_ACCOUNT, vi.fn());
    expect(network.calls()).toBe(0);
  });
});
