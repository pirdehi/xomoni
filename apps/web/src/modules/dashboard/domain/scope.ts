// What the dashboard looks at (#245): one X account or all, over one period. Kept in the address
// (`?account=…&period=30d`), so a link or a reload shows the same thing. Pure.
import type { JobSummary } from './model';

/** A period the pickers offer. `all` has no start. */
export type Period = '7d' | '30d' | '90d' | '12m' | 'all';

/** The periods, in the picker's order, with their words. */
export const PERIODS: readonly { id: Period; label: string }[] = [
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: '12m', label: 'Last 12 months' },
  { id: 'all', label: 'All time' },
];

/** The period when the address names none or one that doesn't exist. */
export const DEFAULT_PERIOD: Period = '30d';

const DAY = 86_400_000;
const LENGTH: Record<Exclude<Period, 'all'>, number> = {
  '7d': 7 * DAY,
  '30d': 30 * DAY,
  '90d': 90 * DAY,
  '12m': 365 * DAY,
};

/** The account and period the dashboard shows. `account` is an X handle without `@`, or null for every account. */
export interface Scope {
  account: string | null;
  period: Period;
}

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

/** The scope in a query string; anything malformed falls back to every account and the default period. */
export function parseScope(params: URLSearchParams): Scope {
  const raw = params.get('period');
  const period = PERIODS.find((p) => p.id === raw)?.id ?? DEFAULT_PERIOD;
  const account = params.get('account');
  return { account: account && HANDLE.test(account) ? account : null, period };
}

/** The scope as a query string without `?`; defaults are left out, so plain addresses stay plain. */
export function scopeQuery(scope: Scope): string {
  const params = new URLSearchParams();
  if (scope.account) params.set('account', scope.account);
  if (scope.period !== DEFAULT_PERIOD) params.set('period', scope.period);
  return params.toString();
}

/** When the period starts (epoch ms) at `now`, or null for all time. */
export function periodStart(period: Period, now: number): number | null {
  return period === 'all' ? null : now - LENGTH[period];
}

/** The X accounts the jobs ran on, sorted, each once. */
export function accountsIn(jobs: readonly Pick<JobSummary, 'xHandle'>[]): string[] {
  return [...new Set(jobs.map((job) => job.xHandle).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** The jobs in scope at `now`: on the chosen account, and updated within the period. Keeps their order. */
export function jobsInScope<T extends Pick<JobSummary, 'xHandle' | 'updatedAt'>>(
  jobs: readonly T[],
  scope: Scope,
  now: number,
): T[] {
  const start = periodStart(scope.period, now);
  return jobs.filter(
    (job) =>
      (scope.account === null || job.xHandle === scope.account) &&
      (start === null || Date.parse(job.updatedAt) >= start),
  );
}

/** What Xomoni removed in the jobs given: the sum of their done counts, for cleanup jobs only. */
export function removedIn(jobs: readonly Pick<JobSummary, 'kind' | 'done'>[]): number {
  return jobs.reduce((sum, job) => sum + (job.kind === 'cleanup' ? job.done : 0), 0);
}
