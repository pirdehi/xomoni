// The statistics of reach diagnosis (#429, ADR-0045): medians, each post's baseline, and comparisons of two groups of
// posts that are honest about their size. A comparison needs 15 posts on each side, shows each side's size and median,
// and gives a 95% interval of their ratio from 2,000 bootstrap resamples with a seeded generator, so the same posts
// always give the same answer. Its verdict is one of five fixed words (`REACH_VERDICT_WORDS`). It shows an association,
// never a cause. Pure, and fast for 50,000 posts: a resample's median is drawn from its order statistic, not by drawing
// the resample.
import type { ReachVerdict } from '@xomoni/bridge';
import type { ItemKind } from '../types';

/** A post younger than this at its "as of" date is still growing, and left out of baselines and comparisons. */
export const YOUNG_POST_DAYS = 7;

/** The fewest posts a group, or a baseline, is computed from; below it, *not enough data*. */
export const MIN_GROUP = 15;

/** Bootstrap resamples behind each interval. */
export const RESAMPLES = 2_000;

/** The interval's confidence. */
export const CONFIDENCE = 0.95;

/** How far back a post's baseline looks: 8 weeks, in days. */
export const BASELINE_DAYS = 56;

/**
 * A ratio interval inside this band, around 1, is *no difference*: neither side is more than a fifth above or below
 * the other, even at the interval's ends. An interval that holds 1 but reaches past the band is *maybe*.
 */
export const NO_DIFFERENCE_BAND: readonly [number, number] = [0.8, 1.25];

/** The seed comparisons use unless told otherwise; any fixed number gives the same answer every time. */
export const DEFAULT_SEED = 0x5eed_2026;

const DAY_MS = 86_400_000;

/**
 * A post's format, for its baseline: a reply; else a post with a link out of X; else one with photos or videos; else
 * text. `unknown` when its links or media aren't known, and it then has no baseline.
 */
export type ReachFormat = 'reply' | 'link' | 'media' | 'text' | 'unknown';

/** The formats a post can be compared within. */
export const REACH_FORMATS: readonly Exclude<ReachFormat, 'unknown'>[] = ['text', 'link', 'media', 'reply'];

/** The format of a post or reply from its kind and its links and media (`Item.links`, `Item.media`). */
export function formatOf(post: { kind: ItemKind; links?: number | null; media?: number | null }): ReachFormat {
  if (post.kind === 'reply') return 'reply';
  if (post.links == null || post.media == null) return 'unknown';
  if (post.links > 0) return 'link';
  if (post.media > 0) return 'media';
  return 'text';
}

/** What the statistics need of one post. `reach.ts`'s `ReachPost` has these fields and more. */
export interface ReachSample {
  id: string;
  /** Epoch ms. */
  createdAt: number;
  /** Its impressions or views from the best source; null when there is none, and it is left out of everything. */
  impressions: number | null;
  format: ReachFormat;
  /** How old it was at its number's "as of" date, in days; null when it has no number. */
  ageAtAsOfDays: number | null;
}

/** Whether a post counts in baselines and comparisons: it has a number, and was at least 7 days old when it was read. */
export function isSettled(post: ReachSample): post is ReachSample & { impressions: number; ageAtAsOfDays: number } {
  return (
    post.impressions !== null &&
    Number.isFinite(post.impressions) &&
    post.impressions >= 0 &&
    post.ageAtAsOfDays !== null &&
    post.ageAtAsOfDays >= YOUNG_POST_DAYS
  );
}

/** The median of ascending `sorted` values; null when there are none. */
function sortedMedian(sorted: ArrayLike<number>): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  const lo = sorted[(n - 1) >> 1] as number;
  const hi = sorted[n >> 1] as number;
  return (lo + hi) / 2;
}

/** Finite values of `values`, ascending, as a typed array. */
function ascending(values: readonly number[]): Float64Array {
  return Float64Array.from(values.filter((v) => Number.isFinite(v))).sort();
}

/** The median of `values`, leaving out anything that isn't a finite number; null when none is left. */
export function median(values: readonly number[]): number | null {
  return sortedMedian(ascending(values));
}

/**
 * The quantiles `ps` (each from 0 to 1) of `values`, by linear interpolation between the closest ranks (the method
 * spreadsheets and R's default use); null for each when there are no finite values.
 */
