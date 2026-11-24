import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDay, localDay } from '../src/shared/daily';
import { db, itemKey, upsertAccount } from '../src/shared/db';
import type { Item } from '../src/shared/types';
import { analyticsPostKey } from '../src/shared/vault/records';
import {
  type AnalyticsNumbers,
  NO_REACH_SOURCES,
  type PremiumEvent,
  type ReachSources,
  VAULT_REACH_SOURCES,
  dailyReachSeries,
  followersAt,
  hourAndWeekday,
  premiumAt,
  premiumPeriods,
  reachPost,
  reachPosts,
} from '../src/shared/vault/reach';
import { type ReachSample, baseline, isSettled } from '../src/shared/vault/reach-stats';
import { ME, account, resetDb } from './support/fixtures';

const DAY = 86_400_000;
const T = Date.UTC(2026, 9, 1, 12); // Thursday 1 October 2026, 12:00 UTC

function item(id: string, over: Partial<Item> = {}): Item {
  const kind = over.kind ?? 'post';
  return {
    key: itemKey(ME, kind, id),
    accountId: ME,
    kind,
    id,
    targetId: id,
    createdAt: T,
    likedAt: null,
    text: 'hello',
    author: 'me',
    inReplyToId: null,
    selfReply: false,
    likes: 3,
    reposts: 1,
    replies: 2,
    sources: ['scan'],
    status: 'present',
    seenAt: T + 10 * DAY,
    statusAt: T,
    lastJobId: null,
    ...over,
  };
}

const csv = (impressions: number, asOf = T + 20 * DAY, engagements?: number): AnalyticsNumbers => ({
  impressions,
  asOf,
  ...(engagements !== undefined && { engagements }),
});

const context = { periods: [], days: [] };

