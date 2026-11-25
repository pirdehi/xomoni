import { usesBannedReachWord } from '@xomoni/bridge';
import { describe, expect, it } from 'vitest';
import {
  type ComparedPost,
  DAY_PARTS,
  PREMIUM_SIDE_DAYS,
  PREMIUM_TRANSITION_DAYS,
  WEEKDAYS,
  reachByTime,
  reachComparisons,
} from '../src/shared/vault/reach-compare';

const DAY = 86_400_000;
const START = Date.UTC(2026, 3, 1);

/** A settled post made `day` days after START, seen `impressions` times. */
function post(id: string, day: number, impressions: number, over: Partial<ComparedPost> = {}): ComparedPost {
  return {
    id,
    createdAt: START + day * DAY,
    kind: 'post',
    impressions,
    ageAtAsOfDays: 30,
    links: 0,
    media: 0,
    hour: 12,
    weekday: 3,
    followersAtTime: 1_000,
    ...over,
  };
}

/** `n` posts from day `from`, one a day, seen about `center` times (0.8× to 1.2×), with `over`. */
function many(prefix: string, n: number, from: number, center: number, over: Partial<ComparedPost> = {}) {
  return Array.from({ length: n }, (_, i) =>
    post(`${prefix}${String(i)}`, from + i, Math.round(center * (0.8 + (0.4 * i) / Math.max(1, n - 1))), over),
  );
}

const byId = (list: ReturnType<typeof reachComparisons>, id: string) => list.find((c) => c.id === id)!;

