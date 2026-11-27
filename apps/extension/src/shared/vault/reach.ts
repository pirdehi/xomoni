// Each post's reach (#428, ADR-0045, point 1): the person's own posts and replies, each with its number from the best
// source. X's analytics CSV comes first, with the date it was read ("as of"); otherwise the views Xomoni last saw in
// X's answers ("as last seen"); a post with neither has no source and stays out of every comparison. The daily
// numbers (ADR-0026) are only an estimate, for a trend, never for one post. Every number stays on the computer.
import { type DailyStats, localDay } from '../daily';
import { db } from '../db';
import { analyticsPostKey } from './records';
import type { Account, Item } from '../types';
import { type ReachFormat, formatOf } from './reach-stats';

const DAY_MS = 86_400_000;

/** Where a post's number comes from: X's analytics CSV, the views Xomoni last saw live, or nowhere. */
export type ReachSource = 'csv' | 'live' | null;

/** What X's analytics CSV says of one post, as the vault keeps it (CORE-vault's `analyticsPosts`). */
export interface AnalyticsNumbers {
  impressions: number;
  /** X's engagements: every click, like, reply and repost; missing when the CSV leaves it out. */
  engagements?: number;
  /** When the CSV was read: its numbers are as of then (epoch ms). */
  asOf: number;
}

/** A change of Premium on the account's timeline: X showed it (`profile`) or the person said when (`person`). */
export interface PremiumEvent {
  kind: 'premium_on' | 'premium_off';
  /** Epoch ms. */
  at: number;
}

/** A span the account had Premium: from `from` (null: before Xomoni knew) until `to` (null: still). */
export interface PremiumPeriod {
  from: number | null;
  to: number | null;
}

/** One of the person's posts or replies, with its reach. Has every field `reach-stats.ts`'s `ReachSample` needs. */
export interface ReachPost {
  id: string;
  /** Epoch ms. */
  createdAt: number;
  kind: 'post' | 'reply';
  /** Its text as Xomoni kept it, to recognize it by; shown as text, never as markup. */
  text: string;
  format: ReachFormat;
  /** Impressions from the CSV, or the views last seen live; null when neither is known. */
  impressions: number | null;
  source: ReachSource;
  /** When the number was read: the CSV's date, or when X last showed the post; null without a number. */
  asOf: number | null;
  /** The CSV's engagements, or live the likes, reposts, replies, quotes and bookmarks added up; null without a number. */
  engagements: number | null;
  /** Engagements over impressions; null without both, or with 0 impressions. */
  rate: number | null;
  /** External links and media (#428); null when not known. */
  links: number | null;
  media: number | null;
  /** Whether it quotes another post; null when not known. */
  quote: boolean | null;
  /** The hour (0–23) and the day of the week (0 Sunday to 6 Saturday) it was posted, in the person's time zone. */
  hour: number;
  weekday: number;
  /** Whether the account had Premium when it was posted; null when that isn't known (`premiumAt`). */
  premium: boolean | null;
  /** The followers on the day closest to when it was posted that has the profile's counts; null without one. */
  followersAtTime: number | null;
  /** How old it was when its number was read, in days; null without a number. */
  ageAtAsOfDays: number | null;
  /** Whether it is still on X; a post Xomoni removed keeps the reach it had, and has no link to open. */
  onX: boolean;
}

/** Where `reachPosts` gets what isn't in the inventory; CORE-vault's tables, or nothing until they are there. */
export interface ReachSources {
  /** The analytics CSV's numbers of these posts, by post id. */
  analytics(accountId: string, ids: readonly string[]): Promise<ReadonlyMap<string, AnalyticsNumbers>>;
  /** The account's Premium changes, any order. */
  premiumEvents(accountId: string): Promise<readonly PremiumEvent[]>;
}

/** No CSV and no Premium changes: for a test, or a page that only wants what X showed live. */
export const NO_REACH_SOURCES: ReachSources = {
  /** No CSV numbers for any post. */
  analytics: () => Promise.resolve(new Map()),
  /** No Premium changes. */
  premiumEvents: () => Promise.resolve([]),
};

/** Past this many posts, the CSV's numbers are read by the account rather than post by post. */
export const BULK_LOOKUP = 2_000;

/**
 * The vault's (ADR-0043): X's analytics CSV of posts (`analyticsPosts`, a post's impressions as of the newest import
 * that had them) and the account's timeline (`accountEvents`: X Premium seen on or off on the profile, or dated by the
 * person).
 */
