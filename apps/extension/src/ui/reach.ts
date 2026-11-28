// What the Reach page shows (#429, ADR-0045): the person's posts with their reach over a period, each against its
// baseline, filtered and sorted as the person asks, and the spread of their reach. Pure helpers, and the one live query
// the page reads through.
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../shared/db';
import {
  type PremiumPeriod,
  type ReachPost,
  type ReachSources,
  VAULT_REACH_SOURCES,
  premiumPeriods,
  reachPosts,
} from '../shared/vault/reach';
import { labelMonths } from '../shared/vault/label-months';
import { labelSeen, unseenLabelMonths } from '../shared/vault/reach-alerts';
import { BASELINE_DAYS, YOUNG_POST_DAYS, baseline, vsBaseline } from '../shared/vault/reach-stats';

const DAY_MS = 86_400_000;

/** The periods the page shows: the last 30 days (free), or 90 days and everything (Plus). */
export type ReachRange = '30d' | '90d' | 'all';

/** How long each period is, in days; null for everything. */
export const RANGE_DAYS: Readonly<Record<ReachRange, number | null>> = { '30d': 30, '90d': 90, all: null };

/** The periods that are part of Plus (`reach-history`), shown with the plan's badge (ADR-0042). */
export const PLUS_RANGES: ReadonlySet<ReachRange> = new Set<ReachRange>(['90d', 'all']);

/** A post on the page: its reach, its baseline, and its share of it. */
export interface ReachRow extends ReachPost {
  /** The median of the same format's posts in the 8 weeks before it; null without 15 of them. */
  baseline: number | null;
  /** Impressions over baseline; null without both. */
  vsBaseline: number | null;
  /** Read before it was 7 days old: its number may still grow, and it isn't compared. */
  growing: boolean;
}

/** The page's data for one period: its posts, and how many of them have a number. */
export interface ReachData {
  rows: ReachRow[];
  /** Posts with a number from X's analytics CSV, and from the views Xomoni saw. */
  csv: number;
  live: number;
  /** The last time X showed one of these posts' views (epoch ms); null when never. */
  lastSeen: number | null;
  /** The spans the account had Premium, for the Premium comparison. */
  periods: PremiumPeriod[];
}

/**
 * The posts of `range` up to `now`, each with its baseline from the 8 weeks before the period's start too, and the
 * account's Premium spans. The analytics CSV and Premium changes come from `sources`, the vault's unless given.
 */
export async function reachData(
  accountId: string,
  range: ReachRange,
  now = Date.now(),
  sources: ReachSources = VAULT_REACH_SOURCES,
): Promise<ReachData> {
  const days = RANGE_DAYS[range];
  const from = days === null ? 0 : now - days * DAY_MS;
  const [posts, events, account] = await Promise.all([
    reachPosts(accountId, { from: Math.max(0, from - BASELINE_DAYS * DAY_MS), to: now }, sources),
    sources.premiumEvents(accountId),
    db.accounts.get(accountId),
  ]);
  const bases = baseline(posts);
  const rows = posts
    .filter((p) => p.createdAt >= from)
    .map((p) => {
      const base = bases.get(p.id) ?? null;
      return {
        ...p,
        baseline: base,
        vsBaseline: vsBaseline(p, base),
        growing: p.ageAtAsOfDays !== null && p.ageAtAsOfDays < YOUNG_POST_DAYS,
      };
    });
  const live = rows.filter((r) => r.source === 'live');
  return {
    rows,
    csv: rows.filter((r) => r.source === 'csv').length,
    live: live.length,
    // Not `Math.max(...)`: spreading 125,000 or more values into a call's arguments overflows V8's stack.
    lastSeen: live.length ? live.reduce((latest, r) => Math.max(latest, r.asOf ?? 0), -Infinity) : null,
    periods: premiumPeriods(events, account ?? null),
  };
}

/** `reachData`, kept current as Xomoni sees more of X; undefined while it loads. */
export function useReachData(accountId: string, range: ReachRange): ReachData | undefined {
  return useLiveQuery(async () => await reachData(accountId, range), [accountId, range]);
}

