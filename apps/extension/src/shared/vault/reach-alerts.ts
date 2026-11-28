// Reach's alerts (#430, P5.3.1, ADR-0045): a desktop notification when an *Under the hood* report brings a label that
// is new or larger than the month before, once per account and month; how many months of labels the person hasn't
// opened Reach on yet, for the menu's badge; and the note when the last 7 days' views fall well under the 8 weeks
// before, from the daily numbers, always an estimate. Everything is read and kept on the computer; nothing here asks X
// for anything or sends anything anywhere, and no word says why reach fell, only what may go with it.
import { localDay } from '../daily';
import { db, kvGet, kvSet } from '../db';
import { type DailyReach, dailyReachSeries } from './reach';
import { type LabelChange, type LabelMonthRow, labelEventWords, monthName } from './under-the-hood';

/** Where the months whose labels were already notified are kept, per account (`kv`): once per month, ever. */
export const labelAlertedKey = (accountId: string) => `labelAlerted:${accountId}`;

/** Where the newest month the person has seen on Reach is kept, per account (`kv`), for the menu's badge. */
export const labelSeenKey = (accountId: string) => `labelSeen:${accountId}`;

/** How many notified months an account keeps: two years' worth. */
const ALERTED_KEPT = 24;

/** What a label notification says. */
export interface LabelAlert {
  title: string;
  message: string;
}

/**
 * The notification for the labels X applied in `month` that are new or larger than the month before (`changes`), in
 * Xomoni's words (`labelEventWords`), or null when there is none. Never a verdict, only what X's file says.
 */
export function labelAlertWords(handle: string, month: string, changes: readonly LabelChange[]): LabelAlert | null {
  if (!changes.length) return null;
  const [first, ...rest] = changes;
  if (!first) return null;
  const more = rest.length ? `, and ${String(rest.length)} more ${rest.length === 1 ? 'label' : 'labels'}` : '';
  return {
    title: `X’s report for ${monthName(month)}: ${changes.length === 1 ? 'a new label' : 'new labels'} for @${handle}`,
    message: `${labelEventWords(first, month)}${more}. See them on Reach, with what each means. Nothing was sent anywhere.`,
  };
}

/** Shows a desktop notification: `notify` in `notify.ts`, or a test's stand-in. */
export type ShowAlert = (id: string, title: string, message: string) => Promise<void>;

/**
 * Notifies the person of `changes` in `month` for `account`, once per account and month: a second import of the same
 * month, even a newer file, says nothing again. Answers the alert shown, or null.
 */
export async function alertLabelChanges(
  account: { id: string; handle: string },
  month: string,
  changes: readonly LabelChange[],
  notificationId: string,
  show: ShowAlert,
): Promise<LabelAlert | null> {
  const alert = labelAlertWords(account.handle, month, changes);
  if (!alert) return null;
  const kept = await kvGet<unknown>(labelAlertedKey(account.id), []);
  const alerted = Array.isArray(kept) ? kept.filter((m): m is string => typeof m === 'string') : [];
  if (alerted.includes(month)) return null;
  await show(notificationId, alert.title, alert.message);
  await kvSet(labelAlertedKey(account.id), [...alerted, month].slice(-ALERTED_KEPT));
  return alert;
}

/** How many of `months` with a label are newer than the newest month the person has seen on Reach (`seen`). */
export function unseenLabelMonths(months: readonly Pick<LabelMonthRow, 'month' | 'labels'>[], seen: string | null) {
  return months.filter((m) => m.labels.length > 0 && (seen === null || m.month > seen)).length;
}

/** The newest month the person has seen on Reach for the account, or null. */
export async function labelSeen(accountId: string): Promise<string | null> {
  const kept = await kvGet<unknown>(labelSeenKey(accountId), null);
  return typeof kept === 'string' && /^\d{4}-\d{2}$/.test(kept) ? kept : null;
}

/** Remembers that the person has seen the account's months up to `month` on Reach; never moves back. */
export async function markLabelsSeen(accountId: string, month: string): Promise<void> {
  const seen = await labelSeen(accountId);
  if (seen === null || month > seen) await kvSet(labelSeenKey(accountId), month);
}

/** Under this share of the usual, the last 7 days' views are a drop worth a note: 0.6. */
export const REACH_DROP_RATIO = 0.6;