export const VAULT_REACH_SOURCES: ReachSources = {
  /**
   * The CSV's numbers of these posts that have impressions: each by its key for a page of posts, and for more than
   * `BULK_LOOKUP` the account's rows in one pass of the `accountId` index, which is far quicker than as many lookups.
   */
  async analytics(accountId, ids) {
    const rows =
      ids.length > BULK_LOOKUP
        ? await db.analyticsPosts.where('accountId').equals(accountId).toArray()
        : await db.analyticsPosts.bulkGet(ids.map((id) => analyticsPostKey(accountId, id)));
    const wanted = ids.length > BULK_LOOKUP ? new Set(ids) : null;
    const out = new Map<string, AnalyticsNumbers>();
    for (const row of rows) {
      if (row?.impressions === undefined || (wanted && !wanted.has(row.postId))) continue;
      out.set(row.postId, {
        impressions: row.impressions,
        asOf: row.asOf,
        ...(row.engagements !== undefined && { engagements: row.engagements }),
      });
    }
    return out;
  },
  /** The account's Premium changes on its timeline. */
  async premiumEvents(accountId) {
    const changes: PremiumEvent[] = [];
    for (const kind of ['premium_on', 'premium_off'] as const) {
      const rows = await db.accountEvents
        .where('[accountId+kind+at]')
        .between([accountId, kind, -Infinity], [accountId, kind, Infinity], true, true)
        .toArray();
      changes.push(...rows.map((row) => ({ kind, at: row.at })));
    }
    return changes;
  },
};

/**
 * The spans the account had Premium, oldest first, from its changes (`premium_on`, `premium_off`) and, without any,
 * from whether X shows it as Premium now (`Account.verified`). A change that repeats the state before it adds nothing.
 * A first `premium_off` closes a span that began before Xomoni knew; a last `premium_on` leaves one open.
 */
export function premiumPeriods(
  events: readonly PremiumEvent[],
  account: Pick<Account, 'verified'> | null,
): PremiumPeriod[] {
  const sorted = [...events].sort((a, b) => a.at - b.at);
  if (!sorted.length) return account?.verified === true ? [{ from: null, to: null }] : [];
  const periods: PremiumPeriod[] = [];
  let open: PremiumPeriod | null = sorted[0]?.kind === 'premium_off' ? { from: null, to: null } : null;
  for (const event of sorted) {
    if (event.kind === 'premium_on' && !open) open = { from: event.at, to: null };
    else if (event.kind === 'premium_off' && open) {
      periods.push({ ...open, to: event.at });
      open = null;
    }
  }
  if (open) periods.push(open);
  return periods;
}

/**
 * Whether the account had Premium at `at`: true inside a span with a known start; null inside one that began before
 * Xomoni knew, or when no span says anything about `at`; false before a known start, or after a span ended.
 */
export function premiumAt(periods: readonly PremiumPeriod[], at: number): boolean | null {
  for (const p of periods) {
    if ((p.from === null || at >= p.from) && (p.to === null || at < p.to)) return p.from === null ? null : true;
  }
  const known = periods.some((p) => (p.from !== null && at < p.from) || (p.to !== null && at >= p.to));
  return known ? false : null;
}

/** The hour and the day of the week of `ms` in `timeZone` (an IANA name), or in the computer's own when not given. */
export function hourAndWeekday(ms: number, timeZone?: string): { hour: number; weekday: number } {
  if (!timeZone) {
    const d = new Date(ms);
    return { hour: d.getHours(), weekday: d.getDay() };
  }
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(ms)
    .reduce<Record<string, string>>((all, part) => ({ ...all, [part.type]: part.value }), {});
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday ?? '');
  return { hour: Number(parts.hour), weekday };
}

/** The followers of the day closest to `at` whose row has the profile's counts (the earlier on a tie); null without. */
export function followersAt(days: readonly Pick<DailyStats, 'day' | 'followers'>[], at: number): number | null {
  const target = Date.parse(`${localDay(at)}T00:00:00Z`);
  let best: { distance: number; followers: number } | null = null;
  for (const row of days) {
    if (row.followers === null) continue;
    const distance = Math.abs(Date.parse(`${row.day}T00:00:00Z`) - target);
    if (!best || distance < best.distance) best = { distance, followers: row.followers };
  }
  return best?.followers ?? null;
}

/** The context `reachPost` needs beyond the post: its CSV numbers, the Premium spans, the days, the time zone. */
export interface ReachContext {
  analytics?: AnalyticsNumbers;
  periods: readonly PremiumPeriod[];
  days: readonly Pick<DailyStats, 'day' | 'followers'>[];
  timeZone?: string;
}

