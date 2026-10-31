/**
 * The one rule for every limit X announces: Xomoni uses at most one fifth of it (ADR-0012).
 *
 * This file is the single source of truth. It lists each limit X publishes, with where X publishes it and
 * when it was last checked, and derives every allowance from those numbers, so nothing elsewhere hard-codes a
 * cap. The same share applies at run time to the live limits X reports in its `x-rate-limit-*` headers.
 * Pure: no `chrome.*`, DOM or storage.
 */
import { DAY, MINUTE } from './time';
import type { ActionKind, Outcome, PacingRule } from './types';

/** Share of every limit X announces that Xomoni lets itself use. */
export const SAFETY_SHARE = 1 / 5;

/** The most Xomoni may use of a limit X announces: one fifth, rounded down, and never below 1. */
export function share(limit: number): number {
  return Math.max(1, Math.floor(limit * SAFETY_SHARE));
}

const API_RATE_LIMITS = 'https://docs.x.com/x-api/fundamentals/rate-limits';
const HELP_X_LIMITS = 'https://help.x.com/en/rules-and-policies/x-limits';
const CHECKED = '2026-10-31';

/** A limit X publishes: how many requests or actions it allows per window, and where it says so. */
export interface PublishedLimit {
  /** What X limits, in X's terms. */
  label: string;
  /** Requests or actions X allows per window, per account. */
  limit: number;
  /** Window length in ms. */
  windowMs: number;
  /** The page where X publishes the limit. */
  source: string;
  /** Date the source was last checked (YYYY-MM-DD). */
  checked: string;
  /** True for limits on things Xomoni never does (posting, replying); listed for completeness only. */
  neverUsed?: boolean;
}

/**
 * Limits X publishes that bear on what Xomoni does. Per-account (per-user) values. Update a number here,
 * with its source and date, when X changes it; every allowance follows.
 */
export const X_PUBLISHED_LIMITS = {
  deletePost: { label: 'Delete a post', limit: 50, windowMs: 15 * MINUTE, source: API_RATE_LIMITS, checked: CHECKED },
  undoRepost: { label: 'Undo a repost', limit: 50, windowMs: 15 * MINUTE, source: API_RATE_LIMITS, checked: CHECKED },
  unlike15: { label: 'Unlike a post', limit: 50, windowMs: 15 * MINUTE, source: API_RATE_LIMITS, checked: CHECKED },
  unlikeDay: { label: 'Unlike a post', limit: 1000, windowMs: DAY, source: API_RATE_LIMITS, checked: CHECKED },
  like15: { label: 'Like a post', limit: 50, windowMs: 15 * MINUTE, source: API_RATE_LIMITS, checked: CHECKED },
  likeDay: { label: 'Like a post', limit: 1000, windowMs: DAY, source: API_RATE_LIMITS, checked: CHECKED },
  search15: { label: 'Search posts', limit: 300, windowMs: 15 * MINUTE, source: API_RATE_LIMITS, checked: CHECKED },
  userTimeline15: {
    label: 'Read a profile timeline',
    limit: 900,
    windowMs: 15 * MINUTE,
    source: API_RATE_LIMITS,
    checked: CHECKED,
  },
  likedPosts15: {
    label: 'Read liked posts',
    limit: 75,
    windowMs: 15 * MINUTE,
    source: API_RATE_LIMITS,
    checked: CHECKED,
  },
  postLookup15: { label: 'Open a post', limit: 900, windowMs: 15 * MINUTE, source: API_RATE_LIMITS, checked: CHECKED },
  // Creating content. Xomoni never posts or replies; listed so the whole published set is in one place.
  postsDayUnverified: {
    label: 'Original posts (unverified account)',
    limit: 50,
    windowMs: DAY,
    source: HELP_X_LIMITS,
    checked: CHECKED,
    neverUsed: true,
  },
  repliesDayUnverified: {
    label: 'Replies (unverified account)',
    limit: 200,
    windowMs: DAY,
    source: HELP_X_LIMITS,
    checked: CHECKED,
    neverUsed: true,
  },
} as const satisfies Record<string, PublishedLimit>;

/** A quota X keeps for one kind of request, which one or more Xomoni actions spend. */
export type BudgetId =
  'deletePost' | 'undoRepost' | 'unlike' | 'like' | 'search' | 'userTimeline' | 'likedPosts' | 'postLookup';

/** One rolling window Xomoni may use: at most `limit` uses per `windowMs`. */
export interface Allowance {
  /** Uses allowed in any rolling window (already one fifth of X's number). */
  limit: number;
  /** Window length in ms. */
  windowMs: number;
}