describe('each post’s reach (#428, ADR-0045)', () => {
  describe('the source', () => {
    it('takes the CSV’s number, with its “as of” date, over the views last seen live', () => {
      const post = reachPost(item('1', { views: 900, quotes: 1, bookmarks: 1 }), {
        ...context,
        analytics: csv(1_000, T + 20 * DAY, 50),
      });
      expect(post).toMatchObject({ source: 'csv', impressions: 1_000, asOf: T + 20 * DAY, engagements: 50 });
      expect(post.rate).toBe(0.05);
      expect(post.ageAtAsOfDays).toBe(20);
    });

    it('takes the views last seen live, “as last seen”, without a CSV', () => {
      const post = reachPost(item('1', { views: 900, quotes: 1, bookmarks: 2 }), context);
      expect(post).toMatchObject({ source: 'live', impressions: 900, asOf: T + 10 * DAY, ageAtAsOfDays: 10 });
      // Live engagements: likes, reposts, replies, quotes and bookmarks.
      expect(post.engagements).toBe(9);
      expect(post.rate).toBe(0.01);
    });

    it('has no source, and no number, without either; and stays out of comparisons', () => {
      const post = reachPost(item('1'), context);
      expect(post).toMatchObject({
        source: null,
        impressions: null,
        asOf: null,
        engagements: null,
        rate: null,
        ageAtAsOfDays: null,
      });
      expect(isSettled(post)).toBe(false);
      // Views from an archive-only row (never seen live) aren't a live number.
      expect(reachPost(item('2', { views: 5, seenAt: 0 }), context).source).toBeNull();
    });

    it('says nothing of a rate with 0 impressions, or a CSV without engagements', () => {
      expect(reachPost(item('1', { views: 0 }), context).rate).toBeNull();
      const post = reachPost(item('1'), { ...context, analytics: csv(100) });
      expect(post).toMatchObject({ engagements: null, rate: null, impressions: 100 });
    });
  });

  describe('the post’s age when its number was read', () => {
    it('is the days from its making to the “as of” date, never below 0', () => {
      expect(reachPost(item('1'), { ...context, analytics: csv(10, T + 3.5 * DAY) }).ageAtAsOfDays).toBe(3.5);
      expect(reachPost(item('1'), { ...context, analytics: csv(10, T - DAY) }).ageAtAsOfDays).toBe(0);
    });

    it('decides whether the post is settled: 7 days or more', () => {
      expect(isSettled(reachPost(item('1'), { ...context, analytics: csv(10, T + 6 * DAY) }))).toBe(false);
      expect(isSettled(reachPost(item('1'), { ...context, analytics: csv(10, T + 7 * DAY) }))).toBe(true);
    });
  });

  describe('what the post is', () => {
    it('carries its kind, format, links, media and whether it quotes', () => {
      expect(reachPost(item('1', { links: 1, media: 0, quote: true }), context)).toMatchObject({
        kind: 'post',
        format: 'link',
        links: 1,
        media: 0,
        quote: true,
      });
      expect(reachPost(item('2', { kind: 'reply' }), context)).toMatchObject({
        kind: 'reply',
        format: 'reply',
        links: null,
        media: null,
        quote: null,
      });
      expect(reachPost(item('3', { links: 0, media: 2 }), context).format).toBe('media');
      expect(reachPost(item('4'), context).format).toBe('unknown');
    });

    it('says whether it is still on X', () => {
      expect(reachPost(item('1'), context).onX).toBe(true);
      expect(reachPost(item('1', { status: 'deleted' }), context).onX).toBe(false);
    });

    it('fits the statistics: a post is a ReachSample', () => {
      const posts = Array.from({ length: 16 }, (_, i) =>
        reachPost(item(String(i), { createdAt: T + i * DAY, views: 100, links: 0, media: 0 }), {
          ...context,
          analytics: csv(100, T + 60 * DAY),
        }),
      );
      const samples: ReachSample[] = posts;
      expect(baseline(samples).get('15')).toBe(100);
    });
  });

  describe('the hour and the day it was posted', () => {
    it('in a time zone given by name', () => {
      // 12:00 UTC is 15:30 in Tehran, 08:00 in New York, and 01:00 the next day in Auckland.
      expect(hourAndWeekday(T, 'UTC')).toEqual({ hour: 12, weekday: 4 });
      expect(hourAndWeekday(T, 'Asia/Tehran')).toEqual({ hour: 15, weekday: 4 });
      expect(hourAndWeekday(T, 'America/New_York')).toEqual({ hour: 8, weekday: 4 });
      expect(hourAndWeekday(T, 'Pacific/Auckland')).toEqual({ hour: 1, weekday: 5 });
      expect(hourAndWeekday(Date.UTC(2026, 9, 4, 0, 30), 'UTC')).toEqual({ hour: 0, weekday: 0 });
    });

    it('in the computer’s own time zone when none is given', () => {
      const d = new Date(T);
      expect(hourAndWeekday(T)).toEqual({ hour: d.getHours(), weekday: d.getDay() });
      expect(reachPost(item('1'), { ...context, timeZone: 'Asia/Tehran' })).toMatchObject({ hour: 15, weekday: 4 });
    });
  });

  describe('Premium', () => {
    const on = (at: number): PremiumEvent => ({ kind: 'premium_on', at });
    const off = (at: number): PremiumEvent => ({ kind: 'premium_off', at });

    it('is an open span from a change on, still running', () => {
      const periods = premiumPeriods([on(T)], null);
      expect(periods).toEqual([{ from: T, to: null }]);
      expect(premiumAt(periods, T - 1)).toBe(false);
      expect(premiumAt(periods, T)).toBe(true);
      expect(premiumAt(periods, T + 100 * DAY)).toBe(true);
    });

    it('is a closed span from a change on to a change off, in any order given', () => {
      const periods = premiumPeriods([off(T + 10 * DAY), on(T)], account());
      expect(periods).toEqual([{ from: T, to: T + 10 * DAY }]);
      expect(premiumAt(periods, T + 5 * DAY)).toBe(true);
      expect(premiumAt(periods, T + 10 * DAY)).toBe(false);
    });

    it('is several spans when Premium came and went more than once, and a repeated change adds nothing', () => {
      const periods = premiumPeriods(
        [on(T), on(T + DAY), off(T + 10 * DAY), off(T + 11 * DAY), on(T + 20 * DAY)],
        null,
      );
      expect(periods).toEqual([
        { from: T, to: T + 10 * DAY },
        { from: T + 20 * DAY, to: null },
      ]);
      expect(premiumAt(periods, T + 15 * DAY)).toBe(false);
      expect(premiumAt(periods, T + 25 * DAY)).toBe(true);
    });

    it('began before Xomoni knew when the first change is off: unknown inside it', () => {
      const periods = premiumPeriods([off(T)], null);
      expect(periods).toEqual([{ from: null, to: T }]);
      expect(premiumAt(periods, T - DAY)).toBeNull();
      expect(premiumAt(periods, T + DAY)).toBe(false);
    });

    it('without any change, follows what X shows now: Premium since an unknown time, or unknown', () => {
      const premium = premiumPeriods([], account({ verified: true }));
      expect(premium).toEqual([{ from: null, to: null }]);
      expect(premiumAt(premium, T)).toBeNull();
      for (const verified of [false, null, undefined]) {
        const periods = premiumPeriods([], account({ verified }));
        expect(periods).toEqual([]);
        expect(premiumAt(periods, T)).toBeNull();
      }
      expect(premiumPeriods([], null)).toEqual([]);
    });

    it('is on each post', () => {
      const periods = premiumPeriods([on(T)], null);
      expect(reachPost(item('1', { createdAt: T - DAY }), { ...context, periods }).premium).toBe(false);
      expect(reachPost(item('2', { createdAt: T + DAY }), { ...context, periods }).premium).toBe(true);
    });
  });

  describe('followers when it was posted', () => {
    const row = (day: number, followers: number | null) => ({ day: localDay(T + day * DAY), followers });

    it('come from the closest day with the profile’s counts, the earlier on a tie', () => {
      const days = [row(-3, 100), row(-1, null), row(2, 120), row(3, 130)];
      expect(followersAt(days, T)).toBe(120);
      expect(followersAt([row(-2, 90), row(2, 110)], T)).toBe(90);
      expect(followersAt([row(0, 95), row(1, 96)], T)).toBe(95);
    });

    it('are unknown for an account without daily numbers', () => {
      expect(followersAt([], T)).toBeNull();
      expect(followersAt([row(0, null)], T)).toBeNull();
      expect(reachPost(item('1'), context).followersAtTime).toBeNull();
    });
  });

  describe('from the store', () => {
    beforeEach(resetDb);

    it('reads the account’s own posts and replies in the range, oldest first, with each source', async () => {
      await upsertAccount(account({ verified: true }));
      await db.items.bulkPut([
        item('3', { createdAt: T + 2 * DAY, views: 300 }),
        item('1', { createdAt: T, views: 100 }),
        item('2', { kind: 'reply', createdAt: T + DAY, views: 200, status: 'deleted' }),
        item('4', { kind: 'repost', createdAt: T + DAY, views: 999 }),
        item('5', { kind: 'like', createdAt: T + DAY }),
        item('6', { createdAt: T + 40 * DAY, views: 1 }),
        { ...item('7', { createdAt: T + DAY, views: 7 }), accountId: 'someone-else', key: itemKey('x', 'post', '7') },
      ]);
      await db.daily.put({ ...emptyDay(ME, localDay(T), T), followers: 500 });
      const asked: string[][] = [];
      const sources: ReachSources = {
        analytics: (_, ids) => {
          asked.push([...ids]);
          return Promise.resolve(new Map([['3', csv(3_000)]]));
        },
        premiumEvents: () => Promise.resolve([{ kind: 'premium_on' as const, at: T + 1.5 * DAY }]),
      };
      const posts = await reachPosts(ME, { from: T, to: T + 30 * DAY, timeZone: 'UTC' }, sources);
      expect(posts.map((p) => [p.id, p.kind, p.source, p.impressions, p.onX, p.premium])).toEqual([
        ['1', 'post', 'live', 100, true, false],
        ['2', 'reply', 'live', 200, false, false],
        ['3', 'post', 'csv', 3_000, true, true],
      ]);
      expect(asked).toEqual([['1', '3', '2']]);
      expect(posts.every((p) => p.followersAtTime === 500)).toBe(true);
    });

    it('reads X’s analytics CSV and the Premium changes from the vault by default', async () => {
      await db.items.bulkPut([item('1', { views: 10 }), item('2', { views: 20, createdAt: T + 2 * DAY })]);
      await db.analyticsPosts.put({
        key: analyticsPostKey(ME, '1'),
        accountId: ME,
        postId: '1',
        createdAt: T,
        asOf: T + 30 * DAY,
        impressions: 4_000,
        engagements: 80,
      });
      // A post the CSV counts without impressions keeps its live views.
      await db.analyticsPosts.put({
        key: analyticsPostKey(ME, '2'),
        accountId: ME,
        postId: '2',
        createdAt: T,
        asOf: T,
        likes: 3,
      });
      await db.accountEvents.bulkAdd([
        { accountId: ME, kind: 'premium_on', at: T + DAY, source: 'profile', words: 'X Premium on.' },
        { accountId: ME, kind: 'note', at: T + DAY, source: 'person', words: 'A note.' },
      ]);
      const posts = await reachPosts(ME, { from: T - DAY, to: T + 3 * DAY, timeZone: 'UTC' });
      expect(posts.map((p) => [p.id, p.source, p.impressions, p.engagements, p.premium])).toEqual([
        ['1', 'csv', 4_000, 80, false],
        ['2', 'live', 20, 6, true],
      ]);
      expect(await VAULT_REACH_SOURCES.premiumEvents(ME)).toEqual([{ kind: 'premium_on', at: T + DAY }]);
      expect(await VAULT_REACH_SOURCES.analytics(ME, [])).toEqual(new Map());
    });

    it('reads without the vault: no CSV and no Premium changes', async () => {
      await db.items.put(item('1', { views: 10 }));
      const posts = await reachPosts(ME, { from: T - DAY, to: T + DAY });
      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({ source: 'live', premium: null, followersAtTime: null });
      expect(await NO_REACH_SOURCES.analytics(ME, ['1'])).toEqual(new Map());
      expect(await NO_REACH_SOURCES.premiumEvents(ME)).toEqual([]);
      expect(await reachPosts('nobody', { from: 0, to: Date.now() })).toEqual([]);
    });

    describe('for a large account', () => {
      afterEach(() => vi.restoreAllMocks());

      it('reads 200,000 posts, more than a call’s arguments can take, without running out of stack', async () => {
        // X's index answers with 200,000 posts and no replies; filling fake-indexeddb with as many would take minutes.
        const many = Array.from({ length: 200_000 }, (_, i) =>
          item(String(1_000_000 + i), { createdAt: T + i * 60_000, views: i }),
        );
        const asked: unknown[] = [];
        vi.spyOn(db.items, 'where').mockImplementation(((index: string) => {
          asked.push(index);
          return {
            between: (lower: readonly unknown[]) => ({
              toArray: () => Promise.resolve(lower[1] === 'post' ? many : []),
            }),
          };
        }) as never);

        const posts = await reachPosts(ME, { from: 0, to: T + 200 * DAY });

        expect(asked).toEqual(['[accountId+kind+createdAt]', '[accountId+kind+createdAt]']);
        expect(posts).toHaveLength(200_000);
        expect(posts[0]).toMatchObject({ id: '1000000', impressions: 0, source: 'live' });
        expect(posts.at(-1)).toMatchObject({ id: '1199999', impressions: 199_999, source: 'live' });
      });
    });
  });

  describe('the daily views, as an estimate', () => {
    beforeEach(resetDb);

    it('gives each recorded day’s views, marked as an estimate, and leaves out days without a row', async () => {
      const now = new Date(2026, 9, 10, 12).getTime();
      await db.daily.bulkPut([
        { ...emptyDay(ME, localDay(now), now), receivedViews: 40 },
        { ...emptyDay(ME, localDay(now - 2 * DAY), now), receivedViews: 20 },
        { ...emptyDay(ME, localDay(now - 9 * DAY), now), receivedViews: 999 },
        { ...emptyDay('other', localDay(now), now), receivedViews: 5 },
      ]);
      expect(await dailyReachSeries(ME, 7, now)).toEqual([
        { day: localDay(now - 2 * DAY), views: 20, estimate: true },
        { day: localDay(now), views: 40, estimate: true },
      ]);
      expect(await dailyReachSeries('nobody', 7, now)).toEqual([]);
    });
  });
});
