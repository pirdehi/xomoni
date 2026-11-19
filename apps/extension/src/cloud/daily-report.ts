// Daily numbers on xomoni.com, by the person's choice (#250, ADR-0026). The choice lives on xomoni.com, one flag per
// account, so every connected browser follows it; this browser keeps the last answer and how far it has sent each X
// account's days. Only counts travel: a row is built from `DailyRow` with exactly the ADR's columns, never text or ids.
// The first send after turning the numbers on goes back up to 400 days, 60 days a call; later ones resend from the day
// before the last one sent, since today and yesterday still change.
import type { DailyRow } from '../shared/daily';
import { localDay } from '../shared/daily';
import { dailyRows, db, kvGet, kvSet } from '../shared/db';
import { asObject } from '../shared/json';
import { CloudError, type StatsRow, reportStats, setStats } from './client';

/** Days a call carries at most (the database's limit). */
export const STATS_BATCH = 60;
/** How far back the first send goes (the database keeps the last 400 days). */
export const STATS_HISTORY_DAYS = 400;

const KEY = 'dailyStats';
const DAY_MS = 86_400_000;

/** What this browser keeps: the account's choice as last heard, and the last day sent for each X account. */
interface StatsState {
  on: boolean;
  sentUpTo: Record<string, string>;
}

async function state(): Promise<StatsState> {
  const value = asObject(await kvGet<unknown>(KEY, null));
  const sent = asObject(value?.sentUpTo) ?? {};
  const sentUpTo: Record<string, string> = {};
  for (const [account, day] of Object.entries(sent)) if (typeof day === 'string') sentUpTo[account] = day;
  return { on: value?.on === true, sentUpTo };
}

/** Whether the account shows its daily numbers on xomoni.com, as this browser last heard. */
export async function statsShown(): Promise<boolean> {
  return (await state()).on;
}

/** Keeps the choice xomoni.com reported; turning off forgets what was sent, so turning on again sends it all. */
export async function rememberStatsChoice(on: boolean): Promise<void> {
  const current = await state();
  await kvSet(KEY, { on, sentUpTo: on ? current.sentUpTo : {} } satisfies StatsState);
}

/**
 * Turns the account's daily numbers on or off from this browser (`device_set_daily_stats`). Off deletes every day
 * already sent, on xomoni.com, in the same call. Returns the choice as stored.
 */
export async function chooseStats(token: string, on: boolean): Promise<boolean> {
  const stored = await setStats(token, on);
  await rememberStatsChoice(stored);
  return stored;
}

/** `row` as `device_report_stats` takes it, for the X account `handle`. */
export function toStatsRow(handle: string, row: DailyRow): StatsRow {
  return {
    x_handle: handle,
    day: row.day,
    followers: row.followers,
    following: row.following,
    posts_total: row.postsTotal,
    likes_total: row.likesTotal,
    posted_posts: row.postedPosts,
    posted_replies: row.postedReplies,
    posted_reposts: row.postedReposts,
    posted_quotes: row.postedQuotes,
    received_likes: row.receivedLikes,
    received_replies: row.receivedReplies,
    received_reposts: row.receivedReposts,
    received_quotes: row.receivedQuotes,
    received_views: row.receivedViews,
    observed_posts: row.observedPosts,
    posts_with_likes: row.postsWithLikes,
    replies_with_likes: row.repliesWithLikes,
    removed_posts: row.removedPosts,
    removed_replies: row.removedReplies,
    removed_reposts: row.removedReposts,
    removed_likes: row.removedLikes,
  };
}

/** Midnight at the start of `day` (`YYYY-MM-DD`), on this computer's clock. */
function dayStart(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getTime();
}

/** Where the next send starts for an account: the day before the last one sent, or 400 days back. */
export function sendFrom(lastSent: string | undefined, now: number): number {
  const oldest = now - STATS_HISTORY_DAYS * DAY_MS;
  return lastSent ? Math.max(oldest, dayStart(lastSent) - DAY_MS) : oldest;
}

/**
 * Sends each X account's days not yet sent, while the account shows its numbers: nothing when it doesn't. An account
 * without a known handle waits. Returns how many days were sent; a refusal because the numbers were turned off
 * elsewhere is remembered, so sending stops.
 */
export async function sendDailyNumbers(token: string, now = Date.now()): Promise<number> {
  const current = await state();
  if (!current.on) return 0;
  let sent = 0;
  for (const account of await db.accounts.toArray()) {
    if (!account.handle) continue;
    const rows = (await dailyRows(account.id, sendFrom(current.sentUpTo[account.id], now), now)).map((row) =>
      toStatsRow(account.handle, row),
    );
    try {
      for (let i = 0; i < rows.length; i += STATS_BATCH)
        sent += await reportStats(token, rows.slice(i, i + STATS_BATCH));
    } catch (err) {
      if (err instanceof CloudError && err.reason === 'stats_off') {
        await rememberStatsChoice(false);
        return sent;
      }
      throw err;
    }
    current.sentUpTo[account.id] = localDay(now);
    await kvSet(KEY, current satisfies StatsState);
  }
  return sent;
}
