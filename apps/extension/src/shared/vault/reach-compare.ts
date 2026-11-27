// The comparisons of the Reach page (#429, ADR-0045, point 2): posts with a link against posts without, photos or
// videos against text, and before Premium against after, each honest about its size, with what can mislead it; and the
// usual reach by day of the week and time of day. They show what goes together, never why. Pure.
import type { PremiumPeriod } from './reach';
import { type Comparison, type CompareOptions, MIN_GROUP, compareGroups, isSettled, median } from './reach-stats';

const DAY_MS = 86_400_000;

/** How far each side of the Premium comparison reaches: 8 weeks. */
export const PREMIUM_SIDE_DAYS = 56;

/** The days after Premium starts that neither side counts: X's change may take a while to show. */
export const PREMIUM_TRANSITION_DAYS = 7;

/** What a comparison needs of a post: `reach.ts`'s `ReachPost` has it. */
export interface ComparedPost {
  id: string;
  createdAt: number;
  kind: 'post' | 'reply';
  impressions: number | null;
  ageAtAsOfDays: number | null;
  links: number | null;
  media: number | null;
  hour: number;
  weekday: number;
  followersAtTime: number | null;
}

/** The comparisons the page shows. */
export type ComparisonId = 'links' | 'media' | 'premium';

/** One comparison: its two groups, the result, and what can mislead it. */
export interface ReachComparison {
  id: ComparisonId;
  /** What it compares, in words. */
  title: string;
  /** Each group's name: the first is the one the ratio is about. */
  groups: readonly [string, string];
  /** Each group in a sentence: "posts with a link were seen 52% as much as posts without". */
  subjects: readonly [string, string];
  result: Comparison;
  /** The median followers when each group's posts were made; null when not known. */
  followers: readonly [number | null, number | null];
  /** What can make the comparison mislead, in words (ADR-0045, point 2). */
  misleads: string[];
  /**
   * Premium only: Xomoni doesn't know when the account got Premium, so the page asks the person (`PremiumDateDialog`).
   */
  needsDate?: boolean;
}

/** The person's own posts, settled, with their impressions: what every comparison draws from. Replies are left out. */
function settledPosts(posts: readonly ComparedPost[]) {
  return posts.filter(
    (p): p is ComparedPost & { impressions: number } =>
      p.kind === 'post' &&
      isSettled({
        id: p.id,
        createdAt: p.createdAt,
        impressions: p.impressions,
        format: 'text',
        ageAtAsOfDays: p.ageAtAsOfDays,
      }),
  );
}

/** The median of the known followers of `posts`, rounded; null without any. */
function followersOf(posts: readonly ComparedPost[]): number | null {
  const known = posts.flatMap((p) => (p.followersAtTime === null ? [] : [p.followersAtTime]));
  const middle = median(known);
  return middle === null ? null : Math.round(middle);
}

/** The words every comparison carries about what can mislead it. */
function misleadsOf(followers: readonly [number | null, number | null]): string[] {
  const [a, b] = followers;
  return [
    'When you posted: the hour and the day may differ between the groups.',
    "What the posts were about: Xomoni doesn't read your posts' subjects.",
    a !== null && b !== null
      ? `Your followers: about ${a.toLocaleString('en-US')} for the first group's posts and ${b.toLocaleString('en-US')} for the second's.`
      : "Your followers over the period: Xomoni didn't see them for every post.",
    'How old the posts are: each is counted once 7 days old, but an older post had longer to be seen.',
  ];
}

/** A comparison of `a` with `b`, named and with what can mislead it. */
function comparison(
  id: ComparisonId,
  title: string,
  groups: readonly [string, string],
  subjects: readonly [string, string],
  a: readonly (ComparedPost & { impressions: number })[],
  b: readonly (ComparedPost & { impressions: number })[],
  options: CompareOptions,
): ReachComparison {
  const followers = [followersOf(a), followersOf(b)] as const;
  return {
    id,
    title,
    groups,
    subjects,
    result: compareGroups(
      a.map((p) => p.impressions),
      b.map((p) => p.impressions),
      options,
    ),
    followers,
    misleads: misleadsOf(followers),
  };
}

/**
 * The page's three comparisons of the person's settled posts (replies left out), each with `compareGroups`:
 * - **links**: posts with a link out of X against posts without one (both known);
 * - **media**: posts with photos or videos and no link against text-only posts;
 * - **premium**: the 8 weeks before the account got Premium against the 8 weeks after, leaving out the 7 days after it
 *   started. It needs a start Xomoni knows (`PremiumPeriod.from`), the latest; without one it is *not enough data*
 *   and asks for the date (`needsDate`).
 */
