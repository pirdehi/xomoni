import { describe, expect, it } from 'vitest';
import {
  audienceFigures,
  change,
  contentFigures,
  publishedByType,
  weekdayAverages,
  daysBefore,
  daysInScope,
  firstDay,
  followersSeries,
  followingSeries,
  isoDay,
  milestones,
  netChanges,
  nextMilestone,
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

describe('audience (#253)', () => {
  const week = { account: null, period: '7d' as const };
  const series = (values: (number | null)[]) =>
    values.map((value, i) => ({ day: `2026-11-${String(14 + i).padStart(2, '0')}`, value }));

  it('draws following like followers, from the following counts', () => {
    const s = followingSeries([day('2026-11-19', { following: 300, followers: 9 })], week, NOW);
    expect(s.find((p) => p.day === '2026-11-19')?.value).toBe(300);
  });

  it('gives each day’s change since the last count, carrying a gap’s change to the day after it', () => {
    expect(netChanges(series([100, 104, null, 101, 101]))).toEqual([
      { day: '2026-11-14', value: null },
      { day: '2026-11-15', value: 4 },
      { day: '2026-11-16', value: null },
      { day: '2026-11-17', value: -3 },
      { day: '2026-11-18', value: 0 },
    ]);
  });

  it('marks each round count crossed upward, on the day it was reached, and the next one', () => {
    expect(milestones(series([980, 1003, 995, 1010, 2600]))).toEqual([
      { count: 1000, day: '2026-11-15' },
      { count: 2500, day: '2026-11-18' },
    ]);
    expect(milestones(series([1200, null, 1300]))).toEqual([]);
    expect(nextMilestone(988)).toEqual({ count: 1000, toGo: 12 });
    expect(nextMilestone(2_000_000)).toBeNull();
  });

  it('sums what was gained and lost, finds the best and worst days, and the ratio', () => {
    const days = [
      day('2026-11-15', { followers: 100, following: 50 }),
      day('2026-11-16', { followers: 108, following: 50 }),
      day('2026-11-17', { followers: 103, following: 40 }),
      day('2026-11-18', { followers: 110 }),
    ];
    const figures = audienceFigures(days, followersSeries(days, week, NOW));
    expect(figures).toEqual({
      followers: 110,
      following: 40,
      net: 10,
      gained: 15,
      lost: 5,
      bestDay: { day: '2026-11-16', value: 8 },
      worstDay: { day: '2026-11-17', value: -5 },
      ratio: 110 / 40,
    });
  });

  it('says nothing it can’t know: no change from one count, no ratio without following', () => {
    const one = [day('2026-11-18', { followers: 50 })];
    expect(audienceFigures(one, followersSeries(one, week, NOW))).toMatchObject({
      net: null,
      gained: 0,
      lost: 0,
      bestDay: null,
      worstDay: null,
      ratio: null,
    });
    const none = [day('2026-11-18', { following: 0 })];
    expect(audienceFigures(none, followersSeries(none, week, NOW)).ratio).toBeNull();
  });
});

describe('content (#254)', () => {
  const week = { account: null, period: '7d' as const };

  it('adds up each type per day over the accounts in scope, with gaps on days without numbers', () => {
    const series = publishedByType(
      [
        day('2026-11-18', { postedPosts: 1, postedReplies: 2, postedReposts: 3, postedQuotes: 4 }),
        day('2026-11-18', { xHandle: 'bob', postedPosts: 5 }),
      ],
      week,
      NOW,
    );
    expect(series.find((p) => p.day === '2026-11-18')?.values).toEqual({ posts: 6, replies: 2, reposts: 3, quotes: 4 });
    expect(series.find((p) => p.day === '2026-11-17')?.values).toBeNull();
    expect(publishedByType([], week, NOW)).toEqual([]);
  });

  it('compares each type with the period before', () => {
    const figures = contentFigures(
      [day('2026-11-18', { postedPosts: 3, postedQuotes: 1 })],
      [day('2026-11-10', { postedPosts: 1 })],
    );
    expect(figures.posts).toEqual({ value: 3, previous: 1 });
    expect(figures.quotes).toEqual({ value: 1, previous: 0 });
    expect(contentFigures([], []).replies).toEqual({ value: null, previous: null });
  });

  it('averages each weekday over the days with numbers, and names the best one', () => {
    // 2026-11-16 is a Monday.
    const { averages, best } = weekdayAverages([
      day('2026-11-16', { postedPosts: 2 }),
      day('2026-11-09', { postedPosts: 4, postedReplies: 2 }),
      day('2026-11-18', { postedReplies: 1 }),
      day('2026-11-22', { postedPosts: 0 }),
      day('2026-11-22', { xHandle: 'bob', postedPosts: 0 }),
    ]);
    expect(averages).toEqual([4, null, 1, null, null, null, 0]);
    expect(best).toBe(0);
    expect(weekdayAverages([day('2026-11-16')]).best).toBeNull();
  });
});
