// The monthly reminder for X's *Under the hood* report (#428, #429, ADR-0043 decision 9, ADR-0045): a source of the
// vault's freshness registry, registered when this module loads. X makes the report for a month from about the 3rd of
// the month after; a month in which the person made fewer than 10 posts in Xomoni gets none, so it is never due. It
// reads only Xomoni's own database; the reminder itself never opens X or starts anything.
import { db } from '../db';
import { registerFreshness } from './freshness';
import { labelMonths } from './label-months';
import { UNDER_THE_HOOD_MIN_POSTS } from './under-the-hood';

/** Days after one report that the next is due: 31, so a short month never asks before X has made it. */
export const UNDER_THE_HOOD_CADENCE_DAYS = 31;

/** Days after it is due that a report is overdue: another month. */
export const UNDER_THE_HOOD_GRACE_DAYS = 31;

/** The most months a reminder looks past, for months with too few posts: two years. */
const MAX_SKIPPED_MONTHS = 24;

/** The `yyyy-mm` month after `month`. */
export function nextMonth(month: string): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${String(year + 1)}-01` : `${String(year)}-${String(m + 1).padStart(2, '0')}`;
}

/** When X's report for `month` comes out (epoch ms): the 3rd of the month after it, UTC. */
export function underTheHoodOutAt(month: string): number {
  const [year, m] = month.split('-').map(Number) as [number, number];
  // `m` counts from 1, and Date.UTC's month from 0: `m` is the month after.
  return Date.UTC(year, m, 3);
}

/** The first and the last moment of `month`, UTC. */
function monthRange(month: string): [number, number] {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return [Date.UTC(year, m - 1, 1), Date.UTC(year, m, 1) - 1];
}

/** How many of the account's own posts and replies Xomoni has from `month`; reposts and likes aren't the account's. */
export async function ownPostsIn(accountId: string, month: string): Promise<number> {
  const [from, to] = monthRange(month);
  let count = 0;
  for (const kind of ['post', 'reply'] as const) {
    count += await db.items
      .where('[accountId+kind+createdAt]')
      .between([accountId, kind, from], [accountId, kind, to], true, true)
      .count();
  }
  return count;
}

/**
 * When the account's newest report is from, for the reminder: the day X made it, the 3rd of the month after its month.
 * Each later month that is over, with fewer than 10 of the account's posts in Xomoni, moves it on a month, since X makes
 * no report for such a month and there is nothing to ask for. Null when the account has imported no report: nothing
 * to renew.
 */
export async function underTheHoodLastAt(accountId: string, now: number): Promise<number | null> {
  const [newest] = await labelMonths(accountId, now);
  if (!newest) return null;
  let month = newest.month;
  for (let i = 0; i < MAX_SKIPPED_MONTHS; i += 1) {
    const next = nextMonth(month);
    if (monthRange(next)[1] >= now || (await ownPostsIn(accountId, next)) >= UNDER_THE_HOOD_MIN_POSTS) break;
    month = next;
  }
  return underTheHoodOutAt(month);
}

registerFreshness({
  source: 'x-under-the-hood',
  label: 'X’s Under the hood report',
  cadenceDays: UNDER_THE_HOOD_CADENCE_DAYS,
  graceDays: UNDER_THE_HOOD_GRACE_DAYS,
  lastAt: underTheHoodLastAt,
});
