// Reports (#257): ready-made reports and the person's own, over the daily numbers (ADR-0026) and the jobs, as tables to
// keep: CSV from the browser, PDF through its print. Counts only, as the cloud holds them: no X content. Pure.
import type { DailyNumbers, JobSummary } from './model';
import { daysBefore, daysInScope, isoDay } from './insights';
import { type Period, type Scope, jobsInScope } from './scope';

/** The numbers a report can show. */
export type MetricId =
  | 'followers'
  | 'following'
  | 'posts'
  | 'replies'
  | 'reposts'
  | 'quotes'
  | 'likesReceived'
  | 'repliesReceived'
  | 'repostsReceived'
  | 'quotesReceived'
  | 'views'
  | 'removed';

/** One number a report can show, and how a day gives it. */
export interface Metric {
  id: MetricId;
  label: string;
  /** A count the account has on a day, such as followers, rather than what happened that day. */
  level: boolean;
  /** Estimated from the person's posts Xomoni saw (ADR-0026). */
  estimate: boolean;
  /** The day's value; null when the day didn't have it (a level not seen that day). */
  pick: (day: DailyNumbers) => number | null;
}

/** Every metric, in the order a report lists them. */
export const METRICS: readonly Metric[] = [
  { id: 'followers', label: 'Followers', level: true, estimate: false, pick: (d) => d.followers },
  { id: 'following', label: 'Following', level: true, estimate: false, pick: (d) => d.following },
  { id: 'posts', label: 'Posts published', level: false, estimate: false, pick: (d) => d.postedPosts },
  { id: 'replies', label: 'Replies published', level: false, estimate: false, pick: (d) => d.postedReplies },
  { id: 'reposts', label: 'Reposts', level: false, estimate: false, pick: (d) => d.postedReposts },
  { id: 'quotes', label: 'Quotes published', level: false, estimate: false, pick: (d) => d.postedQuotes },
  { id: 'likesReceived', label: 'Likes received', level: false, estimate: true, pick: (d) => d.receivedLikes },
  { id: 'repliesReceived', label: 'Replies received', level: false, estimate: true, pick: (d) => d.receivedReplies },
  { id: 'repostsReceived', label: 'Reposts received', level: false, estimate: true, pick: (d) => d.receivedReposts },
  { id: 'quotesReceived', label: 'Quotes received', level: false, estimate: true, pick: (d) => d.receivedQuotes },
  { id: 'views', label: 'Views', level: false, estimate: true, pick: (d) => d.receivedViews },
  {
    id: 'removed',
    label: 'Removed by Xomoni',
    level: false,
    estimate: false,
    pick: (d) => d.removedPosts + d.removedReplies + d.removedReposts + d.removedLikes,
  },
];

/** The reports a person can pick. */
export type ReportId = 'week' | 'month' | 'year' | 'cleanup' | 'custom';

/** A report: its own period (or the dashboard's) and the metrics it shows (or the person's). */
export interface ReportKind {
  id: ReportId;
  label: string;
  summary: string;
  /** The period it always covers; null to use the one picked above. */
  period: Period | null;
  /** What it shows; the person's own report starts from these. */
  metrics: readonly MetricId[];
}

const USUAL: readonly MetricId[] = [
  'followers',
  'posts',
  'replies',
  'likesReceived',
  'repliesReceived',
  'views',
  'removed',
];

/** The reports, in the order the place offers them. */
export const REPORTS: readonly ReportKind[] = [
  { id: 'week', label: 'Weekly', summary: 'The last 7 days, against the 7 before.', period: '7d', metrics: USUAL },
  { id: 'month', label: 'Monthly', summary: 'The last 30 days, against the 30 before.', period: '30d', metrics: USUAL },
  {
    id: 'year',
    label: 'Year in review',
    summary: 'The last 12 months, month by month.',
    period: '12m',
    metrics: ['followers', 'following', ...USUAL.slice(1)],
  },
  {
    id: 'cleanup',
    label: 'Cleanup',
    summary: 'What Xomoni removed in the period picked above, job by job.',
    period: null,
    metrics: ['removed'],
  },
  {
    id: 'custom',
    label: 'Your own',
    summary: 'The numbers you pick, for the period above.',
    period: null,
    metrics: USUAL,
  },
];

/** The report named `id`, or the weekly one. */
export function reportFor(id: string | null): ReportKind {
  return REPORTS.find((r) => r.id === id) ?? (REPORTS[0] as ReportKind);
}

/** The account and period a report covers: its own period, or the one picked on the dashboard. */
export function reportScope(report: ReportKind, scope: Scope): Scope {
  return { account: scope.account, period: report.period ?? scope.period };
}

/** `ids` as metrics, in the reports' own order, each once. */
export function metricsOf(ids: readonly MetricId[]): Metric[] {
  return METRICS.filter((m) => ids.includes(m.id));
}