describe('the comparisons of reach (#429, ADR-0045)', () => {
  it('finds posts with a link clearly lower when they were built half as seen', () => {
    const posts = [...many('l', 30, 0, 500, { links: 1 }), ...many('t', 30, 0, 1_000)];
    const links = byId(reachComparisons(posts, []), 'links');
    expect(links.result.verdict).toBe('clear-lower');
    expect(links.result.a.n).toBe(30);
    expect(links.result.b.n).toBe(30);
    expect(links.result.ratio).toBeCloseTo(0.5, 1);
    expect(links.groups).toEqual(['With a link', 'Without']);
  });

  it('says not enough data below 15 posts a side, and compares at 15', () => {
    const fourteen = [...many('l', 14, 0, 500, { links: 2 }), ...many('t', 30, 0, 1_000)];
    expect(byId(reachComparisons(fourteen, []), 'links').result.verdict).toBe('not-enough-data');
    const fifteen = [...many('l', 15, 0, 500, { links: 2 }), ...many('t', 30, 0, 1_000)];
    expect(byId(reachComparisons(fifteen, []), 'links').result.verdict).not.toBe('not-enough-data');
  });

  it('compares photos or videos with text only, leaving out posts with a link', () => {
    const posts = [
      ...many('m', 20, 0, 2_000, { media: 1 }),
      ...many('t', 20, 0, 1_000),
      ...many('lm', 20, 0, 50, { links: 1, media: 1 }),
    ];
    const media = byId(reachComparisons(posts, []), 'media');
    expect(media.result).toMatchObject({ verdict: 'clear-higher', a: { n: 20 }, b: { n: 20 } });
  });

  it('leaves out replies, young posts, posts without a number, and posts whose links or media aren’t known', () => {
    const posts = [
      ...many('t', 20, 0, 1_000),
      ...many('r', 20, 0, 10, { kind: 'reply', links: 1 }),
      ...many('y', 20, 0, 10, { links: 1, ageAtAsOfDays: 3 }),
      ...many('n', 20, 0, 10, { links: 1, impressions: null }),
      ...many('u', 20, 0, 10, { links: null }),
    ];
    const links = byId(reachComparisons(posts, []), 'links');
    expect(links.result).toMatchObject({ verdict: 'not-enough-data', a: { n: 0 }, b: { n: 20 } });
  });

  describe('Premium', () => {
    const from = START + 100 * DAY;

    it('compares the 8 weeks after Premium with the 8 before, leaving out the 7 days after it started', () => {
      const posts = [
        ...many('b', 56, 100 - PREMIUM_SIDE_DAYS, 1_000),
        ...many('gap', PREMIUM_TRANSITION_DAYS, 100, 99_999),
        ...many('a', 56, 100 + PREMIUM_TRANSITION_DAYS, 2_000),
        ...many('late', 10, 100 + PREMIUM_TRANSITION_DAYS + PREMIUM_SIDE_DAYS, 99_999),
        ...many('early', 10, 100 - PREMIUM_SIDE_DAYS - 10, 1),
      ];
      const premium = byId(reachComparisons(posts, [{ from, to: null }]), 'premium');
      expect(premium.needsDate).toBeUndefined();
      expect(premium.result).toMatchObject({ verdict: 'clear-higher', a: { n: 56 }, b: { n: 56 } });
      expect(premium.result.ratio).toBeCloseTo(2, 1);
    });

    it('takes the latest start Xomoni knows, and asks for the date without one', () => {
      const posts = [...many('b', 20, 80, 1_000), ...many('a', 20, 110, 1_000)];
      const twice = reachComparisons(posts, [
        { from: START, to: START + 10 * DAY },
        { from, to: null },
      ]);
      expect(byId(twice, 'premium').result.a.n).toBe(20);
      for (const periods of [[], [{ from: null, to: null }]]) {
        const premium = byId(reachComparisons(posts, periods), 'premium');
        expect(premium.needsDate).toBe(true);
        expect(premium.result.verdict).toBe('not-enough-data');
      }
    });
  });

  it('lists what can mislead each comparison, with the followers on each side when known', () => {
    const posts = [
      ...many('l', 20, 0, 500, { links: 1, followersAtTime: 800 }),
      ...many('t', 20, 0, 1_000, { followersAtTime: 1_200 }),
    ];
    const links = byId(reachComparisons(posts, []), 'links');
    expect(links.followers).toEqual([800, 1_200]);
    expect(links.misleads).toContain(
      "Your followers: about 800 for the first group's posts and 1,200 for the second's.",
    );
    expect(links.misleads).toHaveLength(4);
    const unknown = byId(reachComparisons(many('t', 5, 0, 1, { followersAtTime: null }), []), 'links');
    expect(unknown.followers).toEqual([null, null]);
    expect(unknown.misleads).toContain("Your followers over the period: Xomoni didn't see them for every post.");
    for (const c of reachComparisons(posts, [])) {
      for (const words of [c.title, ...c.groups, ...c.misleads]) expect(usesBannedReachWord(words)).toBe(false);
    }
  });

  it('gives the same answer every time', () => {
    const posts = [...many('l', 20, 0, 500, { links: 1 }), ...many('t', 20, 0, 1_000)];
    expect(reachComparisons(posts, [])).toEqual(reachComparisons(posts, []));
  });

  describe('by day and time', () => {
    it('gives each day and time of day its count, and its median from 15 posts', () => {
      const posts = [
        ...many('w', 15, 0, 1_000, { weekday: 3, hour: 9 }),
        ...many('s', 3, 0, 50, { weekday: 0, hour: 22 }),
        ...many('r', 5, 0, 50, { kind: 'reply', weekday: 0, hour: 22 }),
      ];
      const { days, parts } = reachByTime(posts);
      expect(WEEKDAYS.map((d) => d.label)).toEqual([
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
        'Sunday',
      ]);
      expect(days[2]).toEqual({ n: 15, median: 1_000 });
      expect(days[6]).toEqual({ n: 3, median: null });
      expect(days[0]).toEqual({ n: 0, median: null });
      expect(DAY_PARTS.map((p) => p.label)).toEqual([
        'Night (0–6)',
        'Morning (6–12)',
        'Afternoon (12–18)',
        'Evening (18–24)',
      ]);
      expect(parts.map((p) => p.n)).toEqual([0, 15, 0, 3]);
    });
  });
});
