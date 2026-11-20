import { describe, expect, it } from 'vitest';
import {
  change,
  daysBefore,
  daysInScope,
  firstDay,
  followersSeries,
  isoDay,
  overviewFigures,
  publishedSeries,
} from './insights';
import type { DailyNumbers } from './model';

const NOW = Date.parse('2026-11-20T12:00:00Z');

function day(d: string, over: Partial<DailyNumbers> = {}): DailyNumbers {
  return {
    xHandle: 'ada',
    day: d,
    followers: null,
    following: null,
    postsTotal: null,
    likesTotal: null,
    postedPosts: 0,
    postedReplies: 0,
    postedReposts: 0,
    postedQuotes: 0,
    receivedLikes: 0,
    receivedReplies: 0,
    receivedReposts: 0,
    receivedQuotes: 0,
    receivedViews: 0,
    observedPosts: 0,
    postsWithLikes: 0,
    repliesWithLikes: 0,
    removedPosts: 0,
    removedReplies: 0,
    removedReposts: 0,
    removedLikes: 0,
    updatedAt: `${d}T20:00:00Z`,
    ...over,
  };
}

describe('periods (#252)', () => {
  it('names days in UTC, and the first day of a period', () => {
    expect(isoDay(NOW)).toBe('2026-11-20');
    expect(firstDay('7d', NOW)).toBe('2026-11-13');
    expect(firstDay('all', NOW)).toBeNull();
  });

  it('keeps the chosen account’s days in the period, oldest first, and the period before', () => {
    const days = [
      day('2026-11-19'),
      day('2026-11-15', { xHandle: 'bob' }),
      day('2026-11-14'),
      day('2026-11-10'),
      day('2026-11-05'),
    ];
    const week = { account: 'ada', period: '7d' as const };
    expect(daysInScope(days, week, NOW).map((d) => d.day)).toEqual(['2026-11-14', '2026-11-19']);
    expect(daysInScope(days, { account: null, period: '7d' }, NOW)).toHaveLength(3);
    expect(daysBefore(days, week, NOW).map((d) => d.day)).toEqual(['2026-11-10']);
    expect(daysBefore(days, { account: 'ada', period: 'all' }, NOW)).toEqual([]);
  });
});

describe('overviewFigures', () => {
  it('sums what was published and received, and takes each account’s latest follower count', () => {
    const current = [
      day('2026-11-18', { followers: 100, postedPosts: 2, postedQuotes: 1, receivedLikes: 10, receivedViews: 500 }),
      day('2026-11-19', {
        followers: 104,
        postedReplies: 9,
        receivedReplies: 3,
        receivedReposts: 2,
        observedPosts: 40,
      }),
      day('2026-11-19', { xHandle: 'bob', followers: 50, receivedQuotes: 1 }),
    ];
    const previous = [day('2026-11-10', { followers: 98, postedPosts: 1, receivedLikes: 4, receivedViews: 100 })];
    const figures = overviewFigures(current, previous);
    expect(figures.followers).toEqual({ value: 154, previous: 98 });
    expect(figures.posts).toEqual({ value: 3, previous: 1 });
    expect(figures.likesReceived).toEqual({ value: 10, previous: 4 });
    expect(figures.repliesReceived).toEqual({ value: 3, previous: 0 });
    expect(figures.engagementRate.value).toBeCloseTo(((10 + 3 + 2 + 1) / 500) * 100);
    expect(figures.engagementRate.previous).toBeCloseTo(4);
    expect(figures.observedPosts).toBe(40);
    expect(figures.updatedAt).toBe('2026-11-19T20:00:00Z');
  });

  it('says nothing, rather than zero, where there are no numbers', () => {
    const figures = overviewFigures([], []);
    expect(figures.followers).toEqual({ value: null, previous: null });
    expect(figures.posts).toEqual({ value: null, previous: null });
    expect(figures.engagementRate).toEqual({ value: null, previous: null });
    expect(figures.updatedAt).toBeNull();
    // Numbers without a profile or views: no followers and no rate, still the sums.
    expect(overviewFigures([day('2026-11-19', { postedPosts: 1 })], []).followers.value).toBeNull();
    expect(overviewFigures([day('2026-11-19', { postedPosts: 1 })], []).engagementRate.value).toBeNull();
  });
});

describe('change', () => {
  it('gives the change and the percentage against the period before', () => {
    expect(change({ value: 110, previous: 100 })).toEqual({ change: 10, percent: 10 });
    expect(change({ value: 5, previous: 0 })).toEqual({ change: 5, percent: null });
    expect(change({ value: 5, previous: null })).toBeNull();
    expect(change({ value: null, previous: 3 })).toBeNull();
  });
});

describe('series', () => {
  const week = { account: null, period: '7d' as const };

  it('draws followers each day of the period, with gaps where a day has no count', () => {
    const series = followersSeries(
      [day('2026-11-14', { followers: 10 }), day('2026-11-16', { followers: 12 }), day('2026-11-17')],
      week,
      NOW,
    );
    expect(series[0]).toEqual({ day: '2026-11-13', value: null });
    expect(series.find((p) => p.day === '2026-11-14')?.value).toBe(10);
    expect(series.find((p) => p.day === '2026-11-15')?.value).toBeNull();
    expect(series.find((p) => p.day === '2026-11-17')?.value).toBeNull();
    expect(series.at(-1)?.day).toBe('2026-11-20');
    expect(series).toHaveLength(8);
  });

  it('counts a day for several accounts only when each of them has a count', () => {
    const series = followersSeries(
      [
        day('2026-11-18', { followers: 10 }),
        day('2026-11-18', { xHandle: 'bob', followers: 5 }),
        day('2026-11-19', { followers: 11 }),
      ],
      week,
      NOW,
    );
    expect(series.find((p) => p.day === '2026-11-18')?.value).toBe(15);
    expect(series.find((p) => p.day === '2026-11-19')?.value).toBeNull();
  });

  it('adds up what was published each day, and starts all time at the first day with numbers', () => {
    const all = { account: null, period: 'all' as const };
    const series = publishedSeries(
      [
        day('2026-11-18', { postedPosts: 1, postedReplies: 2, postedReposts: 3, postedQuotes: 4 }),
        day('2026-11-18', { xHandle: 'bob', postedPosts: 5 }),
      ],
      all,
      NOW,
    );
    expect(series.map((p) => p.day)).toEqual(['2026-11-18', '2026-11-19', '2026-11-20']);
    expect(series[0]?.value).toBe(15);
    expect(series[1]?.value).toBeNull();
    expect(publishedSeries([], all, NOW)).toEqual([]);
  });
});