export function quantiles(values: readonly number[], ps: readonly number[]): (number | null)[] {
  return quantilesOfSorted(ascending(values), ps);
}

function quantilesOfSorted(sorted: ArrayLike<number>, ps: readonly number[]): (number | null)[] {
  const n = sorted.length;
  return ps.map((p) => {
    if (n === 0 || !(p >= 0 && p <= 1)) return null;
    const rank = p * (n - 1);
    const below = Math.floor(rank);
    const above = Math.min(below + 1, n - 1);
    const low = sorted[below] as number;
    const high = sorted[above] as number;
    // Equal neighbours, infinite ones among them, need no interpolation (∞ − ∞ isn't a number).
    return low === high ? low : low + (high - low) * (rank - below);
  });
}

/** mulberry32: a small seeded generator of numbers in [0, 1). The same seed gives the same numbers, everywhere. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A standard normal variate from `random` (Box–Muller). */
function normal(random: () => number): number {
  let u = random();
  while (u === 0) u = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/** A Gamma(`shape`, 1) variate from `random`, for a shape of 1 or more (Marsaglia and Tsang, 2000). */
function gamma(shape: number, random: () => number): number {
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x = normal(random);
    let v = 1 + c * x;
    while (v <= 0) {
      x = normal(random);
      v = 1 + c * x;
    }
    v = v * v * v;
    const u = random();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/**
 * The median of one bootstrap resample of ascending `sorted`, without drawing the resample. A resample draws n
 * positions, each `floor(U × n)` for a uniform U; since `sorted` ascends, its median is the value at the middle drawn
 * position, and the k-th smallest of n uniforms is Beta(k, n − k + 1): two Gamma variates. For an even n, the next one
 * up is the smallest of the n − k uniforms above it. So a resample costs a few draws whatever n is: the same
 * distribution as drawing all n, and 50,000 posts compare in milliseconds.
 */
export function resampledMedian(sorted: Float64Array, random: () => number): number {
  const n = sorted.length;
  const k = ((n - 1) >> 1) + 1;
  const x = gamma(k, random);
  const u = x / (x + gamma(n - k + 1, random));
  const at = (q: number) => sorted[Math.min(n - 1, Math.floor(q * n))] as number;
  if (n % 2 === 1) return at(u);
  const next = u + (1 - u) * (1 - random() ** (1 / (n - k)));
  return (at(u) + at(next)) / 2;
}

/** `a / b` for medians of impressions, which may be 0: 1 when both are 0, and infinite when only `b` is. */
function ratio(a: number, b: number): number {
  if (b === 0) return a === 0 ? 1 : Number.POSITIVE_INFINITY;
  return a / b;
}

/** One side of a comparison: how many posts, and their median (null below `MIN_GROUP`). */
export interface GroupSummary {
  n: number;
  median: number | null;
}

/** A comparison of group `a` with group `b`. */
export interface Comparison {
  verdict: ReachVerdict;
  a: GroupSummary;
  b: GroupSummary;
  /** `a`'s median over `b`'s; null with *not enough data*. */
  ratio: number | null;
  /** The 95% interval of that ratio, `[low, high]`; null with *not enough data*. */
  interval: readonly [number, number] | null;
}

/** How a comparison is made; each has the ADR's value by default. */
export interface CompareOptions {
  minN?: number;
  resamples?: number;
  seed?: number;
  confidence?: number;
}

/** The verdict for a ratio interval: all below 1, all above, inside `NO_DIFFERENCE_BAND`, or else *maybe*. */
export function verdictOf(interval: readonly [number, number]): Exclude<ReachVerdict, 'not-enough-data'> {
  const [low, high] = interval;
  if (high < 1) return 'clear-lower';
  if (low > 1) return 'clear-higher';
  if (low >= NO_DIFFERENCE_BAND[0] && high <= NO_DIFFERENCE_BAND[1]) return 'no-difference';
  return 'maybe';
}

/**
 * Compares the impressions of two groups of posts (ADR-0045, point 2). With fewer than `minN` (15) finite values on
 * either side, the verdict is *not enough data* and nothing else is said. Otherwise it gives each side's size and
 * median, the ratio of the medians, and its `confidence` (95%) interval from `resamples` (2,000) bootstrap resamples of
 * each side, drawn with `seededRandom(seed)`, so the same values always give the same interval.
 */
export function compareGroups(a: readonly number[], b: readonly number[], options: CompareOptions = {}): Comparison {
  const { minN = MIN_GROUP, resamples = RESAMPLES, seed = DEFAULT_SEED, confidence = CONFIDENCE } = options;
  const [sortedA, sortedB] = [ascending(a), ascending(b)];
  if (sortedA.length < minN || sortedB.length < minN) {
    return {
      verdict: 'not-enough-data',
      a: { n: sortedA.length, median: null },
      b: { n: sortedB.length, median: null },
      ratio: null,
      interval: null,
    };
  }
  const random = seededRandom(seed);
  const ratios = new Float64Array(resamples);
  for (let i = 0; i < resamples; i++) {
    ratios[i] = ratio(resampledMedian(sortedA, random), resampledMedian(sortedB, random));
  }
  ratios.sort();
  const tail = (1 - confidence) / 2;
  const [low, high] = quantilesOfSorted(ratios, [tail, 1 - tail]) as [number, number];
  const [medianA, medianB] = [sortedMedian(sortedA) as number, sortedMedian(sortedB) as number];
  const interval = [low, high] as const;
  return {
    verdict: verdictOf(interval),
    a: { n: sortedA.length, median: medianA },
    b: { n: sortedB.length, median: medianB },
    ratio: ratio(medianA, medianB),
    interval,
  };
}

/** How each post's baseline is made. */
export interface BaselineOptions {
  /** How far back it looks, in days; 56 (8 weeks) by default. */
  windowDays?: number;
  /** Only posts of the same format (text, link, media, reply); true by default. */
  byFormat?: boolean;
  /** The fewest earlier posts it needs; `MIN_GROUP` (15) by default. */
  minN?: number;
}

/** Inserts `value` into ascending `sorted`, keeping it ascending. */
function insert(sorted: number[], value: number) {
  let [lo, hi] = [0, sorted.length];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] as number) < value) lo = mid + 1;
    else hi = mid;
  }
  sorted.splice(lo, 0, value);
}

