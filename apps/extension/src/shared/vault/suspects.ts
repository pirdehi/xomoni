// Suspected posts (#429, ADR-0045, point 4): for a month in which X's *Under the hood* file says it applied a label to
// n of the person's posts, the posts of that month furthest below their baseline, as a guess. X never says which posts
// got a label, so every candidate is a guess and says so, with the reason it was picked; its confidence is low or
// medium, never high; the person can dismiss it; and nothing here links to a cleanup. Pure.
import { type LabelMonth, monthName, utcMonth } from './under-the-hood';
import { type ReachFormat, type ReachSample, baseline, isSettled, vsBaseline } from './reach-stats';

/** The words every candidate carries, in a box that can't be hidden (ADR-0045, point 4). */
export const GUESS_NOTICE = "This is a guess. X doesn't say which posts got a label.";

/** A candidate is below this share of its baseline: under half. */
export const SUSPECT_BELOW = 0.5;

/** The most candidates for one label in one month, whatever n is. */
export const MAX_SUSPECTS = 10;

/** A month needs this many comparable posts before a guess can be *medium*. */
export const MEDIUM_MIN_POSTS = 20;

/** How sure a guess is. Never *high*: X doesn't say which posts got a label. */
export type SuspectConfidence = 'low' | 'medium';

/** The most candidates for a label X applied to `n` posts: min(3n, 10). */
export function maxSuspects(n: number): number {
  return Math.max(0, Math.min(3 * n, MAX_SUSPECTS));
}

/** One suspected post: a guess, with the numbers behind it and the reasons in words. */
export interface Suspect {
  id: string;
  createdAt: number;
  impressions: number;
  /** Its baseline: the median of the same format's posts in the 8 weeks before it. */
  baseline: number;
  /** Impressions over baseline: 0.2 is a fifth of it. */
  ratio: number;
  /** Why it was picked, in Xomoni's words. */
  reasons: string[];
  /** Always true: the website and every view mark it as a guess (ADR-0045, point 6). */
  guess: true;
}

/** Why a label's month has no candidate. */
export type SuspectWhy = 'account-label' | 'no-numbers' | 'no-baseline' | 'none-below-half' | 'all-dismissed';

/** What the person reads when there is no guess, for each `SuspectWhy`. */
export const SUSPECT_WHY_WORDS: Readonly<Record<SuspectWhy, string>> = {
  'account-label': 'X applied this label to the account, not to posts, so there are no posts to suggest.',
  'no-numbers':
    "Xomoni has no views for this month's posts. Reach's numbers come from the views X shows on your own posts and replies: open your profile on X, and Xomoni keeps the views it shows. More sources are coming.",
  'no-baseline':
    "This month's posts have too few earlier posts of the same kind to compare with (15 in the 8 weeks before each).",
  'none-below-half': 'No post of this month was seen less than half as much as usual, so Xomoni suggests none.',
  'all-dismissed': 'You dismissed every suggestion for this label.',
};

/** One label of one month, and the posts Xomoni guesses it may have touched. */
export interface SuspectLabel {
  /** `yyyy-mm`. */
  month: string;
  /** X's name for the label. */
  label: string;
  /** How many posts X says it applied the label to that month. */
  n: number;
  /** The candidates, furthest below their baseline first; empty with `why`. */
  candidates: Suspect[];
  /** How sure the guess is; null without candidates. */
  confidence: SuspectConfidence | null;
  /** Why there are no candidates; null with them. */
  why: SuspectWhy | null;
}

/** What `suspectPosts` needs of a post: `reach.ts`'s `ReachPost` has it. */
export type SuspectInput = ReachSample & { format: ReachFormat };

/** The words of a format in a reason. */
const FORMAT_WORDS: Readonly<Record<ReachFormat, string>> = {
  text: 'text posts',
  link: 'posts with a link',
  media: 'posts with photos or videos',
  reply: 'replies',
  unknown: 'posts',
};

/** A whole number with thousands separators, the same on every computer. */
const whole = (n: number) => Math.round(n).toLocaleString('en-US');

