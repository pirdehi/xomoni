// Reach diagnosis's words that both apps show (ADR-0045): the five verdicts of a comparison, and the words no text of
// Reach may use. One source, so the extension's Reach page and Reach on xomoni.com can't drift.

/** A comparison's verdict: one of five fixed words, never another (ADR-0045, point 2). */
export type ReachVerdict = 'clear-lower' | 'clear-higher' | 'maybe' | 'no-difference' | 'not-enough-data';

/** Every verdict, from the most certain to the least. */
export const REACH_VERDICTS: readonly ReachVerdict[] = [
  'clear-lower',
  'clear-higher',
  'no-difference',
  'maybe',
  'not-enough-data',
];

/** What each verdict says to the person, in the extension and on xomoni.com alike. */
export const REACH_VERDICT_WORDS: Readonly<Record<ReachVerdict, string>> = {
  'clear-lower': 'Clearly lower',
  'clear-higher': 'Clearly higher',
  maybe: 'Maybe',
  'no-difference': 'No difference',
  'not-enough-data': 'Not enough data',
};

/**
 * Words no verdict, heading, notification or text of Reach may use about a post or an account (ADR-0045, point 3):
 * shadowbanned, banned, penalized (or a penalty), suppressed, throttled, in any form. A test searches every string of Reach, in the
 * extension and on the website, with it. Addresses are left out before the search: a source's link may name them.
 */
export const REACH_BANNED_WORDS = /shadow[\s_-]*ban|\bbann(?:ed|ing)\b|\bbans?\b|penali[sz]|penalt|suppress|throttl/i;

/** Whether `text`, without its web addresses, uses a word `REACH_BANNED_WORDS` forbids. */
export function usesBannedReachWord(text: string): boolean {
  return REACH_BANNED_WORDS.test(text.replace(/\bhttps?:\/\/\S+/gi, ' '));
}

/**
 * The most of each part a `reach` read's answer holds (ADR-0045 point 6, ADR-0028): comparisons, months of X's labels,
 * labels in a month, posts, characters of a post's text, suspected posts, and reasons for each.
 */
export const REACH_LIMITS = {
  comparisons: 8,
  months: 24,
  labels: 50,
  posts: 100,
  text: 280,
  suspects: 20,
  reasons: 4,
  reason: 300,
} as const;

/** How a `reach` read lists the posts: most seen first, least seen first, or newest first. */
export type ReachOrder = 'best' | 'worst' | 'recent';

/** Every `ReachOrder`. */
export const REACH_ORDERS: readonly ReachOrder[] = ['best', 'worst', 'recent'];

/** What a comparison is about. */
export type ReachComparisonId = 'links' | 'media' | 'premium';

/** One side of a comparison: its posts, and their median (null with *not enough data*). */
export interface ReachSide {
  n: number;
  median: number | null;
}

/** One comparison in a `reach` answer: its verdict, its two sides, and the ratio with its 95% interval. */
export interface ReachComparisonSummary {
  id: ReachComparisonId;
  verdict: ReachVerdict;
  a: ReachSide;
  b: ReachSide;
  /** The ratio of the medians, and its interval; null with *not enough data*. */
  ratio: number | null;
  low: number | null;
  high: number | null;
}

/** A label of one month, as X named it. */
export interface ReachLabelSummary {
  name: string;
  count: number;
  scope: 'posts' | 'account' | 'unknown';
}

/** One month of X's *Under the hood* report. */
export interface ReachMonthSummary {
  /** `yyyy-mm`. */
  month: string;
  labels: ReachLabelSummary[];
  postsInMonth: number | null;
  /** False when X said the account wasn't eligible; null when it didn't say. */
  eligible: boolean | null;
}

/** One post in a `reach` answer: its id, when, its text (cut to 280), its number, where it comes from, and its share of usual. */
export interface ReachPostSummary {
  id: string;
  createdAt: number;
  text: string;
  impressions: number;
  source: 'csv' | 'live';
  /** Impressions over the post's baseline; null without one. */
  vsUsual: number | null;
}

/** A suspected post: always a guess (ADR-0045, point 4). */
export interface ReachSuspectSummary {
  id: string;
  /** `yyyy-mm`, and X's name for the label of that month. */
  month: string;
  label: string;
  confidence: 'low' | 'medium';
  /** Impressions over baseline. */
  ratio: number;
  reasons: string[];
  /** Always true; an answer with a suspect that isn't marked is refused whole. */
  guess: true;
}

/** Xomoni's answer to a `reach` read: counts only, and at most `REACH_LIMITS` of each part. */
export interface ReachSummary {
  /** The period's length in days; null for everything. */
  rangeDays: number | null;
  /** Posts with a number from X's analytics CSV, and from the views Xomoni saw. */
  csv: number;
  live: number;
  comparisons: ReachComparisonSummary[];
  months: ReachMonthSummary[];
  /** A page of posts in the order asked for, from `offset`. */
  posts: ReachPostSummary[];
  /** How many posts with a number there are, for paging. */
  total: number;
  suspects: ReachSuspectSummary[];
}

/** Thrown inside the parser for a value out of shape; never leaves this file. */
class OutOfShape extends Error {}