/** Which posts the table shows: posts or replies, and by format. */
export interface ReachFilter {
  kind: 'all' | 'post' | 'reply';
  format: 'all' | 'link' | 'media' | 'text';
}

/** How the table is sorted: newest first, most seen first, or furthest below usual first. */
export type ReachSort = 'newest' | 'most-seen' | 'vs-usual';

/** The rows `filter` keeps: only those with a number, of the kind and format asked for. */
export function filterRows(rows: readonly ReachRow[], filter: ReachFilter): ReachRow[] {
  return rows.filter(
    (r) =>
      r.impressions !== null &&
      (filter.kind === 'all' || r.kind === filter.kind) &&
      (filter.format === 'all' || r.format === filter.format),
  );
}

/**
 * The rows in `sort`'s order. Newest first; most seen first; or furthest below usual first, posts without a baseline
 * last. Ties go to the newer post.
 */
export function sortRows(rows: readonly ReachRow[], sort: ReachSort): ReachRow[] {
  const newest = (a: ReachRow, b: ReachRow) => b.createdAt - a.createdAt;
  const key: Record<ReachSort, (a: ReachRow, b: ReachRow) => number> = {
    newest,
    'most-seen': (a, b) => (b.impressions ?? -1) - (a.impressions ?? -1) || newest(a, b),
    'vs-usual': (a, b) =>
      (a.vsBaseline ?? Number.POSITIVE_INFINITY) - (b.vsBaseline ?? Number.POSITIVE_INFINITY) || newest(a, b),
  };
  return [...rows].sort(key[sort]);
}

/** One bar of the spread: posts seen from `from` up to `to` times (`to` null: and more). */
export interface ReachBin {
  label: string;
  from: number;
  to: number | null;
  count: number;
}

/** The spread's bars, each ten times the one before: 0, 1–9, 10–99, … and 1M or more. */
const BIN_EDGES: readonly [string, number, number | null][] = [
  ['0', 0, 1],
  ['1–9', 1, 10],
  ['10–99', 10, 100],
  ['100–999', 100, 1_000],
  ['1K–10K', 1_000, 10_000],
  ['10K–100K', 10_000, 100_000],
  ['100K–1M', 100_000, 1_000_000],
  ['1M+', 1_000_000, null],
];

/** How many of `rows` fall in each bar of the spread, on a scale of tens, from the lowest bar used to the highest. */
export function histogram(rows: readonly ReachRow[]): ReachBin[] {
  const bins = BIN_EDGES.map(([label, from, to]) => ({ label, from, to, count: 0 }));
  for (const { impressions: seen } of rows) {
    if (seen === null) continue;
    const bin = bins.find((b) => seen >= b.from && (b.to === null || seen < b.to));
    if (bin) bin.count++;
  }
  const used = bins.map((b, i) => (b.count ? i : -1)).filter((i) => i >= 0);
  return used.length ? bins.slice(Math.min(...used), Math.max(...used) + 1) : [];
}

/**
 * The `n` most and least seen of `rows` that are settled (a number, read at least 7 days after the post): a post still
 * growing would look worse than it is.
 */
export function bestAndWorst(rows: readonly ReachRow[], n = 10): { best: ReachRow[]; worst: ReachRow[] } {
  const settled = rows.filter((r) => r.impressions !== null && !r.growing);
  const byReach = sortRows(settled, 'most-seen');
  return { best: byReach.slice(0, n), worst: byReach.slice(-n).reverse() };
}

/** A share of baseline in words: "48% of usual"; "—" without one. */
export function vsUsualWords(ratio: number | null): string {
  if (ratio === null) return '—';
  return `${Math.round(ratio * 100).toLocaleString('en-US')}% of usual`;
}

/**
 * How many months of X's labels the person hasn't opened Reach on yet, for the menu's count (#430): months with a label
 * newer than the newest one seen (`unseenLabelMonths`); 0 without an account.
 */
export function useReachNewMonths(accountId: string | null): number {
  return (
    useLiveQuery(
      async () => (accountId ? unseenLabelMonths(await labelMonths(accountId), await labelSeen(accountId)) : 0),
      [accountId],
    ) ?? 0
  );
}
