import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/shared/db';
import { ANALYTICS_CHUNK, ANALYTICS_DAYS_PARSER, ANALYTICS_POSTS_PARSER } from '../src/shared/vault/analytics-parsers';
import { TIMELINE_PAGE, accountTimeline, importLedger, mergeAnalyticsPosts } from '../src/shared/vault/db';
import { exportRowCounts } from '../src/shared/vault/export';
import { dueNudges } from '../src/shared/vault/freshness';
import { diskFile, planImport, runImport } from '../src/shared/vault/importer';
import { analyticsPostKey } from '../src/shared/vault/records';
import type { AccountEvent, AnalyticsDay, AnalyticsPost, VaultImport } from '../src/shared/vault/types';
import { vaultHoldings } from '../src/ui/components/vault/VaultSources';
import { resetDb } from './support/fixtures';
import { type Reads, countReads, installReadCounter } from './support/reads';

// The vault at a heavy X user's size (#426, CV.4.4, with #390): 50,000 posts' analytics, three years of days, 20,000
// timeline entries and a long import ledger, made in the test, never anyone's data. Each path has two budgets, as in
// `scale.test.ts`: what it reads, which holds at any size, so the normal suite proves it on a small vault (a page of the
// timeline reads a page; the sources card and the export's estimate count on indexes and read no analytics row); and how
// long it takes, generous, for CI's runners (fake-indexeddb is far slower than a browser's IndexedDB). By default a
// fiftieth of the full size; `XOMONI_SCALE` sets another share.

const SCALE = Number(import.meta.env.XOMONI_SCALE ?? '0.02');
const FULL = { analyticsPosts: 50_000, events: 20_000, imports: 500, days: 3 * 365 };
const size = (n: number) => Math.max(10, Math.round(n * SCALE));
const ME = '9000000000000000001';
const NOW = Date.UTC(2026, 10, 24, 12);
const DAY = 86_400_000;

/** A synthetic post id: X's ids are far below 9×10¹⁸. */
const postId = (n: number) => String(9_000_000_000_000_000_000n + BigInt(n));

const timings: { path: string; ms: number; budget: number; rows: number }[] = [];
const total = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

async function measure<T>(path: string, budget: number, fn: () => Promise<T>): Promise<{ result: T; reads: Reads }> {
  const start = performance.now();
  const out = await countReads(fn);
  const ms = Math.round(performance.now() - start);
  timings.push({ path, ms, budget, rows: total(out.reads.rows) });
  expect(ms, `${path}: ${String(ms)} ms, within ${String(budget)} ms`).toBeLessThanOrEqual(budget);
  return out;
}

const counts = {
  posts: size(FULL.analyticsPosts),
  events: size(FULL.events),
  imports: size(FULL.imports),
  days: FULL.days,
};

beforeAll(async () => {
  await installReadCounter();
  await resetDb();
  const posts: AnalyticsPost[] = Array.from({ length: counts.posts }, (_, i) => ({
    key: analyticsPostKey(ME, postId(i)),
    accountId: ME,
    postId: postId(i),
    createdAt: NOW - (i % 1000) * DAY,
    asOf: NOW,
    impressions: i * 3,
    likes: i % 50,
  }));
  await db.analyticsPosts.bulkPut(posts);
  const days: AnalyticsDay[] = Array.from({ length: counts.days }, (_, i) => ({
    accountId: ME,
    day: new Date(NOW - i * DAY).toISOString().slice(0, 10),
    asOf: NOW,
    impressions: i,
  }));
  await db.analyticsDays.bulkPut(days);
  const events: AccountEvent[] = Array.from({ length: counts.events }, (_, i) => ({
    accountId: ME,
    kind: 'note' as const,
    at: NOW - i * 3_600_000,
    source: 'person' as const,
    words: `note ${String(i)}`,
  }));
  await db.accountEvents.bulkAdd(events);
  const imports: VaultImport[] = Array.from({ length: counts.imports }, (_, i) => ({
    id: `${ME}:x-archive:${String(NOW - i * DAY)}:abcdefgh`,
    accountId: ME,
    source: 'x-archive' as const,
    fileName: 'twitter.zip',
    bytes: 1,
    fingerprint: 'zip:00112233445566778899aabbccddeeff',
    importedAt: NOW - i * DAY,
    coverFrom: null,
    coverTo: NOW - i * DAY,
    counts: { read: 1, merged: 1, skipped: 0 },
    parser: 'x-archive@1',
    problems: [],
  }));
  await db.vaultImports.bulkPut(imports);
}, 600_000);