/** A budget: X's published windows for it and the GraphQL operations of X's web app that spend it. */
export interface Budget {
  /** What the budget is for, for the dashboard. */
  label: string;
  /** X's published limits for this kind of request. */
  published: readonly PublishedLimit[];
  /** X web app operations that report this budget's live limit in their headers. */
  ops: readonly string[];
}

const L = X_PUBLISHED_LIMITS;

/** Every budget Xomoni spends, keyed by id. */
export const BUDGETS: Record<BudgetId, Budget> = {
  deletePost: { label: 'Delete post', published: [L.deletePost], ops: ['DeleteTweet'] },
  undoRepost: { label: 'Undo repost', published: [L.undoRepost], ops: ['DeleteRetweet'] },
  unlike: { label: 'Unlike', published: [L.unlike15, L.unlikeDay], ops: ['UnfavoriteTweet'] },
  like: { label: 'Like', published: [L.like15, L.likeDay], ops: ['FavoriteTweet'] },
  search: { label: 'Search', published: [L.search15], ops: ['SearchTimeline'] },
  userTimeline: {
    label: 'Profile timeline',
    published: [L.userTimeline15],
    ops: ['UserTweets', 'UserTweetsAndReplies'],
  },
  likedPosts: { label: 'Likes timeline', published: [L.likedPosts15], ops: ['Likes'] },
  postLookup: { label: 'Post page', published: [L.postLookup15], ops: ['TweetDetail'] },
};

/**
 * The budgets each action spends. A ghost-like cleanup (`relike`) likes and then unlikes, so it spends both,
 * and shares the unlike budget with ordinary unlikes. Reads depend on the page: see {@link readBudgetFor}.
 */
export const ACTION_BUDGETS: Record<Exclude<ActionKind, 'read'>, readonly BudgetId[]> = {
  delete: ['deletePost'],
  unretweet: ['undoRepost'],
  unlike: ['unlike'],
  relike: ['like', 'unlike'],
};

/** Xomoni's allowances for a budget: one fifth of each window X publishes for it. */
export function allowances(id: BudgetId): Allowance[] {
  return BUDGETS[id].published.map((p) => ({ limit: share(p.limit), windowMs: p.windowMs }));
}

/** Which read budget loading a worker-tab URL spends, from its path. */
export function readBudgetFor(url: string): BudgetId {
  const path = new URL(url, 'https://x.com').pathname;
  if (path.startsWith('/search')) return 'search';
  if (/^\/[^/]+\/status\/\d+/.test(path)) return 'postLookup';
  if (/^\/[^/]+\/likes\/?$/.test(path)) return 'likedPosts';
  return 'userTimeline';
}

/**
 * The earliest time one more use fits every allowance, given the times (epoch ms) of earlier uses.
 * Returns `now` when it fits right away.
 */
export function nextSlot(uses: readonly number[], limits: readonly Allowance[], now: number): number {
  let at = now;
  for (const { limit, windowMs } of limits) {
    const recent = uses.filter((t) => t > now - windowMs).sort((a, b) => a - b);
    if (recent.length >= limit) at = Math.max(at, recent[recent.length - limit] + windowMs);
  }
  return at;
}

/** The live limit X reported for one operation (`x-rate-limit-*` headers). */
export interface LiveLimit {
  /** `x-rate-limit-limit`. */
  limit: number | null;
  /** `x-rate-limit-remaining`. */
  remaining: number | null;
  /** Epoch ms when X's window resets. */
  reset: number | null;
  /** HTTP status; 429 means X's window is exhausted. */
  status: number;
}

/**
 * Applies the one-fifth rule to a live limit: once one fifth of X's window is used (by Xomoni or by the person
 * browsing X), wait until X resets it. Returns when the next request may go, or `now` when it may go now.
 */
export function liveSlot(live: LiveLimit | undefined, now: number): number {
  if (!live?.reset || live.reset <= now) return now;
  if (live.status === 429) return live.reset;
  if (live.limit == null || live.remaining == null) return now;
  return live.limit - live.remaining >= share(live.limit) ? live.reset : now;
}

/**
 * Xomoni's own ceiling for page loads and scrolls. X publishes no limit for loading its pages; the read
 * budgets above apply one fifth of each page's own quota on top of this.
 */
export const READ_CEILING = { hourlyCap: 240, dailyCap: 2400 } as const;

