// Overview's numbers from the daily numbers (#252, ADR-0026): the figures for the chosen account and period against
// the period before, followers over time, and what was published each day. Pure.
//
// Days are the person's computer's calendar days (`YYYY-MM-DD`). A period's first day is taken in UTC, so the server
// and the browser draw the same page; at worst a period starts a few hours early or late.
import type { DailyNumbers } from './model';
import { type Period, type Scope, periodStart } from './scope';

const DAY_MS = 86_400_000;

/** The calendar day of `ms`, in UTC (`YYYY-MM-DD`). */
export function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The day after `day`. */
function nextDay(day: string): string {
  return isoDay(Date.parse(`${day}T00:00:00Z`) + DAY_MS);
}

/** The first day of the period at `now`, or null for all time. */
export function firstDay(period: Period, now: number): string | null {
  const start = periodStart(period, now);
  return start === null ? null : isoDay(start);
}

/** The days on the chosen account within the period, oldest first. */
export function daysInScope(days: readonly DailyNumbers[], scope: Scope, now: number): DailyNumbers[] {
  const first = firstDay(scope.period, now);
  return days
    .filter((d) => (scope.account === null || d.xHandle === scope.account) && (first === null || d.day >= first))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/** The days of the period just before, as long as the chosen one; none for all time. */
export function daysBefore(days: readonly DailyNumbers[], scope: Scope, now: number): DailyNumbers[] {
  const start = periodStart(scope.period, now);
  if (start === null) return [];
  const first = isoDay(start - (now - start));
  const end = isoDay(start);
  return days
    .filter((d) => (scope.account === null || d.xHandle === scope.account) && d.day >= first && d.day < end)
    .sort((a, b) => a.day.localeCompare(b.day));
}

/** A figure and the same figure in the period before; null where there is nothing to say. */
export interface Figure {
  value: number | null;
  previous: number | null;
}

/** Overview's figures from the daily numbers. */
export interface OverviewFigures {
  /** The latest follower count, summed over the accounts in scope; previous: the latest before the period. */
  followers: Figure;
  /** Posts and quotes published. */
  posts: Figure;
  /** Likes and replies received: estimates, from the posts Xomoni saw. */
  likesReceived: Figure;
  repliesReceived: Figure;
  /** Likes, replies, reposts and quotes received per 100 views; null without views. */
  engagementRate: Figure;
  /** Own posts Xomoni saw in the period: how complete *received* is. */
  observedPosts: number;
  /** When Xomoni last sent a day in scope (ISO 8601), or null. */
  updatedAt: string | null;
}

/** The last follower count each account had in `days`, summed; null when none was seen. */
function latestFollowers(days: readonly DailyNumbers[]): number | null {
  const last = new Map<string, number>();
  for (const d of days) if (d.followers !== null) last.set(d.xHandle, d.followers);
  return last.size === 0 ? null : [...last.values()].reduce((a, b) => a + b, 0);
}

function sum(days: readonly DailyNumbers[], pick: (d: DailyNumbers) => number): number | null {
  return days.length === 0 ? null : days.reduce((total, d) => total + pick(d), 0);
}

function rate(days: readonly DailyNumbers[]): number | null {
  const views = days.reduce((total, d) => total + d.receivedViews, 0);
  if (views === 0) return null;
  const engaged = days.reduce(
    (total, d) => total + d.receivedLikes + d.receivedReplies + d.receivedReposts + d.receivedQuotes,
    0,
  );
  return (engaged / views) * 100;
}

/** Overview's figures for `current` days, against `previous` ones. */
export function overviewFigures(current: readonly DailyNumbers[], previous: readonly DailyNumbers[]): OverviewFigures {
  const posts = (d: DailyNumbers) => d.postedPosts + d.postedQuotes;
  return {
    followers: { value: latestFollowers(current), previous: latestFollowers(previous) },
    posts: { value: sum(current, posts), previous: sum(previous, posts) },
    likesReceived: { value: sum(current, (d) => d.receivedLikes), previous: sum(previous, (d) => d.receivedLikes) },
    repliesReceived: {
      value: sum(current, (d) => d.receivedReplies),
      previous: sum(previous, (d) => d.receivedReplies),
    },
    engagementRate: { value: rate(current), previous: rate(previous) },
    observedPosts: current.reduce((total, d) => total + d.observedPosts, 0),
    updatedAt: current.reduce<string | null>(
      (latest, d) => (latest && latest > d.updatedAt ? latest : d.updatedAt),
      null,
    ),
  };
}

/** How a figure moved against the period before: the change and, where it means something, the percentage. */
export function change(figure: Figure): { change: number; percent: number | null } | null {
  if (figure.value === null || figure.previous === null) return null;
  const diff = figure.value - figure.previous;
  return { change: diff, percent: figure.previous === 0 ? null : (diff / figure.previous) * 100 };
}

/** One day of a series; `value` is null on a day with no numbers (a gap, not a zero). */
export interface SeriesPoint {
  day: string;
  value: number | null;
}

/** Every day from `first` to `last`, inclusive. */
function eachDay(first: string, last: string): string[] {
  const out: string[] = [];
  for (let day = first; day <= last && out.length <= 4000; day = nextDay(day)) out.push(day);
  return out;
}

/** The range a chart covers: the period's first day (or the first day with numbers) to the last one shown. */
function range(days: readonly DailyNumbers[], scope: Scope, now: number): [string, string] | null {
  const earliest = days[0]?.day;
  const latest = days.at(-1)?.day;
  if (earliest === undefined || latest === undefined) return null;
  const today = isoDay(now);
  return [firstDay(scope.period, now) ?? earliest, today > latest ? today : latest];
}

/**
 * Followers each day of the period, summed over the accounts in scope. A day counts only when every account in
 * scope has a count that day, so a missing account never looks like a loss.
 */
export function followersSeries(days: readonly DailyNumbers[], scope: Scope, now: number): SeriesPoint[] {
  const span = range(days, scope, now);
  if (!span) return [];
  const handles = new Set(days.map((d) => d.xHandle));
  const byDay = new Map<string, Map<string, number>>();
  for (const d of days) {
    if (d.followers === null) continue;
    const counts = byDay.get(d.day) ?? new Map<string, number>();
    counts.set(d.xHandle, d.followers);
    byDay.set(d.day, counts);
  }
  return eachDay(...span).map((day) => {
    const counts = byDay.get(day);
    return {
      day,
      value: counts?.size === handles.size ? [...counts.values()].reduce((a, b) => a + b, 0) : null,
    };
  });
}

/** What was published each day of the period (posts, replies, reposts and quotes); null on a day with no numbers. */
export function publishedSeries(days: readonly DailyNumbers[], scope: Scope, now: number): SeriesPoint[] {
  const span = range(days, scope, now);
  if (!span) return [];
  const byDay = new Map<string, number>();
  for (const d of days) {
    byDay.set(d.day, (byDay.get(d.day) ?? 0) + d.postedPosts + d.postedReplies + d.postedReposts + d.postedQuotes);
  }
  return eachDay(...span).map((day) => ({ day, value: byDay.get(day) ?? null }));
}

/**
 * Accounts followed each day of the period, summed over the accounts in scope; like `followersSeries`, a day counts
 * only when every account in scope has a count (#253).
 */
export function followingSeries(days: readonly DailyNumbers[], scope: Scope, now: number): SeriesPoint[] {
  return followersSeries(
    days.map((d) => ({ ...d, followers: d.following })),
    scope,
    now,
  );
}

/**
 * Followers gained (positive) or lost (negative) each day: the change from the last day with a count before it. A day
 * after a gap carries the whole change since the last count; the first count, and days without one, have none.
 */
export function netChanges(series: readonly SeriesPoint[]): SeriesPoint[] {
  let last: number | null = null;
  return series.map((p) => {
    if (p.value === null) return { day: p.day, value: null };
    const value = last === null ? null : p.value - last;
    last = p.value;
    return { day: p.day, value };
  });
}

/** Round follower counts worth marking, ascending. */
const MILESTONES = [100, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];

/** Each round count crossed upward within the series, and the day it was first reached. */
export function milestones(series: readonly SeriesPoint[]): { count: number; day: string }[] {
  const reached: { count: number; day: string }[] = [];
  let last: number | null = null;
  for (const p of series) {
    if (p.value === null) continue;
    if (last !== null) {
      for (const m of MILESTONES) {
        // Only the first time: dipping under a count and back over it is not a new milestone.
        if (last < m && p.value >= m && !reached.some((r) => r.count === m)) reached.push({ count: m, day: p.day });
      }
    }
    last = p.value;
  }
  return reached;
}

/** Audience's figures for a period: where followers stand, how they moved, and the ratio to accounts followed. */
export interface AudienceFigures {
  /** The latest follower and following counts, summed over the accounts in scope; null when none was seen. */
  followers: number | null;
  following: number | null;
  /** Followers gained minus lost over the days with a change; null without two counts. */
  net: number | null;
  /** Total gained and lost on the days that went up or down. */
  gained: number;
  lost: number;
  /** The day with the largest gain, and with the largest loss, if any. */
  bestDay: SeriesPoint | null;
  worstDay: SeriesPoint | null;
  /** Followers per account followed; null without both counts or with no one followed. */
  ratio: number | null;
}

/** Audience's figures from the period's days and their followers series. */
export function audienceFigures(days: readonly DailyNumbers[], followers: readonly SeriesPoint[]): AudienceFigures {
  const latest = (pick: (d: DailyNumbers) => number | null) => {
    const last = new Map<string, number>();
    for (const d of days) {
      const v = pick(d);
      if (v !== null) last.set(d.xHandle, v);
    }
    return last.size === 0 ? null : [...last.values()].reduce((a, b) => a + b, 0);
  };
  const changes = netChanges(followers).filter((p): p is { day: string; value: number } => p.value !== null);
  const gained = changes.reduce((sum, p) => sum + Math.max(0, p.value), 0);
  const lost = changes.reduce((sum, p) => sum + Math.max(0, -p.value), 0);
  const best = changes.reduce<SeriesPoint | null>((b, p) => (p.value > 0 && (b?.value ?? 0) < p.value ? p : b), null);
  const worst = changes.reduce<SeriesPoint | null>((w, p) => (p.value < 0 && (w?.value ?? 0) > p.value ? p : w), null);
  const followerCount = latest((d) => d.followers);
  const followingCount = latest((d) => d.following);
  return {
    followers: followerCount,
    following: followingCount,
    net: changes.length === 0 ? null : gained - lost,
    gained,
    lost,
    bestDay: best,
    worstDay: worst,
    ratio: followerCount === null || !followingCount ? null : followerCount / followingCount,
  };
}

/** The next round count above `followers`, and how many more it takes; null past the last one. */
export function nextMilestone(followers: number): { count: number; toGo: number } | null {
  const next = MILESTONES.find((m) => m > followers);
  return next === undefined ? null : { count: next, toGo: next - followers };
}

/** What the person publishes, by type (#254). */
export type ContentType = 'posts' | 'replies' | 'reposts' | 'quotes';

/** The types in the order the Content place shows them. */
export const CONTENT_TYPES: readonly { id: ContentType; label: string }[] = [
  { id: 'posts', label: 'Posts' },
  { id: 'replies', label: 'Replies' },
  { id: 'reposts', label: 'Reposts' },
  { id: 'quotes', label: 'Quotes' },
];

/** One day's publishing by type; null on a day with no numbers. */
export interface TypedPoint {
  day: string;
  values: Record<ContentType, number> | null;
}

function typed(d: DailyNumbers): Record<ContentType, number> {
  return { posts: d.postedPosts, replies: d.postedReplies, reposts: d.postedReposts, quotes: d.postedQuotes };
}

/** What was published each day of the period, by type, summed over the accounts in scope. */
export function publishedByType(days: readonly DailyNumbers[], scope: Scope, now: number): TypedPoint[] {
  const span = range(days, scope, now);
  if (!span) return [];
  const byDay = new Map<string, Record<ContentType, number>>();
  for (const d of days) {
    const sum = byDay.get(d.day) ?? { posts: 0, replies: 0, reposts: 0, quotes: 0 };
    const add = typed(d);
    for (const t of CONTENT_TYPES) sum[t.id] += add[t.id];
    byDay.set(d.day, sum);
  }
  return eachDay(...span).map((day) => ({ day, values: byDay.get(day) ?? null }));
}

/** The Content place's figures: each type published in the period, against the period before. */
export function contentFigures(
  current: readonly DailyNumbers[],
  previous: readonly DailyNumbers[],
): Record<ContentType, Figure> {
  const out = {} as Record<ContentType, Figure>;
  for (const t of CONTENT_TYPES) {
    out[t.id] = {
      value: sum(current, (d) => typed(d)[t.id]),
      previous: sum(previous, (d) => typed(d)[t.id]),
    };
  }
  return out;
}

/** The days of the week, Monday first. */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/**
 * How much the person publishes on each day of the week, on average over the days with numbers, Monday first; null for
 * a weekday with no day of numbers. `best` is the weekday with the highest average, if any day had a post.
 */
export function weekdayAverages(days: readonly DailyNumbers[]): { averages: (number | null)[]; best: number | null } {
  const totals = new Map<string, number>();
  for (const d of days) {
    const t = typed(d);
    totals.set(d.day, (totals.get(d.day) ?? 0) + t.posts + t.replies + t.reposts + t.quotes);
  }
  const sums = Array<number>(7).fill(0);
  const counts = Array<number>(7).fill(0);
  for (const [day, total] of totals) {
    const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
    sums[weekday] = (sums[weekday] ?? 0) + total;
    counts[weekday] = (counts[weekday] ?? 0) + 1;
  }
  const averages = sums.map((s, i) => ((counts[i] ?? 0) === 0 ? null : s / (counts[i] ?? 1)));
  let best: number | null = null;
  averages.forEach((a, i) => {
    if (a !== null && a > 0 && (best === null || a > (averages[best] ?? 0))) best = i;
  });
  return { averages, best };
}