afterAll(() => {
  console.info(
    `\nVault at scale ${String(SCALE)}: ${JSON.stringify(counts)}\n` +
      timings
        .map(
          (t) =>
            `${t.path.padEnd(48)} ${String(t.ms).padStart(7)} ms (budget ${String(t.budget)}) · ${String(t.rows)} rows`,
        )
        .join('\n'),
  );
});

describe(`the vault, at ${String(SCALE)} of a heavy X user’s (#426)`, () => {
  it('a page of the timeline reads a page, not the whole timeline', async () => {
    const page = await measure('Timeline: first page', 2_000, () => accountTimeline(ME));
    expect(page.result).toHaveLength(TIMELINE_PAGE);
    // At most a page of events and a page of the risk ladder's.
    expect(total(page.reads.rows)).toBeLessThanOrEqual(2 * TIMELINE_PAGE);
    expect(total(page.reads.rows)).toBeLessThan(counts.events);
    const next = await measure('Timeline: next page', 2_000, () =>
      accountTimeline(ME, { to: (page.result.at(-1)?.at ?? 0) - 1 }),
    );
    expect(next.result[0]?.words).toBe(`note ${String(TIMELINE_PAGE)}`);
    expect(total(next.reads.rows)).toBeLessThanOrEqual(2 * TIMELINE_PAGE);
  });

  it('the sources card and the export’s estimate count on the indexes, and read no analytics row', async () => {
    const holdings = await measure('Vault page: sources card', 3_000, () => vaultHoldings(ME, NOW));
    expect(holdings.result).toMatchObject({ posts: counts.posts, days: counts.days });
    expect(holdings.reads.rows.analyticsPosts ?? 0).toBe(0);
    // The first and the last day, nothing between.
    expect(holdings.reads.rows.analyticsDays ?? 0).toBeLessThanOrEqual(2);
    const estimate = await measure('Export: row counts', 3_000, () => exportRowCounts(ME));
    expect(estimate.result).toMatchObject({ 'analytics-posts': counts.posts, 'analytics-days': counts.days });
    expect(total(estimate.reads.rows)).toBe(0);
    const due = await measure('Reminder: what is due', 2_000, () => dueNudges(ME, NOW));
    expect(due.reads.rows.analyticsPosts ?? 0).toBe(0);
  });

  it('the ledger reads only the ledger', async () => {
    const ledger = await measure('Vault page: the ledger', 2_000, () => importLedger(ME));
    expect(ledger.result).toHaveLength(counts.imports);
    expect(Object.keys(ledger.reads.rows).filter((t) => t !== 'vaultImports')).toEqual([]);
  });

  it('merges analytics in batches of 2,000, each well within its budget, never lowering a count', async () => {
    const batch = Array.from({ length: ANALYTICS_CHUNK }, (_, i) => ({
      key: analyticsPostKey(ME, postId(i)),
      accountId: ME,
      postId: postId(i),
      createdAt: NOW - (i % 1000) * DAY,
      asOf: NOW,
      impressions: 1,
      likes: 999,
    }));
    const merged = await measure('Merge: 2,000 posts’ analytics', 5_000, () => mergeAnalyticsPosts(batch, NOW));
    expect(merged.result.added + merged.result.updated).toBeLessThanOrEqual(ANALYTICS_CHUNK);
    expect((await db.analyticsPosts.get(analyticsPostKey(ME, postId(5))))?.impressions).toBe(15);
  });

  it('imports X’s analytics export of many posts and days, batch by batch', async () => {
    const rows = size(FULL.analyticsPosts);
    const csv = [
      'Post id,Date,Impressions,Likes',
      ...Array.from({ length: rows }, (_, i) => `${postId(i)},2026-10-01,${String(i)},1`),
    ];
    const days = [
      'Date,Impressions,Likes,New follows',
      ...Array.from({ length: 365 }, (_, i) => `${new Date(NOW - (i + 1) * DAY).toISOString().slice(0, 10)},1,1,0`),
    ];
    const plan = await planImport(
      [diskFile(new File([csv.join('\n')], 'content.csv')), diskFile(new File([days.join('\n')], 'overview.csv'))],
      { id: ME, handle: 'xomoni_fixture' },
      [ANALYTICS_DAYS_PARSER, ANALYTICS_POSTS_PARSER],
    );
    expect(plan.parts).toHaveLength(2);
    const batches: number[] = [];
    let last = performance.now();
    const run = await measure('Import: analytics CSVs', 60_000, () =>
      runImport(plan, {
        now: NOW,
        onProgress: () => {
          const at = performance.now();
          batches.push(at - last);
          last = at;
        },
      }),
    );
    expect(run.result.map((r) => r.counts.merged)).toEqual([365, rows]);
    // No batch, read and written, holds the page for long: generous on fake-indexeddb, 200 ms in a browser.
    expect(Math.max(...batches)).toBeLessThan(5_000);
  });
});