/** A metric over some days: the latest value of each account summed for a level, else the total; null without days. */
function valueOver(metric: Metric, days: readonly DailyNumbers[]): number | null {
  if (!metric.level) return days.length === 0 ? null : days.reduce((sum, d) => sum + (metric.pick(d) ?? 0), 0);
  const latest = new Map<string, number>();
  for (const d of [...days].sort((a, b) => a.day.localeCompare(b.day))) {
    const value = metric.pick(d);
    if (value !== null) latest.set(d.xHandle, value);
  }
  return latest.size === 0 ? null : [...latest.values()].reduce((a, b) => a + b, 0);
}

/** One line of a report's summary: a metric in the period, and in the period before. */
export interface SummaryRow {
  metric: Metric;
  value: number | null;
  previous: number | null;
}

/** The summary of `metrics` for `scope` at `now`, against the period before (none for all time). */
export function summaryRows(
  days: readonly DailyNumbers[],
  scope: Scope,
  metrics: readonly Metric[],
  now: number,
): SummaryRow[] {
  const current = daysInScope(days, scope, now);
  const before = daysBefore(days, scope, now);
  return metrics.map((metric) => ({ metric, value: valueOver(metric, current), previous: valueOver(metric, before) }));
}

/** Whether a table lists days, or months for a long period. */
export type Grain = 'day' | 'month';

/** Days for up to 90 days, months beyond. */
export function grainFor(period: Period): Grain {
  return period === '12m' || period === 'all' ? 'month' : 'day';
}

/** One line of a report's table: a day (`YYYY-MM-DD`) or a month (`YYYY-MM`) and each metric's value. */
export interface TableRow {
  when: string;
  values: (number | null)[];
}

/** `metrics` for each day or month in `scope` that has numbers, oldest first, every account in scope together. */
export function periodTable(
  days: readonly DailyNumbers[],
  scope: Scope,
  metrics: readonly Metric[],
  now: number,
): { grain: Grain; rows: TableRow[] } {
  const grain = grainFor(scope.period);
  const groups = new Map<string, DailyNumbers[]>();
  for (const d of daysInScope(days, scope, now)) {
    const key = grain === 'day' ? d.day : d.day.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  return {
    grain,
    rows: [...groups].map(([when, group]) => ({ when, values: metrics.map((m) => valueOver(m, group)) })),
  };
}

/** What each kind removed in the days given, as Xomoni counted it; null without days. */
export function removedByKind(
  days: readonly DailyNumbers[],
): { posts: number; replies: number; reposts: number; likes: number } | null {
  if (days.length === 0) return null;
  const total = { posts: 0, replies: 0, reposts: 0, likes: 0 };
  for (const d of days) {
    total.posts += d.removedPosts;
    total.replies += d.removedReplies;
    total.reposts += d.removedReposts;
    total.likes += d.removedLikes;
  }
  return total;
}

/** The cleanup jobs in `scope` at `now`, newest first: what each removed, and what it skipped or couldn't remove. */
export function cleanupJobs(jobs: readonly JobSummary[], scope: Scope, now: number): JobSummary[] {
  return jobsInScope(jobs, scope, now)
    .filter((job) => job.kind === 'cleanup')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** A spreadsheet cell: empty, a number, or text. */
export type Cell = string | number | null;

/**
 * Rows as CSV (RFC 4180, CRLF). Text that a spreadsheet would run as a formula (starting with `=`, `+`, `-`, `@`, a
 * tab or a carriage return) is prefixed with `'`, since a job's title comes from the extension.
 */
export function toCsv(rows: readonly (readonly Cell[])[]): string {
  const cell = (value: Cell) => {
    if (value === null) return '';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safe) || safe !== safe.trim() ? `"${safe.replaceAll('"', '""')}"` : safe;
  };
  return rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** A report's table as CSV rows: a header, then one row per day or month. */
export function tableCsv(table: { grain: Grain; rows: readonly TableRow[] }, metrics: readonly Metric[]): Cell[][] {
  return [
    [table.grain === 'day' ? 'Day' : 'Month', ...metrics.map((m) => (m.estimate ? `${m.label} (estimate)` : m.label))],
    ...table.rows.map((row) => [row.when, ...row.values]),
  ];
}

/** The cleanup jobs as CSV rows: a header, then one row per job. */
export function jobsCsv(jobs: readonly JobSummary[]): Cell[][] {
  return [
    ['Updated', 'Account', 'Job', 'State', 'Removed', 'Skipped', 'Failed'],
    ...jobs.map((job) => [job.updatedAt, `@${job.xHandle}`, job.title, job.state, job.done, job.skipped, job.failed]),
  ];
}

/** A report file's name: `xomoni-weekly-ada-2026-11-20.csv`, safe on every system. */
export function reportFileName(report: ReportKind, scope: Scope, now: number, extension: string): string {
  const name = report.label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
  return `xomoni-${name}-${scope.account ?? 'all-accounts'}-${isoDay(now)}.${extension}`;
}
