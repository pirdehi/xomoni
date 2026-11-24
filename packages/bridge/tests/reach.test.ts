import { describe, expect, it } from 'vitest';
import * as bridge from '../src/index';
import {
  REACH_BANNED_WORDS,
  REACH_GUESS_NOTICE,
  REACH_LIMITS,
  REACH_ORDERS,
  REACH_VERDICTS,
  REACH_VERDICT_WORDS,
  type ReachSummary,
  type ReachVerdict,
  parseReachSummary,
  usesBannedReachWord,
} from '../src/reach';

describe('reach diagnosis’s shared words (ADR-0045)', () => {
  it('has five verdicts, each with its words, and nothing else', () => {
    expect([...REACH_VERDICTS].sort()).toEqual(
      ['clear-higher', 'clear-lower', 'maybe', 'no-difference', 'not-enough-data'].sort(),
    );
    expect(Object.keys(REACH_VERDICT_WORDS).sort()).toEqual([...REACH_VERDICTS].sort());
    const words: Record<ReachVerdict, string> = {
      'clear-lower': 'Clearly lower',
      'clear-higher': 'Clearly higher',
      maybe: 'Maybe',
      'no-difference': 'No difference',
      'not-enough-data': 'Not enough data',
    };
    expect(REACH_VERDICT_WORDS).toEqual(words);
  });

  it('is what both apps import from @xomoni/bridge', () => {
    expect(bridge.REACH_VERDICT_WORDS).toBe(REACH_VERDICT_WORDS);
    expect(bridge.REACH_VERDICTS).toBe(REACH_VERDICTS);
    expect(bridge.usesBannedReachWord).toBe(usesBannedReachWord);
  });

  it('finds every form of the banned words, in any case', () => {
    for (const text of [
      'Your post was shadowbanned',
      'a shadow-ban',
      'Shadow ban check',
      'SHADOWBAN',
      'shadow_banned',
      'X banned this post',
      'a ban on links',
      'Bans',
      'banning',
      'penalized',
      'penalised',
      'a penalty',
      'suppressed reach',
      'suppression',
      'throttled',
      'throttling',
    ]) {
      expect(usesBannedReachWord(text), text).toBe(true);
    }
    expect(REACH_BANNED_WORDS.flags).not.toContain('g');
  });

  it('leaves ordinary words alone, and a web address a source’s link names', () => {
    for (const text of [
      'banner',
      'urban',
      'abandoned',
      'Banana',
      'Clearly lower',
      'Not enough data',
      'Source: https://roboin.io/article/en/2026/09/04/checking-xs-official-shadowban-checker-under-the-hood/',
      'http://example.com/banned',
    ]) {
      expect(usesBannedReachWord(text), text).toBe(false);
    }
    expect(usesBannedReachWord('https://example.com/a banned')).toBe(true);
  });

  it('uses none of them in its own words', () => {
    for (const words of [...Object.values(REACH_VERDICT_WORDS), REACH_GUESS_NOTICE])
      expect(usesBannedReachWord(words)).toBe(false);
    expect(REACH_GUESS_NOTICE).toBe("This is a guess. X doesn't say which posts got a label.");
    expect(bridge.REACH_GUESS_NOTICE).toBe(REACH_GUESS_NOTICE);
  });
});