/**
 * One post's reach, with its number from the best source: the CSV's impressions "as of" its date; else the views X
 * last showed, "as last seen" (`seenAt`); else none. Only a post or a reply; a repost or a like isn't the person's.
 */
export function reachPost(item: Item, context: ReachContext): ReachPost {
  const { analytics } = context;
  const live = item.views !== undefined && item.seenAt > 0 ? item.views : undefined;
  const source: ReachSource = analytics ? 'csv' : live !== undefined ? 'live' : null;
  const impressions = analytics ? analytics.impressions : (live ?? null);
  const asOf = analytics ? analytics.asOf : live !== undefined ? item.seenAt : null;
  const engagements = analytics
    ? (analytics.engagements ?? null)
    : live !== undefined
      ? item.likes + item.reposts + item.replies + (item.quotes ?? 0) + (item.bookmarks ?? 0)
      : null;
  const { hour, weekday } = hourAndWeekday(item.createdAt, context.timeZone);
  return {
    id: item.id,
    createdAt: item.createdAt,
    kind: item.kind === 'reply' ? 'reply' : 'post',
    text: item.text,
    format: formatOf(item),
    impressions,
    source,
    asOf,
    engagements,
    rate: engagements !== null && impressions ? engagements / impressions : null,
    links: item.links ?? null,
    media: item.media ?? null,
    quote: item.quote ?? null,
    hour,
    weekday,
    premium: premiumAt(context.periods, item.createdAt),
    followersAtTime: followersAt(context.days, item.createdAt),
    ageAtAsOfDays: asOf === null ? null : Math.max(0, (asOf - item.createdAt) / DAY_MS),
    onX: item.status === 'present',
  };
}

/** What `reachPosts` reads. */
export interface ReachRange {
  /** Epoch ms, inclusive. */
  from: number;
  to: number;
  /** The person's time zone for each post's hour and day; the computer's when not given. */
  timeZone?: string;
}

/**
 * The person's own posts and replies made from `from` to `to`, each with its reach, oldest first; those Xomoni removed
 * too, since they were seen before. Reads the inventory through its `[accountId+kind+createdAt]` index, the daily
 * numbers for the followers, and `sources` (the vault's, `VAULT_REACH_SOURCES`, unless given) for the analytics CSV and
 * the Premium changes. Any number of posts: nothing spreads them into a call's arguments, which V8 can't take past
 * about 125,000.
 */
export async function reachPosts(
  accountId: string,
  range: ReachRange,
  sources: ReachSources = VAULT_REACH_SOURCES,
): Promise<ReachPost[]> {
  let items: Item[] = [];
  for (const kind of ['post', 'reply'] as const) {
    const rows = await db.items
      .where('[accountId+kind+createdAt]')
      .between([accountId, kind, range.from], [accountId, kind, range.to], true, true)
      .toArray();
    // Not `push(...rows)`: spreading 125,000 or more rows into a call's arguments overflows V8's stack.
    items = items.concat(rows);
  }
  const [analytics, events, account, days] = await Promise.all([
    sources.analytics(
      accountId,
      items.map((i) => i.id),
    ),
    sources.premiumEvents(accountId),
    db.accounts.get(accountId),
    db.daily.where('accountId').equals(accountId).toArray(),
  ]);
  const periods = premiumPeriods(events, account ?? null);
  return items
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((item) => reachPost(item, { analytics: analytics.get(item.id), periods, days, timeZone: range.timeZone }));
}

/** One day of the daily numbers' views: an estimate for a trend (ADR-0045, point 1.3), never one post's reach. */
export interface DailyReach {
  day: string;
  /** The rise in views X showed that day across the person's posts and replies (ADR-0026). */
  views: number;
  estimate: true;
}

/**
 * The account's daily views for the `days` days up to `now`, oldest first, from the daily numbers, each marked as an
 * estimate. A day without a row is left out, so a chart shows a gap, not a zero.
 */
export async function dailyReachSeries(accountId: string, days: number, now = Date.now()): Promise<DailyReach[]> {
  const [first, last] = [localDay(now - (days - 1) * DAY_MS), localDay(now)];
  const rows = await db.daily
    .where('[accountId+day]')
    .between([accountId, first], [accountId, last], true, true)
    .toArray();
  return rows.map((row) => ({ day: row.day, views: row.receivedViews, estimate: true as const }));
}