/** The fewest posts and replies in the last 7 days for a drop to be noted: fewer, and fewer posts is the reason. */
export const REACH_DROP_MIN_POSTS = 5;

/** A drop in the daily views, as the note says it. */
export interface ReachDrop {
  /** The average views a day over the last 7 days with a number. */
  recent: number;
  /** The average views a day over the 8 weeks before them. */
  usual: number;
  /** `recent` over `usual`. */
  ratio: number;
}

const DAY_MS = 86_400_000;

/**
 * Whether the views of the last 7 days up to `today` (`yyyy-mm-dd`) fell under 0.6 of the 8 weeks before, from the
 * daily numbers (`series`, each an estimate), with at least 5 of the person's posts and replies in those 7 days
 * (`postsLastWeek`); null otherwise, and with fewer than 4 days of numbers on either side.
 */
export function reachDrop(series: readonly DailyReach[], today: string, postsLastWeek: number): ReachDrop | null {
  if (postsLastWeek < REACH_DROP_MIN_POSTS) return null;
  const end = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(end)) return null;
  const daysAgo = (day: string) => Math.round((end - Date.parse(`${day}T00:00:00Z`)) / DAY_MS);
  const recent = series.filter((d) => daysAgo(d.day) >= 0 && daysAgo(d.day) < 7);
  const before = series.filter((d) => daysAgo(d.day) >= 7 && daysAgo(d.day) < 63);
  if (recent.length < 4 || before.length < 4) return null;
  const mean = (rows: readonly DailyReach[]) => rows.reduce((sum, d) => sum + d.views, 0) / rows.length;
  const usual = mean(before);
  if (usual <= 0) return null;
  const ratio = mean(recent) / usual;
  return ratio < REACH_DROP_RATIO ? { recent: mean(recent), usual, ratio } : null;
}

/** Where the person's choice to be notified of a drop is kept, per account (`kv`); off unless they turn it on. */
export const reachDropAlertsKey = (accountId: string) => `reachDropAlerts:${accountId}`;

/** Where the time of the last drop notification is kept, per account (`kv`): at most one a week. */
export const reachDropNotifiedKey = (accountId: string) => `reachDropNotified:${accountId}`;

/** Whether the person asked to be notified when the account's reach drops. */
export async function reachDropAlertsOn(accountId: string): Promise<boolean> {
  return (await kvGet<unknown>(reachDropAlertsKey(accountId), false)) === true;
}

/** Turns the drop notifications on or off for the account. */
export function setReachDropAlerts(accountId: string, on: boolean): Promise<void> {
  return kvSet(reachDropAlertsKey(accountId), on);
}

/**
 * The account's drop at `now`, if any (`reachDrop`): its daily numbers over the last 9 weeks, and how many of its
 * posts and replies were made in the last 7 days, counted through `[accountId+kind+createdAt]`.
 */
export async function accountReachDrop(accountId: string, now: number): Promise<ReachDrop | null> {
  const series = await dailyReachSeries(accountId, 63, now);
  let posts = 0;
  for (const kind of ['post', 'reply'] as const) {
    posts += await db.items
      .where('[accountId+kind+createdAt]')
      .between([accountId, kind, now - 7 * DAY_MS], [accountId, kind, now], true, true)
      .count();
  }
  return reachDrop(series, localDay(now), posts);
}

/**
 * Notifies the person of a drop at `now` when they asked for it, at most once a week per account; answers the drop
 * notified, or null. The dashboard calls it while it is open; nothing runs in the background for it.
 */
export async function notifyReachDrop(
  account: { id: string; handle: string },
  now: number,
  notificationId: string,
  show: ShowAlert,
): Promise<ReachDrop | null> {
  if (!(await reachDropAlertsOn(account.id))) return null;
  const last = await kvGet<unknown>(reachDropNotifiedKey(account.id), 0);
  if (typeof last === 'number' && now - last < 7 * DAY_MS) return null;
  const drop = await accountReachDrop(account.id, now);
  if (!drop) return null;
  await show(
    notificationId,
    `@${account.handle}’s views fell this week`,
    `About ${String(Math.round(drop.ratio * 100))}% of the usual, from the daily numbers (an estimate). Reach shows what may go with it.`,
  );
  await kvSet(reachDropNotifiedKey(account.id), now);
  return drop;
}
