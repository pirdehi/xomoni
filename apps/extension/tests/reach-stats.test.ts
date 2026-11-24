import { REACH_VERDICTS } from '@xomoni/bridge';
import { describe, expect, it } from 'vitest';
import {
  BASELINE_DAYS,
  DEFAULT_SEED,
  MIN_GROUP,
  NO_DIFFERENCE_BAND,
  REACH_FORMATS,
  RESAMPLES,
  type ReachSample,
  YOUNG_POST_DAYS,
  baseline,
  compareGroups,
  formatOf,
  isSettled,
  median,
  quantiles,
  resampledMedian,
  seededRandom,
  verdictOf,
  vsBaseline,
} from '../src/shared/vault/reach-stats';

const DAY = 86_400_000;
const START = Date.UTC(2026, 0, 1);

/** `n` values spread evenly around `center`, from 0.5× to 1.5× of it, in a shuffled order. */
function spread(center: number, n: number, seed = 1): number[] {
  const random = seededRandom(seed);
  const values = Array.from({ length: n }, (_, i) => Math.round(center * (0.5 + i / Math.max(n - 1, 1))));
  return values.sort(() => random() - 0.5);
}

/** A settled post of `format` made on day `day` with `impressions`. */
function sample(id: string, day: number, impressions: number | null, over: Partial<ReachSample> = {}): ReachSample {
  return { id, createdAt: START + day * DAY, impressions, format: 'text', ageAtAsOfDays: 30, ...over };
}