function refuse(): never {
  throw new OutOfShape();
}

/** `value` as a plain object, or refused. */
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) refuse();
  return value as Record<string, unknown>;
}

/** The object's keys are exactly `keys`. */
function exactly(obj: Record<string, unknown>, keys: readonly string[]): void {
  const own = Object.keys(obj);
  if (own.length !== keys.length || !keys.every((k) => Object.hasOwn(obj, k))) refuse();
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isRatio = (v: unknown): v is number => typeof v === 'number' && v >= 0 && !Number.isNaN(v);
const count = (v: unknown): number => (isCount(v) ? v : refuse());
const countOrNull = (v: unknown): number | null => (v === null ? null : count(v));
const ratioOrNull = (v: unknown): number | null => (v === null ? null : isRatio(v) ? v : refuse());
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const POST_ID = /^\d{1,20}$/;

/** A list of at most `max`, each read by `read`. */
function list<T>(value: unknown, max: number, read: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max) refuse();
  return (value as unknown[]).map(read);
}

/** A text of 1 to `max` characters. */
function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && value.length === 0)) refuse();
  return value;
}

function one<T extends string>(value: unknown, allowed: readonly T[]): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : refuse();
}

function side(value: unknown): ReachSide {
  const s = record(value);
  exactly(s, ['n', 'median']);
  return { n: count(s.n), median: ratioOrNull(s.median) };
}

function comparison(value: unknown): ReachComparisonSummary {
  const c = record(value);
  exactly(c, ['id', 'verdict', 'a', 'b', 'ratio', 'low', 'high']);
  return {
    id: one(c.id, ['links', 'media', 'premium'] as const),
    verdict: one(c.verdict, REACH_VERDICTS),
    a: side(c.a),
    b: side(c.b),
    ratio: ratioOrNull(c.ratio),
    low: ratioOrNull(c.low),
    high: ratioOrNull(c.high),
  };
}

function month(value: unknown): ReachMonthSummary {
  const m = record(value);
  exactly(m, ['month', 'labels', 'postsInMonth', 'eligible']);
  if (typeof m.month !== 'string' || !MONTH.test(m.month)) refuse();
  if (m.eligible !== null && typeof m.eligible !== 'boolean') refuse();
  return {
    month: m.month,
    labels: list(m.labels, REACH_LIMITS.labels, (value) => {
      const l = record(value);
      exactly(l, ['name', 'count', 'scope']);
      return {
        name: text(l.name, 100),
        count: count(l.count),
        scope: one(l.scope, ['posts', 'account', 'unknown'] as const),
      };
    }),
    postsInMonth: countOrNull(m.postsInMonth),
    eligible: m.eligible,
  };
}

function post(value: unknown): ReachPostSummary {
  const p = record(value);
  exactly(p, ['id', 'createdAt', 'text', 'impressions', 'source', 'vsUsual']);
  if (typeof p.id !== 'string' || !POST_ID.test(p.id)) refuse();
  return {
    id: p.id,
    createdAt: count(p.createdAt),
    text: text(p.text, REACH_LIMITS.text, true),
    impressions: count(p.impressions),
    source: one(p.source, ['csv', 'live'] as const),
    vsUsual: ratioOrNull(p.vsUsual),
  };
}

function suspect(value: unknown): ReachSuspectSummary {
  const s = record(value);
  exactly(s, ['id', 'month', 'label', 'confidence', 'ratio', 'reasons', 'guess']);
  if (s.guess !== true) refuse();
  if (typeof s.id !== 'string' || !POST_ID.test(s.id)) refuse();
  if (typeof s.month !== 'string' || !MONTH.test(s.month)) refuse();
  if (!isRatio(s.ratio)) refuse();
  return {
    id: s.id,
    month: s.month,
    label: text(s.label, 100),
    confidence: one(s.confidence, ['low', 'medium'] as const),
    ratio: s.ratio,
    reasons: list(s.reasons, REACH_LIMITS.reasons, (r) => text(r, REACH_LIMITS.reason)),
    guess: true,
  };
}

/**
 * Reads Xomoni's answer to a `reach` read strictly: exactly the keys of `ReachSummary` and its parts, at most
 * `REACH_LIMITS` of each, counts as whole numbers of 0 or more, months as `yyyy-mm`, post ids as X's, verdicts from
 * `REACH_VERDICTS`, and every suspected post marked `guess: true`. Anything else is null: the website shows no answer
 * rather than part of one.
 */
export function parseReachSummary(raw: unknown): ReachSummary | null {
  try {
    const r = record(raw);
    exactly(r, ['rangeDays', 'csv', 'live', 'comparisons', 'months', 'posts', 'total', 'suspects']);
    return {
      rangeDays: countOrNull(r.rangeDays),
      csv: count(r.csv),
      live: count(r.live),
      comparisons: list(r.comparisons, REACH_LIMITS.comparisons, comparison),
      months: list(r.months, REACH_LIMITS.months, month),
      posts: list(r.posts, REACH_LIMITS.posts, post),
      total: count(r.total),
      suspects: list(r.suspects, REACH_LIMITS.suspects, suspect),
    };
  } catch (err) {
    if (err instanceof OutOfShape) return null;
    throw err;
  }
}
