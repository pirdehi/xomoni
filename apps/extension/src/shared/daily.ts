// Daily numbers (#249, ADR-0026): one row per X account per local calendar day, made only of counts, from what X
// already sends to this browser. Xomoni never asks X for them. Pure: the store (`db.ts`) and the service worker feed it
// observations; nothing here reads the clock.
//
// - The profile's counts are the last ones X showed that day.
// - *Received* is an estimate: the increases Xomoni saw in the counts of the person's own posts and replies between two
//   sightings. A post's first sighting adds nothing (its counts may be years old), and a count that went down adds
//   nothing (an unlike is not a negative like). `observedPosts` says how many own posts were seen that day, so a page
//   can say how complete the estimate is.
// - *Published* and *removed* aren't stored here: they are exact, from the inventory and the activity log, and are
//   counted when a day's row is read (`withPublishedAndRemoved`).
import type { Item, ItemKind } from './types';

/** A local calendar day, `YYYY-MM-DD`. */
export type Day = string;

/** What Xomoni recorded for one X account on one local day. Every number is a whole number of 0 or more. */
export interface DailyStats {
  accountId: string;
  day: Day;
  /** The profile's counts as X last showed them that day; null when no profile was seen that day. */
  followers: number | null;
  following: number | null;
  postsTotal: number | null;
  likesTotal: number | null;
  /** Increases seen that day in the counts of the person's own posts and replies (an estimate). */
  receivedLikes: number;
  receivedReplies: number;
  receivedReposts: number;
  receivedQuotes: number;
  receivedViews: number;
  /** How many of the person's own posts and replies were seen that day. */
  observedPosts: number;
  /** Own posts, and own replies, seen that day with at least one like. */
  postsWithLikes: number;
  repliesWithLikes: number;
  /** When the row last changed (epoch ms). */
  updatedAt: number;
}

/** The counts of a row that observations add to. */
export type DailyDelta = Pick<
  DailyStats,
  | 'receivedLikes'
  | 'receivedReplies'
  | 'receivedReposts'
  | 'receivedQuotes'
  | 'receivedViews'
  | 'observedPosts'
  | 'postsWithLikes'
  | 'repliesWithLikes'
>;

/** A delta of nothing. */
export const NO_DELTA: Readonly<DailyDelta> = {
  receivedLikes: 0,
  receivedReplies: 0,
  receivedReposts: 0,
  receivedQuotes: 0,
  receivedViews: 0,
  observedPosts: 0,
  postsWithLikes: 0,
  repliesWithLikes: 0,
};

const pad = (n: number) => String(n).padStart(2, '0');