describe('a reach read’s answer (ADR-0045 point 6, ADR-0028)', () => {
  const summary = (): ReachSummary => ({
    rangeDays: 30,
    csv: 2,
    live: 40,
    comparisons: [
      {
        id: 'links',
        verdict: 'clear-lower',
        a: { n: 20, median: 500 },
        b: { n: 22, median: 1_000 },
        ratio: 0.5,
        low: 0.4,
        high: 0.62,
      },
      {
        id: 'premium',
        verdict: 'not-enough-data',
        a: { n: 3, median: null },
        b: { n: 0, median: null },
        ratio: null,
        low: null,
        high: null,
      },
    ],
    months: [
      {
        month: '2026-08',
        labels: [{ name: 'SPAM_HIGH_RECALL', count: 2, scope: 'posts' }],
        postsInMonth: 40,
        eligible: null,
      },
      { month: '2026-07', labels: [], postsInMonth: null, eligible: false },
    ],
    posts: [{ id: '1800000000000000001', createdAt: 1, text: '', impressions: 900, source: 'live', vsUsual: null }],
    total: 42,
    suspects: [
      {
        id: '1800000000000000001',
        month: '2026-08',
        label: 'SPAM_HIGH_RECALL',
        confidence: 'low',
        ratio: 0.1,
        reasons: ['Seen 100 times: 10% of your usual 1,000 for text posts, the median of the 8 weeks before it.'],
        guess: true,
      },
    ],
  });

  it('reads an answer in shape, as it is, and is what @xomoni/bridge exports', () => {
    expect(parseReachSummary(summary())).toEqual(summary());
    expect(parseReachSummary({ ...summary(), rangeDays: null })?.rangeDays).toBeNull();
    expect(bridge.parseReachSummary).toBe(parseReachSummary);
    expect(REACH_ORDERS).toEqual(['best', 'worst', 'recent']);
  });

  it('refuses a suspected post that isn’t marked as a guess, whole', () => {
    for (const guess of [false, undefined, 'true', 1]) {
      const s = summary();
      const bad = { ...s, suspects: [{ ...s.suspects[0], guess }] };
      expect(parseReachSummary(bad), String(guess)).toBeNull();
    }
  });

  it('refuses an answer over its limits', () => {
    const s = summary();
    const many = <T>(item: T, n: number) => Array.from({ length: n }, () => item);
    for (const bad of [
      { ...s, comparisons: many(s.comparisons[0], REACH_LIMITS.comparisons + 1) },
      { ...s, months: many(s.months[0], REACH_LIMITS.months + 1) },
      { ...s, posts: many(s.posts[0], REACH_LIMITS.posts + 1) },
      { ...s, suspects: many(s.suspects[0], REACH_LIMITS.suspects + 1) },
      { ...s, posts: [{ ...s.posts[0], text: 'x'.repeat(REACH_LIMITS.text + 1) }] },
      { ...s, months: [{ ...s.months[0], labels: many(s.months[0]!.labels[0], REACH_LIMITS.labels + 1) }] },
      { ...s, suspects: [{ ...s.suspects[0], reasons: many('why', REACH_LIMITS.reasons + 1) }] },
      { ...s, suspects: [{ ...s.suspects[0], reasons: ['x'.repeat(REACH_LIMITS.reason + 1)] }] },
    ]) {
      expect(parseReachSummary(bad)).toBeNull();
    }
    // At the limits, it reads.
    expect(parseReachSummary({ ...s, posts: many(s.posts[0], REACH_LIMITS.posts) })?.posts).toHaveLength(100);
  });

  it('lets an error that isn’t about the answer’s shape through', () => {
    const odd = {
      ...summary(),
      get csv(): number {
        throw new Error('not the shape');
      },
    };
    expect(() => parseReachSummary(odd)).toThrow('not the shape');
  });

  it('refuses anything out of shape', () => {
    const s = summary();
    const c = s.comparisons[0]!;
    const m = s.months[0]!;
    const p = s.posts[0]!;
    const g = s.suspects[0]!;
    for (const bad of [
      null,
      [],
      'answer',
      { ...s, extra: 1 },
      { ...s, csv: -1 },
      { ...s, live: 1.5 },
      { ...s, total: '42' },
      { ...s, rangeDays: 'all' },
      { ...s, comparisons: 'many' },
      { ...s, comparisons: [{ ...c, id: 'hashtags' }] },
      { ...s, comparisons: [{ ...c, verdict: 'shadowbanned' }] },
      { ...s, comparisons: [{ ...c, ratio: -1 }] },
      { ...s, comparisons: [{ ...c, low: Number.NaN }] },
      { ...s, comparisons: [{ ...c, a: { n: 1 } }] },
      { ...s, comparisons: [{ ...c, a: { n: -1, median: 1 } }] },
      { ...s, comparisons: [{ ...c, b: null }] },
      { ...s, months: [{ ...m, month: '2026-13' }] },
      { ...s, months: [{ ...m, month: 202608 }] },
      { ...s, months: [{ ...m, eligible: 'no' }] },
      { ...s, months: [{ ...m, postsInMonth: -2 }] },
      { ...s, months: [{ ...m, labels: [{ name: '', count: 1, scope: 'posts' }] }] },
      { ...s, months: [{ ...m, labels: [{ name: 'A', count: 1, scope: 'everyone' }] }] },
      { ...s, months: [{ ...m, labels: [{ name: 'A', count: 1 }] }] },
      { ...s, posts: [{ ...p, id: 'javascript:alert(1)' }] },
      { ...s, posts: [{ ...p, id: 7 }] },
      { ...s, posts: [{ ...p, source: 'guess' }] },
      { ...s, posts: [{ ...p, text: 5 }] },
      { ...s, posts: [{ ...p, impressions: null }] },
      { ...s, suspects: [{ ...g, id: '../x' }] },
      { ...s, suspects: [{ ...g, month: 'August' }] },
      { ...s, suspects: [{ ...g, confidence: 'high' }] },
      { ...s, suspects: [{ ...g, ratio: -0.1 }] },
      { ...s, suspects: [{ ...g, reasons: [''] }] },
      { ...s, suspects: [{ ...g, label: 'x'.repeat(101) }] },
      { ...s, suspects: [{ ...g, extra: true }] },
    ]) {
      expect(parseReachSummary(bad), JSON.stringify(bad).slice(0, 120)).toBeNull();
    }
  });
});