export function reachComparisons(
  posts: readonly ComparedPost[],
  periods: readonly PremiumPeriod[],
  options: CompareOptions = {},
): ReachComparison[] {
  const settled = settledPosts(posts);
  const known = settled.filter((p) => p.links !== null && p.media !== null);
  const links = comparison(
    'links',
    'Posts with a link, against posts without',
    ['With a link', 'Without'],
    ['posts with a link', 'posts without'],
    known.filter((p) => (p.links ?? 0) > 0),
    known.filter((p) => p.links === 0),
    options,
  );
  const media = comparison(
    'media',
    'Posts with photos or videos, against text only',
    ['With photos or videos', 'Text only'],
    ['posts with photos or videos', 'text-only posts'],
    known.filter((p) => p.links === 0 && (p.media ?? 0) > 0),
    known.filter((p) => p.links === 0 && p.media === 0),
    options,
  );
  // The latest known start, without spreading the spans into `Math.max`'s arguments: any number of them works.
  const start = periods.reduce((latest, p) => (p.from === null ? latest : Math.max(latest, p.from)), -Infinity);
  const before = Number.isFinite(start)
    ? settled.filter((p) => p.createdAt >= start - PREMIUM_SIDE_DAYS * DAY_MS && p.createdAt < start)
    : [];
  const afterFrom = start + PREMIUM_TRANSITION_DAYS * DAY_MS;
  const after = Number.isFinite(start)
    ? settled.filter((p) => p.createdAt >= afterFrom && p.createdAt < afterFrom + PREMIUM_SIDE_DAYS * DAY_MS)
    : [];
  const premium = comparison(
    'premium',
    'With Premium, against before it',
    ['With Premium', 'Before'],
    ['posts with Premium', 'posts before it'],
    after,
    before,
    options,
  );
  return [links, media, Number.isFinite(start) ? premium : { ...premium, needsDate: true }];
}

/** One number's 64 bits, as two 32-bit words, for `comparedKey`. */
const NUMBER = new Float64Array(1);
const WORDS = new Uint32Array(NUMBER.buffer);

/**
 * A key that changes whenever anything `reachComparisons` or `reachByTime` reads changes: the settled posts (replies
 * left out), each one's time, hour, day, impressions, links, media and followers, and the Premium spans' starts. Rows
 * that are new copies of the same posts, or posts that changed in what neither reads (whether one is still on X, its
 * text, a reply, a post still growing), give the same key, so the page computes the comparisons again only when they
 * can change (#497). One pass over the posts, a 64-bit hash: far cheaper than one of the 2,000 resamples.
 */
export function comparedKey(posts: readonly ComparedPost[], periods: readonly PremiumPeriod[]): string {
  let [h1, h2] = [0xdeadbeef, 0x41c6ce57];
  const mix = (value: number | null) => {
    NUMBER[0] = value ?? Number.NaN;
    for (const word of WORDS) {
      h1 = Math.imul(h1 ^ word, 2_654_435_761);
      h2 = Math.imul(h2 ^ word, 1_597_334_677);
    }
  };
  const settled = settledPosts(posts);
  for (const p of settled) {
    for (const value of [p.createdAt, p.impressions, p.links, p.media, p.hour, p.weekday, p.followersAtTime])
      mix(value);
  }
  for (const p of periods) mix(p.from);
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2_246_822_507) ^ Math.imul(h2 ^ (h2 >>> 13), 3_266_489_909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2_246_822_507) ^ Math.imul(h1 ^ (h1 >>> 13), 3_266_489_909);
  return [settled.length, periods.length, h1 >>> 0, h2 >>> 0].map((n) => n.toString(36)).join(':');
}

/** A cell of the day and time table: how many settled posts, and their median when there are enough. */
export interface TimeCell {
  n: number;
  /** Null below `MIN_GROUP` posts: *not enough data*. */
  median: number | null;
}

/** The times of day the table groups hours into, in the person's time zone. */
export const DAY_PARTS: readonly { label: string; from: number; to: number }[] = [
  { label: 'Night (0–6)', from: 0, to: 6 },
  { label: 'Morning (6–12)', from: 6, to: 12 },
  { label: 'Afternoon (12–18)', from: 12, to: 18 },
  { label: 'Evening (18–24)', from: 18, to: 24 },
];

/** The days of the week, Monday first, by `Date`'s number (0 Sunday). */
export const WEEKDAYS: readonly { label: string; day: number }[] = [
  { label: 'Monday', day: 1 },
  { label: 'Tuesday', day: 2 },
  { label: 'Wednesday', day: 3 },
  { label: 'Thursday', day: 4 },
  { label: 'Friday', day: 5 },
  { label: 'Saturday', day: 6 },
  { label: 'Sunday', day: 0 },
];

/**
 * The usual reach of the person's settled posts by day of the week and by time of day: each cell's count, and its
 * median once it has `MIN_GROUP` (15) posts. A table, not a verdict: the days and hours aren't compared with one another.
 */
export function reachByTime(posts: readonly ComparedPost[]): { days: TimeCell[]; parts: TimeCell[] } {
  const settled = settledPosts(posts);
  const cell = (group: readonly { impressions: number }[]): TimeCell => ({
    n: group.length,
    median: group.length >= MIN_GROUP ? median(group.map((p) => p.impressions)) : null,
  });
  return {
    days: WEEKDAYS.map(({ day }) => cell(settled.filter((p) => p.weekday === day))),
    parts: DAY_PARTS.map(({ from, to }) => cell(settled.filter((p) => p.hour >= from && p.hour < to))),
  };
}