/** The local calendar day of `ms`, on this computer's clock and time zone. */
export function localDay(ms: number): Day {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** An empty row for `accountId` on `day`. */
export function emptyDay(accountId: string, day: Day, at: number): DailyStats {
  return {
    accountId,
    day,
    followers: null,
    following: null,
    postsTotal: null,
    likesTotal: null,
    ...NO_DELTA,
    updatedAt: at,
  };
}

/** Kinds whose counts are the person's own: a repost's and a like's counts belong to someone else's post. */
const OWN: ReadonlySet<ItemKind> = new Set(['post', 'reply']);

/** How much a count went up, never less than 0; nothing when either side is unknown. */
function rise(before: number | undefined, after: number | undefined): number {
  if (before === undefined || after === undefined) return 0;
  return Math.max(0, after - before);
}

/**
 * What one live sighting of an item adds to the day it was seen on: the rise in its counts since it was last seen, and
 * whether it counts as observed, or as liked, for the first time that day. `prev` is the item as stored before this
 * sighting (undefined for one never stored), `next` as stored after it. Nothing for someone else's post, for an item
 * only known from the archive until now, or for a sighting on an earlier day than the last one.
 */
export function sightingDelta(prev: Item | undefined, next: Item, observedAt: number): DailyDelta {
  if (!OWN.has(next.kind)) return NO_DELTA;
  const day = localDay(observedAt);
  const seenBefore = prev !== undefined && prev.seenAt > 0;
  if (seenBefore && prev.seenAt > observedAt) return NO_DELTA;
  const firstToday = !seenBefore || localDay(prev.seenAt) !== day;
  const likedNow = next.likes > 0;
  // Liked for the first time today: at its first sighting today, or when its first like came later that day.
  const newlyLiked = likedNow && (firstToday || prev.likes === 0);
  return {
    receivedLikes: seenBefore ? rise(prev.likes, next.likes) : 0,
    receivedReplies: seenBefore ? rise(prev.replies, next.replies) : 0,
    receivedReposts: seenBefore ? rise(prev.reposts, next.reposts) : 0,
    receivedQuotes: seenBefore ? rise(prev.quotes, next.quotes) : 0,
    receivedViews: seenBefore ? rise(prev.views, next.views) : 0,
    observedPosts: firstToday ? 1 : 0,
    postsWithLikes: newlyLiked && next.kind === 'post' ? 1 : 0,
    repliesWithLikes: newlyLiked && next.kind === 'reply' ? 1 : 0,
  };
}

/** Whether a delta adds anything. */
export function isEmptyDelta(delta: DailyDelta): boolean {
  return Object.values(delta).every((n) => n === 0);
}

const DELTA_KEYS = Object.keys(NO_DELTA) as (keyof DailyDelta)[];

/** The sum of `deltas`. */
export function sumDeltas(deltas: readonly DailyDelta[]): DailyDelta {
  const sum = { ...NO_DELTA };
  for (const delta of deltas) for (const key of DELTA_KEYS) sum[key] += delta[key];
  return sum;
}

/** `row` with `delta` added. */
export function addDelta(row: DailyStats, delta: DailyDelta, at: number): DailyStats {
  const next = { ...row, updatedAt: at };
  for (const key of DELTA_KEYS) next[key] = row[key] + delta[key];
  return next;
}

/** The profile counts X showed, null where it didn't say. */
export interface ProfileCounts {
  followers: number | null;
  following: number | null;
  postsCount: number | null;
  likesCount: number | null;
}

/** `row` with the profile's counts as X showed them at `at`; a count X left out keeps the day's earlier value. */
export function withProfile(row: DailyStats, profile: ProfileCounts, at: number): DailyStats {
  return {
    ...row,
    followers: profile.followers ?? row.followers,
    following: profile.following ?? row.following,
    postsTotal: profile.postsCount ?? row.postsTotal,
    likesTotal: profile.likesCount ?? row.likesTotal,
    updatedAt: at,
  };
}

/** What the person published, and what Xomoni removed, on one day: exact, from the inventory and the log. */
export interface PublishedAndRemoved {
  postedPosts: number;
  postedReplies: number;
  postedReposts: number;
  postedQuotes: number;
  removedPosts: number;
  removedReplies: number;
  removedReposts: number;
  removedLikes: number;
}

/** One day as a page or a report reads it: the recorded counts with what was published and removed. */
export type DailyRow = DailyStats & PublishedAndRemoved;

/** Nothing published and nothing removed. */
export const NONE_PUBLISHED: Readonly<PublishedAndRemoved> = {
  postedPosts: 0,
  postedReplies: 0,
  postedReposts: 0,
  postedQuotes: 0,
  removedPosts: 0,
  removedReplies: 0,
  removedReposts: 0,
  removedLikes: 0,
};

/** The inventory's own items, by what counts as published. A quote is a post that quotes another. */
export interface PublishedItem {
  kind: ItemKind;
  createdAt: number;
  quote?: boolean;
}

/** A removal Xomoni made, from the log: the kind of item and when. */
export interface Removal {
  kind: ItemKind;
  at: number;
}

/**
 * Days with their recorded counts, and what was published and removed on each, oldest first. A day with only a
 * recorded row, or with only publishing or removals, is listed; a day with none of them is not (a gap, not zeros).
 */
export function withPublishedAndRemoved(
  accountId: string,
  stored: readonly DailyStats[],
  published: readonly PublishedItem[],
  removals: readonly Removal[],
  at: number,
): DailyRow[] {
  const days = new Map<Day, DailyRow>();
  const row = (day: Day) => {
    let r = days.get(day);
    if (!r) {
      r = { ...emptyDay(accountId, day, at), ...NONE_PUBLISHED };
      days.set(day, r);
    }
    return r;
  };
  for (const s of stored) days.set(s.day, { ...NONE_PUBLISHED, ...s });
  for (const p of published) {
    const r = row(localDay(p.createdAt));
    if (p.kind === 'post' && p.quote) r.postedQuotes++;
    else if (p.kind === 'post') r.postedPosts++;
    else if (p.kind === 'reply') r.postedReplies++;
    else if (p.kind === 'repost') r.postedReposts++;
  }
  for (const removal of removals) {
    const r = row(localDay(removal.at));
    if (removal.kind === 'post') r.removedPosts++;
    else if (removal.kind === 'reply') r.removedReplies++;
    else if (removal.kind === 'repost') r.removedReposts++;
    else r.removedLikes++;
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}
