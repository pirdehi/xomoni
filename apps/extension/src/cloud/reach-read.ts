// Reach as xomoni.com reads it in the same browser (#431, ADR-0045 point 6, ADR-0028): the active account's posts with
// their reach, the comparisons, X's months of labels and the suspected posts, as one bounded answer (`ReachSummary`,
// `REACH_LIMITS`). Counts, X's label names, and the person's own posts' text cut to 280 characters; every suspected
// post is marked `guess: true`. It is built on the computer, from what Xomoni keeps, and goes only to the page in this
// browser, which keeps it in memory; nothing is sent to a server.
import {
  REACH_LIMITS,
  type ReachComparisonSummary,
  type ReachMonthSummary,
  type ReachOrder,
  type ReachPostSummary,
  type ReachSummary,
  type ReachSuspectSummary,
} from '@xomoni/bridge';
import { db, kvGet } from '../shared/db';
import { labelMonths } from '../shared/vault/label-months';
import { VAULT_REACH_SOURCES, premiumPeriods, reachPosts } from '../shared/vault/reach';
import { reachComparisons } from '../shared/vault/reach-compare';
import { BASELINE_DAYS, YOUNG_POST_DAYS, baseline, vsBaseline } from '../shared/vault/reach-stats';
import { dismissedSuspects } from '../shared/vault/suspect-dismissals';
import { suspectPosts } from '../shared/vault/suspects';

const DAY_MS = 86_400_000;

/** What a `reach` read asks: the period's length in days (null for everything), the posts' order, and the page. */
export interface ReachQuery {
  rangeDays: number | null;
  order: ReachOrder;
  offset: number;
}

/** A number JSON can carry: an infinite ratio (a side with a median of 0) becomes null. */
const finite = (n: number | null): number | null => (n === null || !Number.isFinite(n) ? null : n);

/** An empty answer, for a browser that knows no X account yet. */
const EMPTY = (rangeDays: number | null): ReachSummary => ({
  rangeDays,
  csv: 0,
  live: 0,
  comparisons: [],
  months: [],
  posts: [],
  total: 0,
  suspects: [],
});

/**
 * The active account's Reach for `query` at `now`: the period's posts with a number, a page of `READ_PAGE` (100) in the
 * order asked for (most seen, least seen, or newest first) from `offset`; the three comparisons; up to 24 months of X's
 * labels, newest first; and up to 20 suspected posts, those the person dismissed left out. Each post's baseline comes
 * from the 8 weeks before the period too, as on the Reach page.
 */
export async function readReach(query: ReachQuery, now = Date.now()): Promise<ReachSummary> {
  const activeId = await kvGet<string | null>('activeAccount', null);
  const account = activeId ? await db.accounts.get(activeId) : undefined;
  if (!account) return EMPTY(query.rangeDays);
  const from = query.rangeDays === null ? 0 : now - query.rangeDays * DAY_MS;
  const [all, events, months, dismissed] = await Promise.all([
    reachPosts(account.id, { from: Math.max(0, from - BASELINE_DAYS * DAY_MS), to: now }),
    VAULT_REACH_SOURCES.premiumEvents(account.id),
    labelMonths(account.id, now),
    dismissedSuspects(account.id),
  ]);
  const bases = baseline(all);
  const rows = all.filter((p) => p.createdAt >= from);
  const counted = rows.filter((p) => p.impressions !== null);
  const comparisons: ReachComparisonSummary[] = reachComparisons(rows, premiumPeriods(events, account))
    .slice(0, REACH_LIMITS.comparisons)
    .map((c) => ({
      id: c.id,
      verdict: c.result.verdict,
      a: { n: c.result.a.n, median: finite(c.result.a.median) },
      b: { n: c.result.b.n, median: finite(c.result.b.median) },
      ratio: finite(c.result.ratio),
      low: finite(c.result.interval?.[0] ?? null),
      high: finite(c.result.interval?.[1] ?? null),
    }));
  const order: Record<ReachOrder, (a: (typeof counted)[number], b: (typeof counted)[number]) => number> = {
    best: (a, b) => (b.impressions ?? 0) - (a.impressions ?? 0) || b.createdAt - a.createdAt,
    worst: (a, b) => (a.impressions ?? 0) - (b.impressions ?? 0) || b.createdAt - a.createdAt,
    recent: (a, b) => b.createdAt - a.createdAt,
  };
  // The least seen are only settled posts: one still growing would look worse than it is.
  const listed = query.order === 'worst' ? counted.filter((p) => (p.ageAtAsOfDays ?? 0) >= YOUNG_POST_DAYS) : counted;
  const posts: ReachPostSummary[] = [...listed]
    .sort(order[query.order])
    .slice(query.offset, query.offset + REACH_LIMITS.posts)
    .map((p) => ({
      id: p.id,
      createdAt: p.createdAt,
      text: p.text.slice(0, REACH_LIMITS.text),
      impressions: p.impressions ?? 0,
      source: p.source === 'csv' ? 'csv' : 'live',
      vsUsual: finite(vsBaseline(p, bases.get(p.id))),
    }));
  const monthSummaries: ReachMonthSummary[] = months.slice(0, REACH_LIMITS.months).map((m) => ({
    month: m.month,
    labels: m.labels.slice(0, REACH_LIMITS.labels).map((l) => ({ name: l.name, count: l.count, scope: l.scope })),
    postsInMonth: m.postsInMonth ?? null,
    eligible: m.eligible ?? null,
  }));
  const suspects: ReachSuspectSummary[] = suspectPosts(rows, months, new Set(dismissed), bases)
    .flatMap(({ month, label, confidence, candidates }) =>
      confidence === null
        ? []
        : candidates.map((c) => ({
            id: c.id,
            month,
            label,
            confidence,
            ratio: c.ratio,
            reasons: c.reasons.slice(0, REACH_LIMITS.reasons).map((r) => r.slice(0, REACH_LIMITS.reason)),
            guess: true as const,
          })),
    )
    .slice(0, REACH_LIMITS.suspects);
  return {
    rangeDays: query.rangeDays,
    csv: rows.filter((p) => p.source === 'csv').length,
    live: rows.filter((p) => p.source === 'live').length,
    comparisons,
    months: monthSummaries,
    posts,
    total: listed.length,
    suspects,
  };
}