describe('the statistics of reach (#429, ADR-0045)', () => {
  describe('the ADR’s numbers', () => {
    it('are the ones the ADR names', () => {
      expect([YOUNG_POST_DAYS, MIN_GROUP, RESAMPLES, BASELINE_DAYS]).toEqual([7, 15, 2_000, 56]);
      expect(NO_DIFFERENCE_BAND).toEqual([0.8, 1.25]);
    });
  });

  describe('median and quantiles', () => {
    it('take the middle, or the mean of the two middles', () => {
      expect(median([3, 1, 2])).toBe(2);
      expect(median([4, 1, 3, 2])).toBe(2.5);
      expect(median([7])).toBe(7);
    });

    it('say nothing for no values, and leave out what isn’t a finite number', () => {
      expect(median([])).toBeNull();
      expect(median([Number.NaN, Number.POSITIVE_INFINITY])).toBeNull();
      expect(median([1, Number.NaN, 3])).toBe(2);
      expect(quantiles([], [0.5])).toEqual([null]);
    });

    it('interpolate between ranks, and refuse a quantile outside 0 to 1', () => {
      expect(quantiles([10, 20, 30, 40, 50], [0, 0.25, 0.5, 0.9, 1])).toEqual([10, 20, 30, 46, 50]);
      expect(quantiles([5], [0, 0.5, 1])).toEqual([5, 5, 5]);
      expect(quantiles([1, 2], [-0.1, 1.1, Number.NaN])).toEqual([null, null, null]);
    });

    it('are not moved by one viral post, as a mean would be', () => {
      const usual = spread(100, 29);
      expect(median([...usual, 1_000_000])).toBeLessThan(120);
    });
  });

  describe('a resample’s median', () => {
    /** Whole-number binomial coefficient. */
    const choose = (n: number, k: number) => {
      let c = 1;
      for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
      return c;
    };

    it('has the bootstrap’s own distribution for an odd count', () => {
      const sorted = Float64Array.from([10, 20, 30, 40, 50]);
      const random = seededRandom(7);
      const draws = 40_000;
      const seen = new Map<number, number>();
      for (let i = 0; i < draws; i++) {
        const m = resampledMedian(sorted, random);
        seen.set(m, (seen.get(m) ?? 0) + 1);
      }
      // P(median ≤ the j-th value) = P(at least 3 of 5 draws among the first j + 1 values).
      let below = 0;
      for (let j = 0; j < 5; j++) {
        below += (seen.get(sorted[j]!) ?? 0) / draws;
        const p = (j + 1) / 5;
        let exact = 0;
        for (let i = 3; i <= 5; i++) exact += choose(5, i) * p ** i * (1 - p) ** (5 - i);
        expect(below).toBeCloseTo(exact, 1);
      }
      expect([...seen.keys()].every((m) => sorted.includes(m))).toBe(true);
    });

    it('has the bootstrap’s own mean for an even count, by every resample counted', () => {
      const sorted = Float64Array.from([1, 2, 4, 8]);
      let exact = 0;
      for (let code = 0; code < 256; code++) {
        const picks = [0, 1, 2, 3].map((d) => sorted[(code >> (2 * d)) & 3]!).sort((x, y) => x - y);
        exact += (picks[1]! + picks[2]!) / 2 / 256;
      }
      const random = seededRandom(9);
      let sum = 0;
      for (let i = 0; i < 40_000; i++) sum += resampledMedian(sorted, random);
      expect(sum / 40_000).toBeCloseTo(exact, 1);
    });

    it('is the only value there is for a single post', () => {
      expect(resampledMedian(Float64Array.from([42]), seededRandom(1))).toBe(42);
    });
  });

  describe('the seeded generator', () => {
    it('gives the same numbers for the same seed, and others for another', () => {
      const [a, b, c] = [seededRandom(42), seededRandom(42), seededRandom(43)];
      const first = Array.from({ length: 5 }, () => a());
      expect(Array.from({ length: 5 }, () => b())).toEqual(first);
      expect(Array.from({ length: 5 }, () => c())).not.toEqual(first);
      for (const n of first) expect(n >= 0 && n < 1).toBe(true);
    });
  });

  describe('comparing two groups', () => {
    it('finds a clear difference it was built with: links at half the reach', () => {
      const links = spread(50, 40, 2);
      const others = spread(100, 60, 3);
      const result = compareGroups(links, others);
      expect(result.verdict).toBe('clear-lower');
      expect(result.a).toEqual({ n: 40, median: median(links) });
      expect(result.b).toEqual({ n: 60, median: median(others) });
      expect(result.ratio).toBeCloseTo(0.5, 1);
      const [low, high] = result.interval!;
      expect(low).toBeLessThan(result.ratio!);
      expect(high).toBeGreaterThan(result.ratio!);
      expect(high).toBeLessThan(1);
      expect(compareGroups(others, links).verdict).toBe('clear-higher');
    });

    it('says no difference for two groups alike, and maybe for small, noisy ones', () => {
      expect(compareGroups(spread(100, 200, 4), spread(100, 200, 5)).verdict).toBe('no-difference');
      const noisy = compareGroups(spread(100, 15, 6), spread(115, 15, 7));
      expect(noisy.verdict).toBe('maybe');
      expect(noisy.interval![0]).toBeLessThan(1);
      expect(noisy.interval![1]).toBeGreaterThan(1);
    });

    it('gives the same answer every time with the same seed, and may move a little with another', () => {
      const [a, b] = [spread(80, 30, 8), spread(100, 30, 9)];
      expect(compareGroups(a, b)).toEqual(compareGroups(a, b));
      expect(compareGroups(a, b, { seed: DEFAULT_SEED })).toEqual(compareGroups(a, b));
      const other = compareGroups(a, b, { seed: 7 });
      expect(other.ratio).toBe(compareGroups(a, b).ratio);
      expect(other.interval).not.toEqual(compareGroups(a, b).interval);
    });

    it('says only “not enough data” for a group of 14, and compares at 15', () => {
      const fourteen = compareGroups(spread(50, 14), spread(100, 100));
      expect(fourteen).toEqual({
        verdict: 'not-enough-data',
        a: { n: 14, median: null },
        b: { n: 100, median: null },
        ratio: null,
        interval: null,
      });
      expect(compareGroups(spread(50, 15), spread(100, 100)).verdict).not.toBe('not-enough-data');
      expect(compareGroups(spread(50, 100), spread(100, 14)).verdict).toBe('not-enough-data');
    });

    it('says not enough data for an empty group, and counts only finite values', () => {
      expect(compareGroups([], spread(100, 50)).verdict).toBe('not-enough-data');
      const withJunk = [...spread(100, 14), Number.NaN, Number.POSITIVE_INFINITY];
      expect(compareGroups(withJunk, spread(100, 50)).a.n).toBe(14);
    });

    it('copes with zeros: a group of zeros against one with views', () => {
      const zeros = Array.from({ length: 20 }, () => 0);
      const result = compareGroups(zeros, spread(100, 20));
      expect(result.verdict).toBe('clear-lower');
      expect(result.ratio).toBe(0);
      expect(compareGroups(spread(100, 20), zeros)).toMatchObject({
        verdict: 'clear-higher',
        ratio: Number.POSITIVE_INFINITY,
      });
      expect(compareGroups(zeros, zeros)).toMatchObject({ verdict: 'no-difference', ratio: 1, interval: [1, 1] });
    });

    it('keeps a long tail from deciding: one huge post doesn’t make a group higher', () => {
      const tail = [...spread(100, 39, 10), 5_000_000];
      expect(compareGroups(tail, spread(100, 40, 11)).verdict).not.toBe('clear-higher');
    });

    it('takes its numbers as options', () => {
      const result = compareGroups(spread(50, 5), spread(100, 5), { minN: 5, resamples: 200, confidence: 0.5 });
      expect(result.verdict).not.toBe('not-enough-data');
      expect(result.interval).not.toBeNull();
    });

    // P5.4.3's budget: every comparison of 50,000 posts with 2,000 resamples within 500 ms, on a loaded machine with
    // coverage on too. A resample's median is drawn from its order statistic, so its cost doesn't grow with the posts.
    it('compares 50,000 posts within 500 ms', () => {
      const [a, b] = [spread(80, 25_000, 12), spread(100, 25_000, 13)];
      const started = performance.now();
      const result = compareGroups(a, b);
      expect(performance.now() - started).toBeLessThan(500);
      expect(result.verdict).toBe('clear-lower');
    });

    it('only ever says one of the five verdicts', () => {
      for (const interval of [
        [0.2, 0.9],
        [1.1, 3],
        [0.85, 1.2],
        [0.5, 1.5],
        [0.79, 1.01],
      ] as const) {
        expect(REACH_VERDICTS).toContain(verdictOf(interval));
      }
      expect(verdictOf([0.8, 1.25])).toBe('no-difference');
      expect(verdictOf([0.79, 1.25])).toBe('maybe');
      expect(verdictOf([1, 1.3])).toBe('maybe');
    });
  });

  describe('a post’s format', () => {
    it('is a reply, a link, media or text, and unknown without its counts', () => {
      expect(formatOf({ kind: 'reply' })).toBe('reply');
      expect(formatOf({ kind: 'post', links: 1, media: 2 })).toBe('link');
      expect(formatOf({ kind: 'post', links: 0, media: 1 })).toBe('media');
      expect(formatOf({ kind: 'post', links: 0, media: 0 })).toBe('text');
      expect(formatOf({ kind: 'post', links: 0 })).toBe('unknown');
      expect(formatOf({ kind: 'post', links: null, media: 0 })).toBe('unknown');
      expect(REACH_FORMATS).toEqual(['text', 'link', 'media', 'reply']);
    });
  });

  describe('settled posts', () => {
    it('are those with a number, read at least 7 days after they were made', () => {
      expect(isSettled(sample('1', 0, 10, { ageAtAsOfDays: 7 }))).toBe(true);
      expect(isSettled(sample('1', 0, 10, { ageAtAsOfDays: 6.9 }))).toBe(false);
      expect(isSettled(sample('1', 0, null))).toBe(false);
      expect(isSettled(sample('1', 0, 10, { ageAtAsOfDays: null }))).toBe(false);
      expect(isSettled(sample('1', 0, -1))).toBe(false);
      expect(isSettled(sample('1', 0, Number.NaN))).toBe(false);
    });
  });

  describe('each post’s baseline', () => {
    /** One text post a day from day 0, each with 100 impressions, and the posts in `extra`. */
    const daily = (days: number, extra: ReachSample[] = []) => [
      ...Array.from({ length: days }, (_, d) => sample(`t${d}`, d, 100 + (d % 3))),
      ...extra,
    ];

    it('is the median of the 15 or more settled posts of the same format in the 8 weeks before', () => {
      const posts = daily(80);
      const base = baseline(posts);
      expect(base.get('t14')).toBeNull(); // 14 posts before it
      expect(base.get('t15')).toBe(101);
      // Day 79 looks back to day 23: older posts have left the window.
      expect(base.get('t79')).toBe(median(posts.slice(23, 79).map((p) => p.impressions!)));
    });

    it('leaves out other formats, young posts and posts without a number', () => {
      const posts = daily(30, [
        sample('l', 29.5, 5, { format: 'link' }),
        ...Array.from({ length: 20 }, (_, i) => sample(`m${i}`, i, 999_999, { format: 'media' })),
        ...Array.from({ length: 20 }, (_, i) => sample(`y${i}`, i, 0, { ageAtAsOfDays: 2 })),
        ...Array.from({ length: 20 }, (_, i) => sample(`n${i}`, i, null)),
      ]);
      const base = baseline(posts);
      expect(base.get('t29')).toBeGreaterThanOrEqual(100);
      expect(base.get('t29')).toBeLessThanOrEqual(102);
      expect(base.get('l')).toBeNull(); // the only link post
      expect(base.get('m19')).toBe(999_999);
      // A young post still gets a baseline from what came before it.
      expect(base.get('y19')).not.toBeNull();
    });

    it('mixes formats when told to, and gives an unknown format none', () => {
      const posts = [
        ...Array.from({ length: 10 }, (_, i) => sample(`a${i}`, i, 100)),
        ...Array.from({ length: 10 }, (_, i) => sample(`b${i}`, i + 0.5, 300, { format: 'link' })),
        sample('u', 20, 50, { format: 'unknown' }),
      ];
      expect(baseline(posts).get('a9')).toBeNull();
      expect(baseline(posts).get('u')).toBeNull();
      expect(baseline(posts, { byFormat: false }).get('u')).toBe(200);
      expect(baseline(posts, { minN: 3, windowDays: 3 }).get('a9')).toBe(100);
      expect(baseline(posts, { minN: 3, windowDays: 2 }).get('a9')).toBeNull();
    });

    it('is the same whatever order the posts come in, and gives every post an entry', () => {
      const posts = daily(40);
      const shuffled = [...posts].reverse();
      expect(baseline(shuffled)).toEqual(baseline(posts));
      expect(baseline(posts).size).toBe(40);
      expect(baseline([]).size).toBe(0);
    });

    it('handles posts made at the same moment: none counts in another’s baseline', () => {
      const same = Array.from({ length: 20 }, (_, i) => sample(`s${i}`, 0, 100 + i));
      expect([...baseline(same).values()].every((v) => v === null)).toBe(true);
    });

    it('drops a repeated value once when it leaves the window', () => {
      const posts = [
        ...Array.from({ length: 3 }, (_, i) => sample(`old${i}`, i * 0.1, 7)),
        ...Array.from({ length: 3 }, (_, i) => sample(`new${i}`, 10 + i * 0.1, 9)),
        sample('last', 11, 1),
      ];
      expect(baseline(posts, { minN: 1, windowDays: 5 }).get('last')).toBe(9);
      expect(baseline(posts, { minN: 1, windowDays: 30 }).get('last')).toBe(8);
    });
  });

  describe('a post against its baseline', () => {
    it('is the ratio, or nothing without a number or a baseline above 0', () => {
      expect(vsBaseline({ impressions: 50 }, 100)).toBe(0.5);
      expect(vsBaseline({ impressions: 0 }, 100)).toBe(0);
      expect(vsBaseline({ impressions: null }, 100)).toBeNull();
      expect(vsBaseline({ impressions: 50 }, null)).toBeNull();
      expect(vsBaseline({ impressions: 50 }, undefined)).toBeNull();
      expect(vsBaseline({ impressions: 50 }, 0)).toBeNull();
    });
  });
});
