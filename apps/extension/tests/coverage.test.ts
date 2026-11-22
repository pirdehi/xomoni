import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runCleanup } from '../src/engine/cleanup';
import type { JobContext } from '../src/engine/context';
import { unseenPosts, worthWarning } from '../src/shared/coverage';
import { archiveImported, db, itemKey, markArchiveImported, postTotals } from '../src/shared/db';
import type { Account, Item, ItemStatus } from '../src/shared/types';

const ACCOUNT = 'acct-1';
const NOW = Date.now();
const HOUR = 3_600_000;

describe('unseenPosts (#15, PLAYBOOK E2)', () => {
  it('takes what Xomoni removed since X’s count off that count', () => {
    expect(unseenPosts({ postsCount: 500, profileSeen: true, present: 100, removedSinceProfile: 40 })).toBe(360);
    expect(unseenPosts({ postsCount: 50, profileSeen: true, present: 100, removedSinceProfile: 0 })).toBe(0);
  });

  it('does not guess without X’s count or when it was seen', () => {
    expect(unseenPosts({ postsCount: null, profileSeen: true, present: 1, removedSinceProfile: 0 })).toBeNull();
    expect(unseenPosts({ postsCount: 500, profileSeen: false, present: 1, removedSinceProfile: 0 })).toBeNull();
  });

  it('warns only about a gap of more than 20 posts and 2% of X’s count', () => {
    expect(worthWarning(21, 500)).toBe(true);
    expect(worthWarning(20, 500)).toBe(false);
    expect(worthWarning(150, 10_000)).toBe(false);
    expect(worthWarning(null, 500)).toBe(false);
  });
});

const item = (id: string, status: ItemStatus = 'present', statusAt = NOW): Item => ({
  key: itemKey(ACCOUNT, 'post', id),
  accountId: ACCOUNT,
  kind: 'post',
  id,
  targetId: id,
  createdAt: NOW - 400 * 86_400_000,
  likedAt: null,
  text: `post ${id}`,
  author: 'me',
  inReplyToId: null,
  selfReply: false,
  likes: 0,
  reposts: 0,
  replies: 0,
  sources: ['scan'],
  status,
  seenAt: NOW,
  statusAt,
  lastJobId: null,
});

const account = (patch: Partial<Account>): Account => ({
  id: ACCOUNT,
  handle: 'me',
  name: '',
  avatar: '',
  postsCount: null,
  likesCount: null,
  followers: null,
  following: null,
  createdAt: null,
  updatedAt: NOW,
  ...patch,
});

/** A cleanup run whose pages all come back empty. */
function fakeContext(options: { sweep: boolean; deep: boolean }) {
  return {
    job: {
      id: 'j',
      accountId: ACCOUNT,
      filter: {
        target: 'post',
        before: NOW,
        after: null,
        keepMinLikes: null,
        keepKeywords: [],
        keepIds: [],
        skipSelfReplies: false,
      },
      options: { ...options, ghostLikes: false },
      stats: { matched: 0, done: 0, skipped: 0, failed: 0, scanned: 0 },
    },
    handle: 'me',
    attempted: new Set<string>(),
    preflighted: new Set<string>(),
    navigate: vi.fn(async (_url: string) => ({ kind: 'empty', count: 0, http: 200 })),
    note: vi.fn(async (_message: string) => {}),
    log: vi.fn(async () => 0),
    save: vi.fn(async () => {}),
    setPhase: vi.fn(async () => {}),
    status: vi.fn(),
    checkpoint: vi.fn(),
  };
}
const run = (ctx: ReturnType<typeof fakeContext>) => runCleanup(ctx as unknown as JobContext);
const notes = (ctx: ReturnType<typeof fakeContext>) => ctx.note.mock.calls.map((call) => call[0]);

beforeEach(async () => {
  await Promise.all([db.items.clear(), db.accounts.clear(), db.kv.clear(), db.checks.clear()]);
});

