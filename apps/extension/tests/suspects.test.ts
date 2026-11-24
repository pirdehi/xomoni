import { usesBannedReachWord } from '@xomoni/bridge';
import { describe, expect, it } from 'vitest';
import type { LabelMonth } from '../src/shared/vault/under-the-hood';
import {
  GUESS_NOTICE,
  MAX_SUSPECTS,
  MEDIUM_MIN_POSTS,
  SUSPECT_BELOW,
  SUSPECT_WHY_WORDS,
  type SuspectInput,
  maxSuspects,
  suspectPosts,
} from '../src/shared/vault/suspects';

const DAY = 86_400_000;
const JUNE = Date.UTC(2026, 5, 1);
const JULY = Date.UTC(2026, 6, 1);

/** A settled text post made `day` days after `start`, seen `impressions` times. */
function post(id: string, start: number, day: number, impressions: number, over: Partial<SuspectInput> = {}) {
  return {
    id,
    createdAt: start + day * DAY,
    impressions,
    format: 'text',
    ageAtAsOfDays: 30,
    ...over,
  } satisfies SuspectInput;
}

/** 30 posts in June, each seen 1,000 times: the baseline for July's posts. */
const june = Array.from({ length: 30 }, (_, i) => post(`j${i}`, JUNE, i, 1_000));

/** July's posts: `low` of them at the given impressions, the rest at about the baseline. */
function july(low: number[], usual = 20): SuspectInput[] {
  return [
    ...low.map((impressions, i) => post(`low${i}`, JULY, i + 0.5, impressions)),
    ...Array.from({ length: usual }, (_, i) => post(`u${i}`, JULY, i + 0.25, 900 + (i % 5) * 50)),
  ];
}

const labelled = (n: number, over: Partial<LabelMonth> = {}): LabelMonth => ({
  month: '2026-07',
  labels: [{ name: 'SPAM_HIGH_RECALL', count: n, scope: 'posts' }],
  ...over,
});