/** The highest hourly and daily caps a pacing rule may have for an action under the one-fifth rule. */
export function capCeilings(action: ActionKind): { hourlyCap: number; dailyCap: number } {
  if (action === 'read') return { ...READ_CEILING };
  let hourlyCap = Infinity;
  let dailyCap = Infinity;
  for (const id of ACTION_BUDGETS[action]) {
    for (const { limit, windowMs } of allowances(id)) {
      hourlyCap = Math.min(hourlyCap, windowMs >= 3_600_000 ? limit : limit * Math.ceil(3_600_000 / windowMs));
      dailyCap = Math.min(dailyCap, windowMs >= DAY ? limit : limit * Math.ceil(DAY / windowMs));
    }
  }
  return { hourlyCap, dailyCap };
}

/**
 * Makes a pacing rule safe: every minimum at most its maximum, at least one action per batch, and the
 * hourly and daily caps within the one-fifth ceilings. Custom settings pass through here on load and save.
 */
export function clampRule(action: ActionKind, rule: Partial<PacingRule>): PacingRule {
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback);
  const ceiling = capCeilings(action);
  const minDelay = num(rule.minDelay, 1);
  const batchPauseMin = num(rule.batchPauseMin, 0);
  return {
    minDelay,
    maxDelay: Math.max(minDelay, num(rule.maxDelay, minDelay)),
    batchSize: Math.max(1, Math.round(num(rule.batchSize, 1))),
    batchPauseMin,
    batchPauseMax: Math.max(batchPauseMin, num(rule.batchPauseMax, batchPauseMin)),
    hourlyCap: Math.min(ceiling.hourlyCap, Math.max(1, Math.round(num(rule.hourlyCap, 1)))),
    dailyCap: Math.min(ceiling.dailyCap, Math.max(1, Math.round(num(rule.dailyCap, 1)))),
  };
}

/**
 * Outcomes that mean a request reached X, so they spend X's quota whether or not they succeeded. X counts
 * every request; counting only successes could take Xomoni past one fifth. Only `skipped` (Xomoni chose not
 * to act) and `logged_out` (found before acting) are left out; counting a failure that sent nothing only
 * makes Xomoni slower, never faster.
 */
export function spendsQuota(outcome: Outcome): boolean {
  return outcome !== 'skipped' && outcome !== 'logged_out';
}

/**
 * Warm-up: the part of the one-fifth allowances an account may use on its first active days. Day one runs at
 * a quarter of one fifth (1/20 of X's limit); the fourth active day reaches one fifth, never more.
 */
export const WARMUP_STEPS = [0.25, 0.5, 0.75, 1] as const;

/** Days without any action after which the warm-up starts again from day one. */
export const WARMUP_RESET_DAYS = 14;

const dayKey = (t: number) => new Date(t).toDateString();

/**
 * How many earlier days (local calendar days before today, within the last {@link WARMUP_RESET_DAYS}) had
 * at least one action, from the times of the account's past actions.
 */
export function earlierActiveDays(actionTimes: readonly number[], now: number): number {
  const today = dayKey(now);
  const since = now - WARMUP_RESET_DAYS * DAY;
  return new Set(
    actionTimes
      .filter((t) => t >= since && t < now)
      .map(dayKey)
      .filter((d) => d !== today),
  ).size;
}

/**
 * The warm-up step for an account: its day (1–4) and the factor applied to the one-fifth allowances. `drop`
 * moves it back that many steps (one per 226, lock or refusal in the last two weeks).
 */
export function warmup(earlierDays: number, drop = 0): { day: number; days: number; factor: number } {
  // `drop` steps back down after X's warnings (the risk ladder), whatever step the account had reached.
  const index = Math.max(0, Math.min(Math.max(0, earlierDays), WARMUP_STEPS.length - 1) - Math.max(0, drop));
  return { day: index + 1, days: WARMUP_STEPS.length, factor: WARMUP_STEPS[index] };
}

/** Scales allowances by the warm-up factor (rounded down, at least 1). A factor above 1 is treated as 1. */
export function scaleAllowances(list: readonly Allowance[], factor: number): Allowance[] {
  const f = Math.min(1, factor);
  return list.map((a) => ({ ...a, limit: Math.max(1, Math.floor(a.limit * f)) }));
}

/**
 * Scales a pacing rule by the warm-up factor: caps shrink with it and delays grow, so the pace stays even
 * within the smaller allowance. A factor above 1 is treated as 1, so the rule never gets faster.
 */
export function scaleRule(rule: PacingRule, factor: number): PacingRule {
  const f = Math.min(1, factor);
  if (f === 1) return rule;
  return {
    ...rule,
    minDelay: rule.minDelay / f,
    maxDelay: rule.maxDelay / f,
    hourlyCap: Math.max(1, Math.floor(rule.hourlyCap * f)),
    dailyCap: Math.max(1, Math.floor(rule.dailyCap * f)),
  };
}
