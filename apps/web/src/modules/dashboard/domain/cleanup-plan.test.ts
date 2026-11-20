import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAN_FORM,
  FIRST_DAY,
  type PlanForm,
  TOO_EARLY,
  daysFor,
  keepWords,
  localDay,
  parsePlanForm,
  planFormQuery,
  toPlan,
} from './cleanup-plan';

const NOW = new Date(2026, 10, 20, 15, 30).getTime();
const form = (over: Partial<PlanForm>): PlanForm => ({ ...DEFAULT_PLAN_FORM, ...over });

describe('the Cleanup place’s answers in the address (#235)', () => {
  it('keeps only what differs from the default, and reads it back', () => {
    expect(planFormQuery(DEFAULT_PLAN_FORM).toString()).toBe('');
    const answers = form({
      target: 'reply',
      age: 'custom',
      before: '2020-01-01',
      from: '2015-06-01',
      likes: '25',
      keep: 'launch, xomoni',
      threads: false,
    });
    const query = planFormQuery(answers);
    expect(query.toString()).toBe(
      'what=reply&older=custom&before=2020-01-01&from=2015-06-01&likes=25&keep=launch%2C+xomoni&threads=no',
    );
    expect(parsePlanForm(query)).toEqual(answers);
  });

  it('falls back to the default for anything malformed', () => {
    expect(
      parsePlanForm(new URLSearchParams('what=all&older=10y&before=yesterday&from=2020-1-1&likes=-3&threads=maybe')),
    ).toEqual(DEFAULT_PLAN_FORM);
  });
});

describe('toPlan (#235)', () => {
  it('turns a preset age into the start of that local day', () => {
    const result = toPlan(form({ age: '30d', likes: '10', keep: 'Launch,  launch\nXomoni' }), NOW);
    expect(result).toEqual({
      plan: {
        target: 'post',
        before: new Date(2026, 9, 21).getTime(),
        after: null,
        keepMinLikes: 10,
        keepKeywords: ['launch', 'xomoni'],
        skipSelfReplies: true,
      },
    });
  });

  it('takes a date range, and keeps likes only for posts and replies', () => {
    expect(
      toPlan(form({ target: 'like', age: 'custom', before: '2020-01-01', from: '2015-01-01', likes: '5' }), NOW),
    ).toEqual({
      plan: {
        target: 'like',
        before: new Date(2020, 0, 1).getTime(),
        after: new Date(2015, 0, 1).getTime(),
        keepMinLikes: null,
        keepKeywords: [],
        skipSelfReplies: true,
      },
    });
  });

  it('says what is wrong instead of guessing', () => {
    const problem = (over: Partial<PlanForm>) => {
      const result = toPlan(form(over), NOW);
      return 'problem' in result ? result.problem : null;
    };
    expect(problem({ age: 'custom', before: '' })).toBe('Pick the date to remove everything before.');
    expect(problem({ age: 'custom', before: '2026-02-30' })).toBe('Pick the date to remove everything before.');
    expect(problem({ age: 'custom', before: '2027-01-01' })).toBe('The date must be today or earlier.');
    expect(problem({ from: '2026-13-01' })).toBe('Pick the start date, or leave it empty.');
    // Xomoni refuses dates before X began: the form says so instead of handing it a plan it would refuse.
    expect(problem({ age: 'custom', before: '2005-12-31' })).toBe(TOO_EARLY);
    expect(problem({ from: '2006-01-01' })).toBe(TOO_EARLY);
    expect(problem({ from: FIRST_DAY })).toBeNull();
    expect(problem({ age: 'custom', before: '2020-01-01', from: '2020-01-01' })).toBe(
      'The start date must be before the end date.',
    );
    expect(problem({ likes: '0' })).toBe('Likes to keep must be a whole number from 1, or empty.');
    expect(problem({ likes: '2.5' })).toBe('Likes to keep must be a whole number from 1, or empty.');
    expect(problem({ keep: Array.from({ length: 21 }, (_, i) => `w${i}`).join(',') })).toBe(
      'Keep at most 20 words or phrases.',
    );
    expect(problem({ keep: 'x'.repeat(51) })).toBe('Each word or phrase to keep can be at most 50 characters.');
  });
});

describe('helpers', () => {
  it('reads a local day, and nothing that isn’t one', () => {
    expect(localDay('2020-02-29')).toBe(new Date(2020, 1, 29).getTime());
    expect(localDay('2021-02-29')).toBeNull();
    expect(localDay('20-02-29')).toBeNull();
  });

  it('splits words to keep as Xomoni does', () => {
    expect(keepWords(' A, b\n\na ,')).toEqual(['a', 'b']);
  });

  it('counts the days a plan takes at a pace', () => {
    expect(daysFor(0, 100)).toBe(0);
    expect(daysFor(1, 100)).toBe(1);
    expect(daysFor(250, 100)).toBe(3);
    expect(daysFor(5, 0)).toBe(Infinity);
  });
});
