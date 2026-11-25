import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, itemKey, kvSet } from '../src/shared/db';
import type { Item, ItemKind } from '../src/shared/types';
import { dueNudges, freshnessSources, vaultReminder } from '../src/shared/vault/freshness';
import {
  UNDER_THE_HOOD_CADENCE_DAYS,
  nextMonth,
  ownPostsIn,
  underTheHoodLastAt,
  underTheHoodOutAt,
} from '../src/shared/vault/under-the-hood-freshness';
import { resetDb } from './support/fixtures';

// The monthly reminder for X's Under the hood report (#428, #429, P5.1.4 and P5.2.4, ADR-0043 decision 9, ADR-0045):
// due from the month after the newest report X made, never for a month with fewer than 10 posts in Xomoni.

const ME = { id: '9000000000000000001', handle: 'xomoni_fixture' };
const OTHER = '9000000000000000002';

/** A month of X's report for `accountId`, as an import keeps it. */
function keepMonth(month: string, accountId = ME.id) {
  return db.labelMonths.put({
    accountId,
    month,
    importedAt: Date.UTC(2026, 0, 1),
    labels: [{ name: 'SPAM_HIGH_RECALL', count: 1, scope: 'posts' }],
  });
}

/** `n` of the account's own items of `kind`, made on the 10th of `month` (UTC). */
function keepPosts(month: string, n: number, kind: ItemKind = 'post', accountId = ME.id) {
  const [year, m] = month.split('-').map(Number) as [number, number];
  const at = Date.UTC(year, m - 1, 10);
  const items: Item[] = Array.from({ length: n }, (_, i) => {
    const id = `${month.replace('-', '')}${kind}${String(i)}`;
    return {
      key: itemKey(accountId, kind, id),
      accountId,
      kind,
      id,
      targetId: id,
      createdAt: at + i * 1000,
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
      seenAt: at,
      statusAt: at,
      lastJobId: null,
    };
  });
  return db.items.bulkPut(items);
}

beforeEach(async () => {
  await resetDb();
  await kvSet('settings', { activeHours: { enabled: false, start: 8, end: 23 } });
});

describe('the months of X’s report', () => {
  it('steps a month on, across the end of a year', () => {
    expect(nextMonth('2026-10')).toBe('2026-11');
    expect(nextMonth('2026-12')).toBe('2027-01');
  });

  it('comes out on the 3rd of the month after, UTC', () => {
    expect(underTheHoodOutAt('2026-10')).toBe(Date.UTC(2026, 10, 3));
    expect(underTheHoodOutAt('2026-12')).toBe(Date.UTC(2027, 0, 3));
  });

  it('counts the account’s own posts and replies in a month, never its reposts, likes or another account’s', async () => {
    await keepPosts('2026-10', 4);
    await keepPosts('2026-10', 3, 'reply');
    await keepPosts('2026-10', 5, 'repost');
    await keepPosts('2026-10', 5, 'like');
    await keepPosts('2026-10', 9, 'post', OTHER);
    await keepPosts('2026-09', 6);
    expect(await ownPostsIn(ME.id, '2026-10')).toBe(7);
    expect(await ownPostsIn(ME.id, '2026-11')).toBe(0);
  });
});

describe('the reminder’s source', () => {
  it('is registered after the core’s, every 31 days', () => {
    expect(freshnessSources().map((s) => [s.source, s.cadenceDays])).toEqual([
      ['x-archive', 30],
      ['x-analytics-posts', 60],
      ['x-under-the-hood', UNDER_THE_HOOD_CADENCE_DAYS],
    ]);
  });

  it('has nothing to renew when no report was imported, or only another account’s', async () => {
    await keepMonth('2026-09', OTHER);
    expect(await underTheHoodLastAt(ME.id, Date.UTC(2026, 11, 20))).toBeNull();
    expect(await dueNudges(ME.id, Date.UTC(2026, 11, 20))).toEqual([]);
  });

  it('dates the newest report by the day X made it, whatever the order of the imports', async () => {
    await keepMonth('2026-10');
    await keepMonth('2026-08');
    expect(await underTheHoodLastAt(ME.id, Date.UTC(2026, 10, 20))).toBe(Date.UTC(2026, 10, 3));
  });

  it('is fresh until the next report is out, due then, and overdue a month on', async () => {
    await keepMonth('2026-09');
    await keepPosts('2026-10', 12);
    await keepPosts('2026-11', 12);
    const fresh = Date.UTC(2026, 10, 2, 23);
    expect(await dueNudges(ME.id, fresh)).toEqual([]);
    // October's report comes out on 3 November; 31 days from 3 October is 3 November.
    const due = await dueNudges(ME.id, Date.UTC(2026, 10, 3));
    expect(due.map((n) => [n.source, n.freshness, n.ageDays])).toEqual([['x-under-the-hood', 'due', 31]]);
    const overdue = await dueNudges(ME.id, Date.UTC(2026, 11, 4));
    expect(overdue.map((n) => [n.source, n.freshness])).toEqual([['x-under-the-hood', 'overdue']]);
  });

  it('never asks for a month with fewer than 10 posts in Xomoni: X makes no report for it', async () => {
    await keepMonth('2026-08');
    await keepPosts('2026-09', 9);
    await keepPosts('2026-10', 4, 'reply');
    // September and October are over, and neither has 10 posts: nothing is due until November's report.
    expect(await underTheHoodLastAt(ME.id, Date.UTC(2026, 10, 20))).toBe(Date.UTC(2026, 10, 3));
    expect(await dueNudges(ME.id, Date.UTC(2026, 10, 20))).toEqual([]);
  });

  it('asks again for the first month with 10 posts or more', async () => {
    await keepMonth('2026-08');
    await keepPosts('2026-09', 2);
    await keepPosts('2026-10', 10);
    // September is passed over; October has 10 posts, so its report is due from 3 November.
    expect(await underTheHoodLastAt(ME.id, Date.UTC(2026, 10, 20))).toBe(Date.UTC(2026, 9, 3));
    const [nudge] = await dueNudges(ME.id, Date.UTC(2026, 10, 20));
    expect(nudge).toMatchObject({ source: 'x-under-the-hood', freshness: 'due' });
  });

  it('never passes over the month still under way, however few its posts', async () => {
    await keepMonth('2026-10');
    expect(await underTheHoodLastAt(ME.id, Date.UTC(2026, 10, 30, 23))).toBe(Date.UTC(2026, 10, 3));
  });

  it('looks at most two years past the newest report', async () => {
    await keepMonth('2020-01');
    expect(await underTheHoodLastAt(ME.id, Date.UTC(2026, 10, 20))).toBe(underTheHoodOutAt('2022-01'));
  });

  it('leaves out a month damaged on the computer', async () => {
    await db.labelMonths.put({ accountId: ME.id, month: '2026-13', importedAt: 1, labels: [] });
    expect(await underTheHoodLastAt(ME.id, Date.UTC(2026, 10, 20))).toBeNull();
  });

  it('is named in the reminder’s words, with the core’s', async () => {
    await keepMonth('2026-09');
    await keepPosts('2026-10', 15);
    const reminder = await vaultReminder(ME, Date.UTC(2026, 10, 10, 12));
    expect(reminder?.message).toBe(
      'X’s Under the hood report is 38 days old. Download a new copy on X yourself, then drop it on Xomoni’s Vault page.',
    );
    expect(reminder?.nudges.map((n) => n.source)).toEqual(['x-under-the-hood']);
  });
});