describe('suspected posts, as guesses (#429, ADR-0045, point 4)', () => {
  it('has the ADR’s numbers and its notice', () => {
    expect([SUSPECT_BELOW, MAX_SUSPECTS, MEDIUM_MIN_POSTS]).toEqual([0.5, 10, 20]);
    expect(GUESS_NOTICE).toBe("This is a guess. X doesn't say which posts got a label.");
  });

  it('suggests at most min(3n, 10) candidates', () => {
    expect([0, 1, 2, 3, 4, 50].map(maxSuspects)).toEqual([0, 3, 6, 9, 10, 10]);
    const posts = [...june, ...july([100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300, 320])];
    expect(suspectPosts(posts, [labelled(1)])[0]?.candidates).toHaveLength(3);
    expect(suspectPosts(posts, [labelled(2)])[0]?.candidates).toHaveLength(6);
    expect(suspectPosts(posts, [labelled(9)])[0]?.candidates).toHaveLength(10);
  });

  it('picks the month’s posts furthest below their baseline, under half of it, lowest first', () => {
    const posts = [...june, ...july([300, 100, 499, 501])];
    const [label] = suspectPosts(posts, [labelled(2)]);
    expect(label?.candidates.map((c) => [c.id, c.impressions, c.baseline, c.ratio])).toEqual([
      ['low1', 100, 1_000, 0.1],
      ['low0', 300, 1_000, 0.3],
      ['low2', 499, 1_000, 0.499],
    ]);
    // 501 is just over half: never a candidate.
    expect(label?.candidates.map((c) => c.id)).not.toContain('low3');
  });

  it('marks every candidate as a guess, with its reasons in words, and never says high', () => {
    const [label] = suspectPosts([...june, ...july([100])], [labelled(1)]);
    const [candidate] = label?.candidates ?? [];
    expect(candidate?.guess).toBe(true);
    expect(candidate?.reasons).toEqual([
      'Seen 100 times: 10% of your usual 1,000 for text posts, the median of the 8 weeks before it.',
      'Posted in July 2026, when X says it applied SPAM_HIGH_RECALL to 1 post.',
    ]);
    expect(['low', 'medium']).toContain(label?.confidence);
    for (const reason of candidate?.reasons ?? []) expect(usesBannedReachWord(reason)).toBe(false);
    for (const words of Object.values(SUSPECT_WHY_WORDS)) expect(usesBannedReachWord(words)).toBe(false);
  });

  describe('confidence', () => {
    it('is medium when the month has 20 comparable posts and the n lowest stand apart by half', () => {
      const [label] = suspectPosts([...june, ...july([100, 200], 18)], [labelled(2)]);
      expect(label?.candidates).toHaveLength(2);
      expect(label?.confidence).toBe('medium');
    });

    it('is low with 19 comparable posts in the month, however clear', () => {
      expect(suspectPosts([...june, ...july([100, 200], 17)], [labelled(2)])[0]?.confidence).toBe('low');
    });

    it('is low when the n lowest don’t stand apart from the next', () => {
      // The second lowest is 0.3 of baseline, the third 0.4: not twice as far below.
      expect(suspectPosts([...june, ...july([100, 300, 400], 18)], [labelled(2)])[0]?.confidence).toBe('low');
      // Exactly half is enough.
      expect(suspectPosts([...june, ...july([100, 200, 400], 18)], [labelled(2)])[0]?.confidence).toBe('medium');
    });

    it('is low when X’s count is as large as the month', () => {
      expect(suspectPosts([...june, ...july([100], 19)], [labelled(20)])[0]?.confidence).toBe('low');
    });
  });

  it('gives each label of a month its own guess, newest month first', () => {
    const months: LabelMonth[] = [
      {
        month: '2026-06',
        labels: [{ name: 'OLD_LABEL', count: 1, scope: 'posts' }],
      },
      {
        month: '2026-07',
        labels: [
          { name: 'SPAM_HIGH_RECALL', count: 1, scope: 'posts' },
          { name: 'OTHER', count: 2, scope: 'unknown' },
          { name: 'NONE', count: 0, scope: 'posts' },
        ],
      },
    ];
    const result = suspectPosts([...june, ...july([100, 200, 300])], months);
    expect(result.map((r) => [r.month, r.label, r.n, r.candidates.length])).toEqual([
      ['2026-07', 'SPAM_HIGH_RECALL', 1, 3],
      ['2026-07', 'OTHER', 2, 3],
      // June's posts were all seen as usual.
      ['2026-06', 'OLD_LABEL', 1, 0],
    ]);
    expect(result[2]?.why).toBe('none-below-half');
  });

  describe('says why there is no guess', () => {
    it('for a label on the account', () => {
      const month = labelled(1, { labels: [{ name: 'ACCOUNT_LABEL', count: 1, scope: 'account' }] });
      expect(suspectPosts([...june, ...july([100])], [month])).toEqual([
        { month: '2026-07', label: 'ACCOUNT_LABEL', n: 1, candidates: [], confidence: null, why: 'account-label' },
      ]);
    });

    it('for a month without impressions or views, or without posts', () => {
      const unseen = july([100]).map((p) => ({ ...p, impressions: null, ageAtAsOfDays: null }));
      expect(suspectPosts([...june, ...unseen], [labelled(1)])[0]?.why).toBe('no-numbers');
      expect(suspectPosts(june, [labelled(1)])[0]?.why).toBe('no-numbers');
      // Young posts, read before they were 7 days old, don't count either.
      const young = july([100]).map((p) => ({ ...p, ageAtAsOfDays: 3 }));
      expect(suspectPosts([...june, ...young], [labelled(1)])[0]?.why).toBe('no-numbers');
    });

    it('for a month whose posts have too few earlier ones to compare with', () => {
      const first = Array.from({ length: 10 }, (_, i) => post(`f${i}`, JULY, i, i === 9 ? 10 : 1_000));
      expect(suspectPosts(first, [labelled(1)])[0]?.why).toBe('no-baseline');
    });

    it('for a month with no post under half its baseline', () => {
      expect(suspectPosts([...june, ...july([])], [labelled(1)])[0]?.why).toBe('none-below-half');
    });

    it('for a month without labels: nothing at all, never a clean bill', () => {
      expect(suspectPosts([...june, ...july([100])], [labelled(0, { labels: [] })])).toEqual([]);
      expect(suspectPosts([...june, ...july([100])], [])).toEqual([]);
    });

    it('for a label whose every suggestion was dismissed', () => {
      expect(suspectPosts([...june, ...july([100])], [labelled(1)], new Set(['low0']))[0]?.why).toBe('all-dismissed');
    });
  });

  it('leaves a dismissed candidate out, without another taking its place', () => {
    const posts = [...june, ...july([100, 200, 300, 400])];
    const all = suspectPosts(posts, [labelled(1)])[0]?.candidates.map((c) => c.id);
    expect(all).toEqual(['low0', 'low1', 'low2']);
    const kept = suspectPosts(posts, [labelled(1)], new Set(['low1']))[0]?.candidates.map((c) => c.id);
    expect(kept).toEqual(['low0', 'low2']);
  });

  it('compares a post only with posts of its own format', () => {
    const links = Array.from({ length: 30 }, (_, i) => post(`l${i}`, JUNE, i, 100, { format: 'link' }));
    // A link post seen 80 times is 80% of the link posts' usual 100, though far below the text posts' 1,000.
    const posts = [...june, ...links, post('link-july', JULY, 1, 80, { format: 'link' })];
    const [label] = suspectPosts(posts, [labelled(1)]);
    expect(label?.why).toBe('none-below-half');
  });

  it('takes baselines given from outside the posts, as the page gives them', () => {
    const [label] = suspectPosts(july([100]), [labelled(1)], new Set(), new Map([['low0', 1_000]]));
    expect(label?.candidates.map((c) => [c.id, c.baseline, c.ratio])).toEqual([['low0', 1_000, 0.1]]);
    // Without them, the first post of July alone has no baseline, so it isn't a candidate.
    expect(suspectPosts(july([100]), [labelled(1)])[0]?.candidates).toEqual([]);
  });

  it('puts a post in its month by UTC, as X’s periods are', () => {
    const lastMinute = post('edge', JULY, 0, 100, { createdAt: JULY - 60_000 });
    const [label] = suspectPosts([...june, lastMinute, ...july([])], [labelled(1)]);
    expect(label?.candidates.map((c) => c.id) ?? []).not.toContain('edge');
  });
});
