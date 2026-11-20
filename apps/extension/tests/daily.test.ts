import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  NO_DELTA,
  addDelta,
  emptyDay,
  localDay,
  sightingDelta,
  sumDeltas,
  withProfile,
  withPublishedAndRemoved,
} from '../src/shared/daily';
import {
  addLog,
  dailyRows,
  db,
  forgetAccount,
  itemKey,
  recordProfileDay,
  upsertAccount,
  upsertItems,
} from '../src/shared/db';
import type { Item, ItemDraft } from '../src/shared/types';
import { ME, account, resetDb } from './support/fixtures';

const DAY_MS = 86_400_000;
// Noon local time, so a few hours either way stay on the same day in any time zone.
const NOON = new Date(2026, 10, 18, 12, 0, 0).getTime();
const NEXT_NOON = NOON + DAY_MS;

function item(over: Partial<Item> = {}): Item {
  return {
    key: itemKey(ME, 'post', '1'),
    accountId: ME,
    kind: 'post',
    id: '1',
    targetId: '1',
    createdAt: NOON - 30 * DAY_MS,
    likedAt: null,
    text: 'hello',
    author: 'me',
    inReplyToId: null,
    selfReply: false,
    likes: 0,
    reposts: 0,
    replies: 0,
    sources: ['scan'],
    status: 'present',
    seenAt: NOON,
    statusAt: NOON,
    lastJobId: null,
    ...over,
  };
}

function draft(over: Partial<ItemDraft> = {}): ItemDraft {
  return {
    kind: 'post',
    id: '1',
    targetId: '1',
    createdAt: NOON - 30 * DAY_MS,
    likedAt: null,
    text: 'hello',
    author: 'me',
    inReplyToId: null,
    selfReply: false,
    likes: 0,
    reposts: 0,
    replies: 0,
    ...over,
  };
}

describe('localDay', () => {
  it('names the local calendar day', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05');
    expect(localDay(new Date(2026, 11, 31, 0, 0).getTime())).toBe('2026-12-31');
  });
});

describe('sightingDelta (#249, ADR-0026)', () => {
  it('counts a post seen for the first time as observed, and adds nothing received', () => {
    const next = item({ likes: 40, replies: 3, views: 900 });
    expect(sightingDelta(undefined, next, NOON)).toEqual({ ...NO_DELTA, observedPosts: 1, postsWithLikes: 1 });
    // Known only from the archive until now: still a first sighting.
    expect(sightingDelta(item({ seenAt: 0, likes: 1 }), next, NOON)).toEqual({
      ...NO_DELTA,
      observedPosts: 1,
      postsWithLikes: 1,
    });
  });

  it('adds the rise in each count since the last sighting, and only rises', () => {
    const prev = item({ likes: 5, replies: 2, reposts: 1, quotes: 0, views: 100, seenAt: NOON - 60_000 });
    const next = item({ likes: 8, replies: 1, reposts: 3, quotes: 1, views: 160 });
    expect(sightingDelta(prev, next, NOON)).toEqual({
      ...NO_DELTA,
      receivedLikes: 3,
      receivedReposts: 2,
      receivedQuotes: 1,
      receivedViews: 60,
    });
  });

  it('counts a post once per day as observed, and again on the next day', () => {
    const prev = item({ likes: 5, seenAt: NOON - 60_000 });
    expect(sightingDelta(prev, item({ likes: 5 }), NOON).observedPosts).toBe(0);
    expect(sightingDelta(prev, item({ likes: 6, seenAt: NEXT_NOON }), NEXT_NOON)).toEqual({
      ...NO_DELTA,
      receivedLikes: 1,
      observedPosts: 1,
      postsWithLikes: 1,
    });
  });

  it('counts a post as liked the moment its first like shows, once', () => {
    const unliked = item({ likes: 0, seenAt: NOON - 60_000 });
    expect(sightingDelta(unliked, item({ likes: 1 }), NOON).postsWithLikes).toBe(1);
    expect(sightingDelta(item({ likes: 1, seenAt: NOON - 60_000 }), item({ likes: 2 }), NOON).postsWithLikes).toBe(0);
    const reply = item({ kind: 'reply', likes: 0, seenAt: NOON - 60_000 });
    expect(sightingDelta(reply, item({ kind: 'reply', likes: 4 }), NOON)).toMatchObject({
      repliesWithLikes: 1,
      postsWithLikes: 0,
    });
  });

  it('adds nothing for someone else’s post, or a sighting older than the last one', () => {
    for (const kind of ['repost', 'like'] as const) {
      expect(sightingDelta(undefined, item({ kind, likes: 9 }), NOON)).toEqual(NO_DELTA);
    }
    expect(sightingDelta(item({ likes: 1, seenAt: NOON }), item({ likes: 9 }), NOON - 1)).toEqual(NO_DELTA);
  });

  it('adds nothing for views X didn’t show on either side', () => {
    const prev = item({ likes: 1, seenAt: NOON - 60_000 });
    expect(sightingDelta(prev, item({ likes: 1, views: 500 }), NOON).receivedViews).toBe(0);
  });
});

