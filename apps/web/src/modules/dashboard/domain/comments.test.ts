import { MAX_PLAN_IDS, parsePlan, parseRepliesFilter } from '@xomoni/bridge';
import { describe, expect, it } from 'vitest';
import { TOO_EARLY } from './cleanup-plan';
import { DEFAULT_REPLIES_FORM, pickedPlan, toRepliesFilter, typedHandle } from './comments';

const NOW = new Date(2026, 10, 20, 15, 30).getTime();
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

describe('Your replies: the filter (#256)', () => {
  it('lists every reply but your own threads by default', () => {
    expect(toRepliesFilter(DEFAULT_REPLIES_FORM, NOW)).toEqual({
      filter: { after: null, before: null, maxLikes: null, replyTo: '', query: '', threads: false },
    });
  });

  it('reads local days, through the whole last day, likes, a handle with or without @, and words', () => {
    const result = toRepliesFilter(
      { from: '2024-01-01', through: '2024-12-31', likes: '0', who: ' @Ada_L ', words: '  rust ', threads: true },
      NOW,
    );
    expect(result).toEqual({
      filter: {
        after: day(2024, 1, 1),
        before: day(2025, 1, 1),
        maxLikes: 0,
        replyTo: 'Ada_L',
        query: 'rust',
        threads: true,
      },
    });
    // Xomoni takes exactly this.
    expect('filter' in result && parseRepliesFilter(result.filter, NOW)).toEqual('filter' in result && result.filter);
    // Through today is allowed, and Xomoni takes its end too.
    const today = toRepliesFilter({ ...DEFAULT_REPLIES_FORM, through: '2026-11-20' }, NOW);
    expect(today).toEqual({ filter: expect.objectContaining({ before: day(2026, 11, 21) }) });
    expect('filter' in today && parseRepliesFilter(today.filter, NOW)).not.toBeNull();
  });

  it('says what is wrong instead of asking Xomoni something it would refuse', () => {
    const problem = (over: Partial<typeof DEFAULT_REPLIES_FORM>) => {
      const result = toRepliesFilter({ ...DEFAULT_REPLIES_FORM, ...over }, NOW);
      return 'problem' in result ? result.problem : null;
    };
    expect(problem({ from: '2024-02-31' })).toBe('Pick the first day, or leave it empty.');
    expect(problem({ through: 'soon' })).toBe('Pick the last day, or leave it empty.');
    expect(problem({ from: '2005-06-01' })).toBe(TOO_EARLY);
    expect(problem({ through: '2006-01-01' })).toBe(TOO_EARLY);
    expect(problem({ through: '2026-11-21' })).toBe('The last day must be today or earlier.');
    expect(problem({ from: '2024-02-02', through: '2024-02-01' })).toBe('The first day must not be after the last.');
    expect(problem({ from: '2024-02-01', through: '2024-02-01' })).toBeNull();
    expect(problem({ likes: '-1' })).toBe('Likes must be a whole number from 0, or empty.');
    expect(problem({ likes: '2.5' })).toBe('Likes must be a whole number from 0, or empty.');
    expect(problem({ who: 'ada lovelace' })).toBe('That isn’t an X handle: letters, digits and _ only.');
    expect(problem({ who: 'x'.repeat(16) })).toBe('That isn’t an X handle: letters, digits and _ only.');
    expect(problem({ words: 'x'.repeat(101) })).toBe('Search at most 100 characters.');
  });

  it('takes a handle as typed, without @ or spaces', () => {
    expect(typedHandle('  @ada ')).toBe('ada');
    expect(typedHandle('')).toBe('');
  });
});

describe('Your replies: the picked ones, handed to Xomoni (#256)', () => {
  it('is a plan of only those replies, with nothing else kept, that Xomoni takes', () => {
    const plan = pickedPlan(['1800000000000000001', '1800000000000000002', '1800000000000000001'], NOW);
    expect(plan).toEqual({
      target: 'reply',
      before: NOW,
      after: null,
      keepMinLikes: null,
      keepKeywords: [],
      skipSelfReplies: false,
      onlyIds: ['1800000000000000001', '1800000000000000002'],
    });
    expect(parsePlan(plan, NOW)).toEqual(plan);
  });

  it('never names more than Xomoni takes at a time', () => {
    const many = Array.from({ length: MAX_PLAN_IDS + 20 }, (_, i) => `18000000000000${String(i).padStart(5, '0')}`);
    expect(pickedPlan(many, NOW).onlyIds).toHaveLength(MAX_PLAN_IDS);
  });
});