/** Removes one `value` from ascending `sorted`. */
function remove(sorted: number[], value: number) {
  let [lo, hi] = [0, sorted.length];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] as number) < value) lo = mid + 1;
    else hi = mid;
  }
  if (sorted[lo] === value) sorted.splice(lo, 1);
}

/**
 * Each post's baseline (ADR-0045, point 2): the median impressions of the person's settled posts (`isSettled`) of the
 * same format in the `windowDays` (56) before it, by post id. A post gets null when fewer than `minN` (15) such posts
 * came before it, or when its format is `unknown` and `byFormat` is on. Every post gets an entry, settled or not, so a
 * young post can still be shown against what came before it. One pass in time order per format.
 */
export function baseline(posts: readonly ReachSample[], options: BaselineOptions = {}): Map<string, number | null> {
  const { windowDays = BASELINE_DAYS, byFormat = true, minN = MIN_GROUP } = options;
  const window = windowDays * DAY_MS;
  const out = new Map<string, number | null>();
  const groups = new Map<ReachFormat | 'all', ReachSample[]>();
  for (const post of posts) {
    const key = byFormat ? post.format : 'all';
    const group = groups.get(key);
    if (group) group.push(post);
    else groups.set(key, [post]);
  }
  for (const [key, group] of groups) {
    if (key === 'unknown') {
      for (const post of group) out.set(post.id, null);
      continue;
    }
    const byTime = [...group].sort((x, y) => x.createdAt - y.createdAt);
    const settled = byTime.filter(isSettled);
    const values: number[] = [];
    let [added, dropped] = [0, 0];
    for (const post of byTime) {
      // Every settled post made before this one, and no more than `window` before it.
      while (added < settled.length && (settled[added] as ReachSample).createdAt < post.createdAt) {
        insert(values, (settled[added] as { impressions: number }).impressions);
        added++;
      }
      while (dropped < added && (settled[dropped] as ReachSample).createdAt < post.createdAt - window) {
        remove(values, (settled[dropped] as { impressions: number }).impressions);
        dropped++;
      }
      out.set(post.id, values.length >= minN ? sortedMedian(values) : null);
    }
  }
  return out;
}

/** A post's impressions over its baseline (0.5 is half of it); null without a number or a baseline above 0. */
export function vsBaseline(post: Pick<ReachSample, 'impressions'>, base: number | null | undefined): number | null {
  if (post.impressions === null || base == null || base <= 0) return null;
  return post.impressions / base;
}