/** The reasons a candidate was picked. */
function reasonsFor(post: SuspectInput, base: number, ratio: number, label: string, n: number, month: string) {
  const share = Math.max(1, Math.round(ratio * 100));
  return [
    `Seen ${whole(post.impressions ?? 0)} times: ${share}% of your usual ${whole(base)} for ${FORMAT_WORDS[post.format]}, the median of the 8 weeks before it.`,
    `Posted in ${monthName(month)}, when X says it applied ${label} to ${n} ${n === 1 ? 'post' : 'posts'}.`,
  ];
}

/**
 * The suspected posts of each post label of each month (ADR-0045, point 4). For a label X applied to n posts in a month,
 * the candidates are that month's settled posts (UTC, as X's periods are) under half their baseline, lowest first, at
 * most min(3n, 10); a dismissed one is left out, without another taking its place. The guess is *medium* only when the
 * month has at least 20 comparable posts and the n lowest are at most half the lowest of the others; else *low*. A
 * label on the account, or a month without numbers or baselines, gets no candidate and says why. `bases` are the posts'
 * baselines, from `posts` themselves unless given: the Reach page gives those it computed from the 8 weeks before its
 * period too.
 */
export function suspectPosts(
  posts: readonly SuspectInput[],
  months: readonly LabelMonth[],
  dismissed: ReadonlySet<string> = new Set(),
  bases: ReadonlyMap<string, number | null> = baseline(posts),
): SuspectLabel[] {
  const byMonth = new Map<string, SuspectInput[]>();
  for (const post of posts) {
    const month = utcMonth(post.createdAt);
    const list = byMonth.get(month);
    if (list) list.push(post);
    else byMonth.set(month, [post]);
  }
  const out: SuspectLabel[] = [];
  for (const month of [...months].sort((a, b) => b.month.localeCompare(a.month))) {
    const inMonth = byMonth.get(month.month) ?? [];
    const numbered = inMonth.filter(isSettled);
    const compared = numbered.flatMap((post) => {
      const base = bases.get(post.id) ?? null;
      const ratio = vsBaseline(post, base);
      return base !== null && ratio !== null ? [{ post, base, ratio }] : [];
    });
    compared.sort((a, b) => a.ratio - b.ratio || a.post.createdAt - b.post.createdAt);
    for (const label of month.labels) {
      if (label.count <= 0) continue;
      const entry = { month: month.month, label: label.name, n: label.count };
      const none = (why: SuspectWhy): SuspectLabel => ({ ...entry, candidates: [], confidence: null, why });
      if (label.scope === 'account') {
        out.push(none('account-label'));
        continue;
      }
      if (!numbered.length) {
        out.push(none('no-numbers'));
        continue;
      }
      if (!compared.length) {
        out.push(none('no-baseline'));
        continue;
      }
      const picked = compared.filter((c) => c.ratio < SUSPECT_BELOW).slice(0, maxSuspects(label.count));
      if (!picked.length) {
        out.push(none('none-below-half'));
        continue;
      }
      const kept = picked.filter((c) => !dismissed.has(c.post.id));
      if (!kept.length) {
        out.push(none('all-dismissed'));
        continue;
      }
      out.push({
        ...entry,
        candidates: kept.map(({ post, base, ratio }) => ({
          id: post.id,
          createdAt: post.createdAt,
          impressions: post.impressions,
          baseline: base,
          ratio,
          reasons: reasonsFor(post, base, ratio, label.name, label.count, month.month),
          guess: true,
        })),
        confidence: confidenceOf(compared, label.count),
        why: null,
      });
    }
  }
  return out;
}

/**
 * *Medium* when the month has at least `MEDIUM_MIN_POSTS` comparable posts, and its n lowest (by share of baseline)
 * are at most half the lowest of the others: they stand apart. *Low* otherwise.
 */
function confidenceOf(compared: readonly { ratio: number }[], n: number): SuspectConfidence {
  if (compared.length < MEDIUM_MIN_POSTS || compared.length <= n) return 'low';
  const lowest = compared[n - 1]?.ratio;
  const next = compared[n]?.ratio;
  if (lowest === undefined || next === undefined) return 'low';
  return lowest * 2 <= next ? 'medium' : 'low';
}
