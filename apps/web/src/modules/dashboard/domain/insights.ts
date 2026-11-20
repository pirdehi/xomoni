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
