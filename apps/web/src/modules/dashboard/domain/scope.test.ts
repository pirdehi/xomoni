import { describe, expect, it } from 'vitest';
import { DEFAULT_PERIOD, accountsIn, jobsInScope, parseScope, periodStart, removedIn, scopeQuery } from './scope';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

describe('the dashboard’s scope (#245)', () => {
  it('reads the account and period from the address, falling back on bad values', () => {
    expect(parseScope(new URLSearchParams('account=ada_1&period=7d'))).toEqual({ account: 'ada_1', period: '7d' });
    expect(parseScope(new URLSearchParams(''))).toEqual({ account: null, period: DEFAULT_PERIOD });
    expect(parseScope(new URLSearchParams('account=<script>&period=5y'))).toEqual({ account: null, period: '30d' });
    expect(parseScope(new URLSearchParams('account=waytoolonghandle_x'))).toEqual({ account: null, period: '30d' });
  });

  it('writes the scope back, leaving defaults out', () => {
    expect(scopeQuery({ account: null, period: '30d' })).toBe('');
    expect(scopeQuery({ account: 'ada', period: 'all' })).toBe('account=ada&period=all');
    expect(scopeQuery({ account: null, period: '12m' })).toBe('period=12m');
  });

  it('knows when each period starts, and that all time has no start', () => {
    expect(periodStart('7d', NOW)).toBe(NOW - 7 * DAY);
    expect(periodStart('12m', NOW)).toBe(NOW - 365 * DAY);
    expect(periodStart('all', NOW)).toBeNull();
  });

  it('lists each account once, sorted, without empty handles', () => {
    expect(accountsIn([{ xHandle: 'zed' }, { xHandle: 'ada' }, { xHandle: '' }, { xHandle: 'zed' }])).toEqual([
      'ada',
      'zed',
    ]);
  });

  it('keeps the jobs of the account and period, in their order', () => {
    const jobs = [
      { id: 'a', xHandle: 'ada', updatedAt: at(1) },
      { id: 'b', xHandle: 'bob', updatedAt: at(2) },
      { id: 'c', xHandle: 'ada', updatedAt: at(40) },
    ];
    expect(jobsInScope(jobs, { account: null, period: '30d' }, NOW).map((j) => j.id)).toEqual(['a', 'b']);
    expect(jobsInScope(jobs, { account: 'ada', period: 'all' }, NOW).map((j) => j.id)).toEqual(['a', 'c']);
    expect(jobsInScope(jobs, { account: 'bob', period: '7d' }, NOW).map((j) => j.id)).toEqual(['b']);
  });

  it('counts what cleanups removed, never a scan’s count', () => {
    expect(
      removedIn([
        { kind: 'cleanup', done: 40 },
        { kind: 'scan', done: 900 },
        { kind: 'cleanup', done: 2 },
      ]),
    ).toBe(42);
    expect(removedIn([])).toBe(0);
  });
});
