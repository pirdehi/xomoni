import { describe, expect, it } from 'vitest';
import type { DailyNumbers, JobSummary } from './model';
import {
  METRICS,
  REPORTS,
  cleanupJobs,
  grainFor,
  jobsCsv,
  metricsOf,
  periodTable,
  removedByKind,
  reportFileName,
  reportFor,
  reportScope,
  summaryRows,
  tableCsv,
  toCsv,
} from './reports';

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
    updatedAt: '2026-11-20T10:00:00Z',
    ...over,
  };
}

function job(over: Partial<JobSummary> = {}): JobSummary {
  return {
    id: 'j1',
    deviceId: 'd1',
    localId: 'l1',
    xHandle: 'ada',
    kind: 'cleanup',
    title: 'Delete posts before Jan 1, 2024',
    state: 'completed',
    phase: '',
    stateReason: '',
    matched: 10,
    done: 8,
    skipped: 1,
    failed: 1,
    scanned: 0,
    riskLevel: 0,
    updatedAt: '2026-11-19T10:00:00Z',
    ...over,
  };
}

const metric = (id: string) => METRICS.find((m) => m.id === id)!;
const week = { account: null, period: '7d' } as const;

describe('the reports (#257)', () => {
  it('offers weekly, monthly, the year, cleanup and the person’s own, each with its period', () => {
    expect(REPORTS.map((r) => [r.id, r.period])).toEqual([
      ['week', '7d'],
      ['month', '30d'],
      ['year', '12m'],
      ['cleanup', null],
      ['custom', null],
    ]);
    expect(reportFor('year').label).toBe('Year in review');
    expect(reportFor('nonsense').id).toBe('week');
    expect(reportFor(null).id).toBe('week');
    // A report with its own period keeps the account picked above; the others use the period too.
    expect(reportScope(reportFor('month'), { account: 'ada', period: '12m' })).toEqual({
      account: 'ada',
      period: '30d',
    });
    expect(reportScope(reportFor('custom'), { account: null, period: '90d' })).toEqual({
      account: null,
      period: '90d',
    });
    expect(metricsOf(['removed', 'followers']).map((m) => m.id)).toEqual(['followers', 'removed']);
  });

  it('sums what happened, takes the latest of what an account has, and compares with the period before', () => {
    const days = [
      day('2026-11-10', { followers: 90, postedPosts: 1, receivedLikes: 3 }),
      day('2026-11-15', { followers: 100, postedPosts: 2, receivedLikes: 5, removedPosts: 4, removedLikes: 1 }),
      day('2026-11-18', { followers: 110, postedPosts: 1 }),
      day('2026-11-19', { xHandle: 'bob', followers: 7, postedPosts: 1 }),
    ];
    const rows = summaryRows(
      days,
      week,
      metricsOf(['followers', 'posts', 'likesReceived', 'removed', 'following']),
      NOW,
    );
    expect(rows.map((r) => [r.metric.id, r.value, r.previous])).toEqual([
      ['followers', 117, 90],
      // No account showed it: nothing to say. Metrics keep the reports' own order.
      ['following', null, null],
      ['posts', 4, 1],
      ['likesReceived', 5, 3],
      ['removed', 5, 0],
    ]);
    expect(summaryRows([], week, [metric('posts')], NOW)[0]).toMatchObject({ value: null, previous: null });
    expect(metric('views').estimate).toBe(true);
    expect(metric('followers').level).toBe(true);
  });

  it('tables days for up to 90 days and months beyond, oldest first, accounts together', () => {
    expect(grainFor('7d')).toBe('day');
    expect(grainFor('90d')).toBe('day');
    expect(grainFor('12m')).toBe('month');
    expect(grainFor('all')).toBe('month');
    const days = [
      day('2026-11-18', { followers: 110, postedPosts: 1 }),
      day('2026-11-18', { xHandle: 'bob', followers: 7, postedPosts: 2 }),
      day('2026-11-15', { followers: 100 }),
      day('2026-10-02', { followers: 80, postedPosts: 3 }),
    ];
    const metrics = metricsOf(['followers', 'posts']);
    expect(periodTable(days, week, metrics, NOW)).toEqual({
      grain: 'day',
      rows: [
        { when: '2026-11-15', values: [100, 0] },
        { when: '2026-11-18', values: [117, 3] },
      ],
    });
    expect(periodTable(days, { account: 'ada', period: '12m' }, metrics, NOW)).toEqual({
      grain: 'month',
      rows: [
        { when: '2026-10', values: [80, 3] },
        { when: '2026-11', values: [110, 1] },
      ],
    });
  });

  it('counts what each kind removed, and lists the cleanup jobs in scope, newest first', () => {
    expect(removedByKind([])).toBeNull();
    expect(
      removedByKind([
        day('2026-11-18', { removedPosts: 2, removedLikes: 3 }),
        day('2026-11-19', { removedReplies: 1 }),
      ]),
    ).toEqual({ posts: 2, replies: 1, reposts: 0, likes: 3 });
    const jobs = [
      job({ id: 'old', updatedAt: '2026-11-01T00:00:00Z' }),
      job({ id: 'scan', kind: 'scan' }),
      job({ id: 'bob', xHandle: 'bob' }),
      job({ id: 'new', updatedAt: '2026-11-20T09:00:00Z' }),
      job({ id: 'mid' }),
    ];
    expect(cleanupJobs(jobs, { account: 'ada', period: '7d' }, NOW).map((j) => j.id)).toEqual(['new', 'mid']);
  });
});

