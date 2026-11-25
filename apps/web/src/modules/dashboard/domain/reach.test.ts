import { REACH_RANGES, REACH_VERDICT_WORDS, type ReachComparisonSummary, usesBannedReachWord } from '@xomoni/bridge';
import { describe, expect, it } from 'vitest';
import {
  REACH_ORDER_WORDS,
  comparisonView,
  hasReach,
  monthNote,
  monthWords,
  postUrl,
  rangeIsPlus,
  rangeWords,
  reachPostsCsv,
  shareWords,
  vsUsualWords,
} from './reach';

const links: ReachComparisonSummary = {
  id: 'links',
  verdict: 'clear-lower',
  a: { n: 20, median: 500 },
  b: { n: 22, median: 1_000 },
  ratio: 0.52,
  low: 0.41,
  high: 0.66,
};

describe('Reach on xomoni.com (#431, ADR-0045)', () => {
  it('words a comparison as the extension does, with its interval', () => {
    expect(comparisonView(links)).toEqual({
      id: 'links',
      title: 'Posts with a link, against posts without',
      groups: ['With a link', 'Without'],
      verdict: 'Clearly lower',
      sentence: 'Posts with a link were seen 52% as much as posts without (95% interval 41% to 66%).',
    });
    expect(
      comparisonView({ ...links, id: 'premium', verdict: 'clear-higher', ratio: 2, low: 1.5, high: 2.4 }).sentence,
    ).toBe('Posts with Premium were seen 200% as much as posts before it (95% interval 150% to 240%).');
    expect(comparisonView({ ...links, id: 'media' }).title).toBe('Posts with photos or videos, against text only');
  });

  it('says only the verdict, without numbers, when there is not enough data', () => {
    const none = comparisonView({ ...links, verdict: 'not-enough-data', ratio: null, low: null, high: null });
    expect(none).toMatchObject({ verdict: REACH_VERDICT_WORDS['not-enough-data'], sentence: null });
    // An interval X can't give (a side with a median of 0) says no sentence either.
    expect(comparisonView({ ...links, verdict: 'clear-higher', ratio: null }).sentence).toBeNull();
  });

  it('names months, and what a month without a table says, never clean', () => {
    expect(monthWords('2026-07')).toBe('July 2026');
    expect(monthWords('2026-12')).toBe('December 2026');
    expect(monthNote({ month: '2026-07', labels: [], postsInMonth: 40, eligible: null })).toBe(
      'No labels that month, across 40 posts.',
    );
    expect(monthNote({ month: '2026-07', labels: [], postsInMonth: null, eligible: null })).toBe(
      'No labels that month.',
    );
    expect(monthNote({ month: '2026-07', labels: [], postsInMonth: 3, eligible: false })).toBe(
      "X says the account wasn't eligible for that month's report.",
    );
    expect(
      monthNote({
        month: '2026-07',
        labels: [{ name: 'A', count: 1, scope: 'posts' }],
        postsInMonth: 3,
        eligible: null,
      }),
    ).toBeNull();
  });

  it('names each period, and only the free 30 days as free', () => {
    expect(REACH_RANGES.map(rangeWords)).toEqual(['Last 30 days', 'Last 90 days', 'Last year', 'Everything']);
    expect(REACH_RANGES.filter(rangeIsPlus)).toEqual([90, 365, null]);
  });

  it('words shares, orders and links', () => {
    expect(shareWords(0.254)).toBe('25%');
    expect(vsUsualWords(1.5)).toBe('150% of usual');
    expect(vsUsualWords(null)).toBe('—');
    expect(REACH_ORDER_WORDS).toEqual({ recent: 'Newest', best: 'Most seen', worst: 'Least seen' });
    expect(postUrl('123', 'me')).toBe('https://x.com/me/status/123');
    expect(postUrl('123', '')).toBe('https://x.com/i/web/status/123');
  });

  it('exports the posts as CSV a spreadsheet can’t run', () => {
    const csv = reachPostsCsv(
      [
        {
          id: '1',
          createdAt: Date.UTC(2026, 6, 1),
          text: '=HYPERLINK("x")',
          impressions: 10,
          source: 'live',
          vsUsual: 0.456,
        },
        {
          id: '2',
          createdAt: Date.UTC(2026, 6, 2),
          text: 'plain, with a comma',
          impressions: 20,
          source: 'csv',
          vsUsual: null,
        },
      ],
      'me',
    );
    expect(csv.split('\r\n')).toEqual([
      'date,text,seen,source,share of usual,link',
      `2026-07-01,"'=HYPERLINK(""x"")",10,views Xomoni saw,0.46,https://x.com/me/status/1`,
      `2026-07-02,"plain, with a comma",20,X's analytics export,,https://x.com/me/status/2`,
      '',
    ]);
  });

  it('knows when there is something to show', () => {
    expect(hasReach({ csv: 0, live: 0, months: [] })).toBe(false);
    expect(hasReach({ csv: 0, live: 1, months: [] })).toBe(true);
    expect(
      hasReach({ csv: 0, live: 0, months: [{ month: '2026-07', labels: [], postsInMonth: null, eligible: null }] }),
    ).toBe(true);
  });

  it('never says a post was banned, penalized, suppressed or throttled', () => {
    for (const id of ['links', 'media', 'premium'] as const) {
      const view = comparisonView({ ...links, id });
      for (const words of [view.title, ...view.groups, view.verdict, view.sentence ?? '']) {
        expect(usesBannedReachWord(words)).toBe(false);
      }
    }
  });
});