describe('Cleanup and what X search can’t show (#15, PLAYBOOK E2, C6)', () => {
  it('sweeps the profile first on an account small enough for it', async () => {
    await db.accounts.put(account({ postsCount: 1200, profileAt: NOW }));
    const ctx = fakeContext({ sweep: true, deep: false });
    await run(ctx);
    const urls = ctx.navigate.mock.calls.map((call) => call[0]);
    expect(urls[0]).toBe('https://x.com/me');
    expect(urls[1]).toContain('https://x.com/search?');
  });

  it('warns when search shows nothing while the inventory still has matches', async () => {
    await db.items.add(item('1'));
    const ctx = fakeContext({ sweep: true, deep: false });
    await run(ctx);
    expect(notes(ctx)).toEqual([
      expect.stringMatching(/^X search showed none of the 1 matching posts.*Turn on the deep clean/),
    ]);
  });

  it('reports the posts X has that Xomoni doesn’t know about', async () => {
    await db.accounts.put(account({ postsCount: 500, profileAt: NOW - HOUR }));
    await db.items.bulkAdd([item('1'), item('2'), item('3', 'deleted', NOW), item('4', 'deleted', NOW - 2 * HOUR)]);
    const ctx = fakeContext({ sweep: false, deep: false });
    await run(ctx);
    // 500 on X, one removed since X counted, two still present: about 497 unseen.
    expect(notes(ctx)).toEqual([expect.stringContaining('about 497 more posts')]);
  });

  it('says nothing about unseen posts without a fresh count from X', async () => {
    await db.accounts.put(account({ postsCount: 500 }));
    const ctx = fakeContext({ sweep: false, deep: false });
    await run(ctx);
    expect(ctx.note).not.toHaveBeenCalled();
  });
});

describe('postTotals (#390)', () => {
  it('counts what is on X less what is gone, the account’s own only, and what was removed since X’s count', async () => {
    const other = `${ACCOUNT}0`;
    await db.items.bulkAdd([
      item('1'),
      item('2'),
      item('3', 'gone'),
      item('4', 'deleted', NOW - HOUR),
      item('5', 'deleted', NOW + HOUR),
      { ...item('6'), key: itemKey(other, 'post', '6'), accountId: other },
      { ...item('7', 'deleted', NOW + HOUR), key: itemKey(other, 'post', '7'), accountId: other },
    ]);
    expect(await postTotals(account({ profileAt: NOW }))).toEqual({ present: 2, removedSinceProfile: 1 });
    // Before X's count was ever seen, nothing removed is in it.
    expect(await postTotals(account({}))).toEqual({ present: 2, removedSinceProfile: 0 });
  });
});

describe('archiveImported', () => {
  it('is false until an archive is imported, and finds imports from before the marker', async () => {
    expect(await archiveImported(ACCOUNT)).toBe(false);
    await markArchiveImported(ACCOUNT);
    expect(await archiveImported(ACCOUNT)).toBe(true);

    await db.kv.clear();
    await db.items.add({ ...item('9'), sources: ['archive'] });
    expect(await archiveImported(ACCOUNT)).toBe(true);
  });

  it('without the marker, finds an archive item past thousands of others, and only the account’s own (#390)', async () => {
    // 4,500 posts read from X, then one from the archive last in key order: past two of its bulk reads.
    await db.items.bulkAdd(Array.from({ length: 4_500 }, (_, n) => item(`1${String(n).padStart(5, '0')}`)));
    expect(await archiveImported(ACCOUNT)).toBe(false);
    await db.items.add({ ...item('199999'), sources: ['scan', 'archive'] });
    expect(await archiveImported(ACCOUNT)).toBe(true);

    // An account whose id starts with this one's has its own items.
    const longer = `${ACCOUNT}0`;
    await db.items.add({ ...item('5'), key: itemKey(longer, 'post', '5'), accountId: longer, sources: ['archive'] });
    expect(await archiveImported(longer)).toBe(true);
    await db.items.delete(itemKey(ACCOUNT, 'post', '199999'));
    expect(await archiveImported(ACCOUNT)).toBe(false);
  });
});