describe('CSV (#257)', () => {
  it('writes RFC 4180 rows with CRLF, quoting what needs it, and leaves empty cells empty', () => {
    expect(
      toCsv([
        ['Day', 'Note'],
        ['2026-11-20', 'a, b'],
        ['x', 'say "hi"'],
        [1.5, null],
        [Number.NaN, ' padded '],
        ['line\nbreak', ''],
      ]),
    ).toBe('Day,Note\r\n2026-11-20,"a, b"\r\nx,"say ""hi"""\r\n1.5,\r\n," padded "\r\n"line\nbreak",\r\n');
  });

  it('never lets a spreadsheet run a cell as a formula', () => {
    expect(toCsv([['=HYPERLINK("http://evil.example")', '+1', '-2', '@SUM(A1)', '\tx', 'fine']])).toBe(
      `"'=HYPERLINK(""http://evil.example"")",'+1,'-2,'@SUM(A1),'\tx,fine\r\n`,
    );
    // Numbers stay numbers, negative ones too.
    expect(toCsv([[-3]])).toBe('-3\r\n');
  });

  it('makes a report’s table and the cleanup jobs into rows, marking estimates', () => {
    const metrics = metricsOf(['followers', 'views']);
    expect(tableCsv({ grain: 'day', rows: [{ when: '2026-11-20', values: [10, null] }] }, metrics)).toEqual([
      ['Day', 'Followers', 'Views (estimate)'],
      ['2026-11-20', 10, null],
    ]);
    expect(tableCsv({ grain: 'month', rows: [] }, metrics)[0]?.[0]).toBe('Month');
    expect(jobsCsv([job({ title: '=cmd' })])).toEqual([
      ['Updated', 'Account', 'Job', 'State', 'Removed', 'Skipped', 'Failed'],
      ['2026-11-19T10:00:00Z', '@ada', '=cmd', 'completed', 8, 1, 1],
    ]);
  });

  it('names the file by report, account and day, safely', () => {
    expect(reportFileName(reportFor('year'), { account: 'ada', period: '12m' }, NOW, 'csv')).toBe(
      'xomoni-year-in-review-ada-2026-11-20.csv',
    );
    expect(reportFileName(reportFor('week'), week, NOW, 'csv')).toBe('xomoni-weekly-all-accounts-2026-11-20.csv');
  });
});