describe('summing and the profile', () => {
  it('sums deltas and adds them to a day', () => {
    const one = { ...NO_DELTA, receivedLikes: 2, observedPosts: 1 };
    const sum = sumDeltas([one, one, NO_DELTA]);
    expect(sum).toEqual({ ...NO_DELTA, receivedLikes: 4, observedPosts: 2 });
    const row = addDelta(emptyDay(ME, '2026-11-18', 1), sum, 5);
    expect(row).toMatchObject({ receivedLikes: 4, observedPosts: 2, updatedAt: 5 });
  });

  it('keeps the profile’s last counts of the day, and an earlier one X left out', () => {
    const first = withProfile(
      emptyDay(ME, '2026-11-18', 1),
      { followers: 10, following: 20, postsCount: 300, likesCount: 40 },
      2,
    );
    const later = withProfile(first, { followers: 12, following: null, postsCount: 301, likesCount: null }, 3);
    expect(later).toMatchObject({ followers: 12, following: 20, postsTotal: 301, likesTotal: 40, updatedAt: 3 });
  });
});

describe('withPublishedAndRemoved', () => {
  it('adds what was published and removed per day, oldest first, and leaves days with nothing out', () => {
    const stored = [{ ...emptyDay(ME, localDay(NEXT_NOON), 1), followers: 7 }];
    const rows = withPublishedAndRemoved(
      ME,
      stored,
      [
        { kind: 'post', createdAt: NOON },
        { kind: 'post', createdAt: NOON, quote: true },
        { kind: 'reply', createdAt: NOON },
        { kind: 'repost', createdAt: NEXT_NOON },
      ],
      [
        { kind: 'post', at: NEXT_NOON },
        { kind: 'reply', at: NEXT_NOON },
        { kind: 'repost', at: NEXT_NOON },
        { kind: 'like', at: NEXT_NOON },
      ],
      9,
    );
    expect(rows.map((r) => r.day)).toEqual([localDay(NOON), localDay(NEXT_NOON)]);
    expect(rows[0]).toMatchObject({ postedPosts: 1, postedQuotes: 1, postedReplies: 1, followers: null });
    expect(rows[1]).toMatchObject({
      followers: 7,
      postedReposts: 1,
      removedPosts: 1,
      removedReplies: 1,
      removedReposts: 1,
      removedLikes: 1,
    });
  });
});

describe('the store (#249)', () => {
  beforeEach(resetDb);

  it('records nothing for a day without an X page', async () => {
    expect(await db.daily.count()).toBe(0);
    expect(await dailyRows(ME, NOON - DAY_MS, NOON + DAY_MS)).toEqual([]);
  });

  it('adds live sightings to the day: first sighting observed, a later one its rise', async () => {
    await upsertItems(ME, [draft({ likes: 3, views: 100 })], 'scan', NOON);
    await upsertItems(ME, [draft({ likes: 5, views: 130, quotes: 1, bookmarks: 2 })], 'scan', NOON + 60_000);

    const row = await db.daily.get([ME, localDay(NOON)]);
    expect(row).toMatchObject({ observedPosts: 1, receivedLikes: 2, receivedViews: 30, postsWithLikes: 1 });
    expect(await db.items.get(itemKey(ME, 'post', '1'))).toMatchObject({ quotes: 1, bookmarks: 2, views: 130 });
  });

  it('adds nothing for an archive import or a like', async () => {
    await upsertItems(ME, [draft({ likes: 30 })], 'archive', NOON);
    await upsertItems(ME, [draft({ kind: 'like', id: '9', targetId: '9', likes: 30 })], 'scan', NOON);
    expect(await db.daily.count()).toBe(0);
  });

  it('keeps the day’s profile counts, and reads them back with what was published and removed', async () => {
    await upsertAccount(account());
    await recordProfileDay(ME, { followers: 10, following: 20, postsCount: 300, likesCount: 40 }, NOON);
    await recordProfileDay(ME, { followers: 11, following: 20, postsCount: 301, likesCount: 40 }, NOON + 1000);
    await upsertItems(ME, [draft({ createdAt: NOON - 1000 })], 'scan', NOON);
    await upsertItems(ME, [draft({ kind: 'reply', id: '2', targetId: '2', createdAt: NOON - 2000 })], 'scan', NOON);
    const log = { accountId: ME, jobId: 'j', level: 'success' as const, outcome: 'done' as const, message: '' };
    await addLog({ ...log, action: 'delete', targetId: '2' });
    await addLog({ ...log, action: 'unlike', targetId: '7' });
    await addLog({ ...log, action: 'delete', targetId: '3', outcome: 'failed' });

    const rows = await dailyRows(ME, NOON - DAY_MS, Date.now() + DAY_MS);
    const today = rows.find((r) => r.day === localDay(NOON));
    expect(today).toMatchObject({ followers: 11, postsTotal: 301, postedPosts: 1, postedReplies: 1 });
    const removed = rows.reduce((sum, r) => sum + r.removedReplies + r.removedLikes + r.removedPosts, 0);
    expect(removed).toBe(2);
    expect(rows.reduce((sum, r) => sum + r.removedReplies, 0)).toBe(1);
  });

  it('removes an account’s days with its data, and only its own', async () => {
    await upsertAccount(account());
    await recordProfileDay(ME, { followers: 1, following: 1, postsCount: 1, likesCount: 1 }, NOON);
    await recordProfileDay('other', { followers: 1, following: 1, postsCount: 1, likesCount: 1 }, NOON);
    await forgetAccount(ME);
    expect((await db.daily.toArray()).map((r) => r.accountId)).toEqual(['other']);
  });
});
