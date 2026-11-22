import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { archiveImported, dailyRows, db, postTotals } from '../src/shared/db';
import { findCandidates } from '../src/shared/filter';
import { exportData, importData } from '../src/shared/move';
import { checkMoveText } from '../src/shared/move-file';
import type { CleanupFilter, Item } from '../src/shared/types';
import { importArchive } from '../src/ui/importArchive';
import {
  LIBRARY_PAGE_SIZE,
  archiveStatus,
  copyStatus,
  kindCounts,
  libraryPage,
  yearHistogram,
} from '../src/ui/queries';
import { resetDb } from './support/fixtures';
import { FULL_SCALE, type History, archiveFilesOf, makeHistory, seedHistory } from './support/history';
import { type Reads, countReads, installReadCounter } from './support/reads';

// Xomoni with a heavy X user's history (#390): the queries behind the Library, Cleanup, Home, the archive import,
// *Export everything*, the move-your-data import and the daily numbers, against Dexie on fake-indexeddb, with a
// history made in the test (`support/history.ts`). Each path has two budgets:
// - what it reads: rows handed over, and cursor steps. These hold at any size, so the normal suite proves them on a
//   small history: a path that walks the whole inventory where an index or a count would do fails here at once;
// - how long it takes, generous, for CI's runners. fake-indexeddb is far slower than a browser's IndexedDB on a
//   cursor, so the times that matter for people are the browser's (`apps/web/e2e/extension/scale.spec.ts`).
// By default a fiftieth of issue #390's 100,000 posts and 100,000 likes; `XOMONI_SCALE` sets another share. The read
// budgets hold at any size; past a fifth, fake-indexeddb's cursors and skips take minutes.

/** The history's size, as a share of issue #390's. */
const SCALE = Number(import.meta.env.XOMONI_SCALE ?? '0.02');
const NOW = Date.UTC(2026, 10, 22, 12);
const DAY = 86_400_000;
const YEAR = 365.25 * DAY;

const history: History = makeHistory({
  posts: Math.round(FULL_SCALE.posts * SCALE),
  likes: Math.round(FULL_SCALE.likes * SCALE),
  years: FULL_SCALE.years,
  now: NOW,
});
const account = history.account;
const id = account.id;
const of = (kind: Item['kind'], status: Item['status'] = 'present') =>
  history.items.filter((i) => i.kind === kind && i.status === status).length;

/** Each path's time, for the table printed at the end. */
const timings: { path: string; ms: number; budget: number; rows: number; steps: number; detail: string }[] = [];

/** The rows and cursor steps of every table together. */
const total = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

/**
 * Runs a path, records its time against `budget` ms (at full size; a smaller run keeps it), and returns its result
 * with what it read.
 */
async function measure<T>(path: string, budget: number, fn: () => Promise<T>): Promise<{ result: T; reads: Reads }> {
  const start = performance.now();
  const out = await countReads(fn);
  const ms = Math.round(performance.now() - start);
  timings.push({
    path,
    ms,
    budget,
    rows: total(out.reads.rows),
    steps: total(out.reads.steps),
    detail: JSON.stringify(out.reads.indexCounted),
  });
  expect(ms, `${path}: ${String(ms)} ms, within ${String(budget)} ms`).toBeLessThanOrEqual(budget);
  return out;
}

beforeAll(async () => {
  await installReadCounter();
  await resetDb();
  await seedHistory(history);
  // As an archive import leaves it: the marker with its date.
  await db.kv.put({ key: `archive:${id}`, value: NOW - 30 * DAY });
}, 600_000);

afterAll(() => {
  console.info(
    `\nScale ${String(SCALE)}: ${String(history.items.length)} items, ${String(history.logs.length)} log entries\n` +
      timings
        .map(
          (t) =>
            `${t.path.padEnd(44)} ${String(t.ms).padStart(7)} ms (budget ${String(t.budget)}) · ${String(t.rows)} rows, ${String(t.steps)} cursor steps, counted on an index ${t.detail}`,
        )
        .join('\n'),
  );
});

describe(`a heavy X user's history, at ${String(SCALE)} of 100,000 posts and 100,000 likes (#390)`, () => {
  it('Home: the counts and the chart by year read keys and counts, never the rows', async () => {
    const counts = await measure('Home: counts per kind', 2_000, () => kindCounts(id));
    expect(counts.result.post).toEqual({ present: of('post'), deleted: of('post', 'deleted') });
    expect(counts.result.like.present).toBe(of('like'));
    expect(total(counts.reads.rows)).toBe(0);
    // Only what was removed or is gone is counted on the index; the rest on the primary key.
    const notPresent = history.items.filter((i) => i.status !== 'present').length;
    expect(total(counts.reads.indexCounted)).toBe(notPresent);

    const chart = await measure('Home: chart by year', 5_000, () => yearHistogram(id, ['post', 'reply', 'repost']));
    const sum = chart.result.reduce((n, y) => n + (y.values.post ?? 0), 0);
    expect(sum).toBe(of('post'));
    expect(total(chart.reads.rows)).toBe(0);
    // Counted a year at a time: a cursor step for each kind's first and last key, never one per item.
    expect(total(chart.reads.steps)).toBeLessThanOrEqual(2 * 3);

    const status = await measure('Home: archive status', 1_000, () => archiveStatus(id));
    expect(status.result.imported).toBe(true);
    // The marker and the jobs, not the inventory.
    expect(status.reads.rows.items ?? 0).toBe(0);

    // An import from before the marker: the inventory, in bulk reads, until an item from the archive.
    await db.kv.delete(`archive:${id}`);
    const legacy = await measure('Home: archive status, no marker', 2_000, () => archiveStatus(id));
    await db.kv.put({ key: `archive:${id}`, value: NOW - 30 * DAY });
    expect(legacy.result.imported).toBe(true);
    expect(total(legacy.reads.steps)).toBe(0);
  });

  it('Library: opening it, a page further and the last page read a page of rows', async () => {
    const copy = await measure('Library: how complete the copy is', 2_000, () => copyStatus(account));
    expect(copy.result.present).toBe(of('post') + of('reply') + of('repost'));
    // Only the removed posts are read, X's count may still hold them, in bulk.
    const removed = of('post', 'deleted') + of('reply', 'deleted') + of('repost', 'deleted');
    expect(copy.reads.rows.items ?? 0).toBeLessThanOrEqual(removed);
    expect(total(copy.reads.steps)).toBe(0);
    const goneFromX = of('post', 'gone') + of('reply', 'gone') + of('repost', 'gone');
    expect(total(copy.reads.indexCounted)).toBe(goneFromX);

    const first = await measure('Library: page 1', 1_000, () =>
      libraryPage({ accountId: id, kind: 'post', status: 'present', query: '', page: 0 }),
    );
    expect(first.result).toHaveLength(LIBRARY_PAGE_SIZE);
    expect(first.result[0]!.createdAt).toBeGreaterThanOrEqual(first.result[1]!.createdAt);
    expect(total(first.reads.rows)).toBe(LIBRARY_PAGE_SIZE);

    const last = Math.floor((of('post') - 1) / LIBRARY_PAGE_SIZE);
    // fake-indexeddb skips to the last page a row at a time; a browser skips in one step (0.1 s at full size).
    const end = await measure('Library: last page', 15_000, () =>
      libraryPage({ accountId: id, kind: 'post', status: 'present', query: '', page: last }),
    );
    expect(end.result).toHaveLength(of('post') - last * LIBRARY_PAGE_SIZE);
    expect(total(end.reads.rows)).toBeLessThanOrEqual(LIBRARY_PAGE_SIZE);

    const likes = await measure('Library: likes, page 1', 1_000, () =>
      libraryPage({ accountId: id, kind: 'like', status: 'present', query: '', page: 0 }),
    );
    expect(likes.result).toHaveLength(LIBRARY_PAGE_SIZE);
    const gone = await measure('Library: removed posts, page 1', 1_000, () =>
      libraryPage({ accountId: id, kind: 'post', status: 'deleted', query: '', page: 0 }),
    );
    expect(gone.result.every((i) => i.status === 'deleted')).toBe(true);
  });

  it('Library: a search reads the list in bulk, newest first, and stops once it has the page', async () => {
    const none = await measure('Library: search, no match', 10_000, () =>
      libraryPage({ accountId: id, kind: 'post', status: 'present', query: 'no-such-word', page: 0 }),
    );
    expect(none.result).toEqual([]);
    // Every row once, but for the one a read and the next share at their edge, and no cursor step.
    expect(total(none.reads.rows)).toBeLessThanOrEqual(of('post') + Math.ceil(of('post') / 1_000));
    expect(total(none.reads.steps)).toBe(0);

    const hashtag = await measure('Library: search, a rare word', 10_000, () =>
      libraryPage({ accountId: id, kind: 'post', status: 'present', query: '#KEEPTHIS', page: 0 }),
    );
    const expected = history.items
      .filter((i) => i.kind === 'post' && i.status === 'present' && i.text.includes('#keepthis'))
      .sort((a, b) => b.createdAt - a.createdAt || (a.key < b.key ? 1 : -1))
      .slice(0, LIBRARY_PAGE_SIZE)
      .map((i) => i.key);
    expect(hashtag.result.map((i) => i.key)).toEqual(expected);

    const author = await measure('Library: search, an author', 10_000, () =>
      libraryPage({ accountId: id, kind: 'like', status: 'present', query: '@friend_1', page: 0 }),
    );
    expect(author.result.every((i) => i.author.includes('friend_1') || i.text.includes('@friend_1'))).toBe(true);

    const common = await measure('Library: search, a common word', 10_000, () =>
      libraryPage({ accountId: id, kind: 'post', status: 'present', query: 'the', page: 1 }),
    );
    expect(common.result).toHaveLength(LIBRARY_PAGE_SIZE);
    // The second page of matches is in the newest posts: the search stops after its first bulk read.
    expect(total(common.reads.rows)).toBeLessThanOrEqual(1_000);
  });

  it('Cleanup: the preview and its count with keep rules read only the dates asked for', async () => {
    const filter: CleanupFilter = {
      target: 'post',
      before: NOW - YEAR,
      after: null,
      keepMinLikes: null,
      keepKeywords: [],
      keepIds: [],
      skipSelfReplies: true,
    };
    const inRange = history.items.filter(
      (i) => i.kind === 'post' && i.status === 'present' && i.createdAt < filter.before,
    ).length;
    const all = await measure('Cleanup: posts older than a year', 10_000, () => findCandidates(id, filter));
    expect(all.result).toHaveLength(inRange);
    // The range in one bulk read: no cursor walks it a row at a time.
    expect(total(all.reads.rows)).toBe(inRange);
    expect(total(all.reads.steps)).toBe(0);

    const keepIds = history.items
      .filter((i) => i.kind === 'post')
      .slice(0, 50)
      .map((i) => i.id);
    const kept = await measure('Cleanup: posts, with keep rules', 10_000, () =>
      findCandidates(id, { ...filter, keepMinLikes: 10, keepKeywords: ['launch', '#keepthis'], keepIds }),
    );
    expect(kept.result.length).toBeLessThan(inRange);
    expect(kept.result.every((i) => i.likes < 10 && !i.text.includes('launch') && !keepIds.includes(i.id))).toBe(true);
    expect(total(kept.reads.rows)).toBe(inRange);
    expect(total(kept.reads.steps)).toBe(0);

    const likes = await measure('Cleanup: likes older than a year', 10_000, () =>
      findCandidates(id, { ...filter, target: 'like' }),
    );
    // A like's date is when it was liked, when known: the read covers every like created before the bound.
    expect(likes.result.every((i) => (i.likedAt ?? i.createdAt) < filter.before)).toBe(true);

    await measure('Cleanup: the backup of the preview', 10_000, async () => JSON.stringify(kept.result, null, 2));
  });

  it('reads in bulk in one transaction, so live queries keep no copy and every count is one moment (#390)', async () => {
    // Dexie's live queries keep the result of a bulk read for as long as a page subscribes, unless it was read in an
    // explicit transaction: Cleanup's whole date range, a search's every read, the inventory without the marker.
    const transaction = vi.spyOn(db, 'transaction');
    const filter: CleanupFilter = {
      target: 'like',
      before: NOW,
      after: null,
      keepMinLikes: null,
      keepKeywords: [],
      keepIds: [],
      skipSelfReplies: true,
    };
    const paths: [string, () => Promise<unknown>][] = [
      ['Cleanup’s preview', () => findCandidates(id, filter)],
      ['a search', () => libraryPage({ accountId: id, kind: 'like', status: 'present', query: 'zzz', page: 0 })],
      ['the counts', () => kindCounts(id)],
      ['the copy’s totals', () => postTotals(account)],
    ];
    await db.kv.delete(`archive:${id}`);
    paths.push(['the archive without its marker', () => archiveImported(id)]);
    for (const [path, read] of paths) {
      transaction.mockClear();
      await read();
      expect(transaction, path).toHaveBeenCalledWith('r', db.items, expect.any(Function));
    }
    transaction.mockRestore();
    await db.kv.put({ key: `archive:${id}`, value: NOW - 30 * DAY });
  });

  it('the daily numbers read the days asked for, not the whole history', async () => {
    const days = await measure('Daily numbers: the last 400 days', 10_000, () => dailyRows(id, NOW - 400 * DAY, NOW));
    expect(days.result.length).toBeGreaterThan(300);
    const recent = history.items.filter((i) => i.kind !== 'like' && i.createdAt >= NOW - 400 * DAY).length;
    expect(days.reads.rows.items ?? 0).toBeLessThanOrEqual(recent + history.logs.length);
    const totals = await measure('Library: posts on X and removed since', 2_000, () => postTotals(account));
    expect(totals.result.present).toBe(of('post') + of('reply') + of('repost'));
  });

  it('Export everything writes every record once, and the move-your-data import takes it whole', async () => {
    const exported = await measure('Export everything', 120_000, () => exportData({ app: '0.5.2', now: NOW }));
    expect(exported.result.skipped).toBe(0);
    expect(exported.result.counts.items).toBe(history.items.length);
    // Every row is read once, in bulk: no cursor walks the inventory.
    expect(exported.reads.rows.items).toBe(history.items.length);
    expect(exported.reads.steps.items ?? 0).toBe(0);

    const checked = await measure('Move: checking the file', 60_000, () => checkMoveText(exported.result.text, NOW));
    if (!checked.result.ok) throw new Error(checked.result.message);
    const file = checked.result.file;
    const again = await measure('Move: importing it again, nothing new', 240_000, () => importData(file, NOW));
    expect(again.result).not.toBe('busy');
    if (again.result !== 'busy') expect(again.result.added.items).toBe(0);

    await resetDb();
    const moved = await measure('Move: importing into an empty Xomoni', 240_000, () => importData(file, NOW));
    if (moved.result === 'busy') throw new Error('busy');
    expect(moved.result.added.items).toBe(history.items.length);
    expect(await db.items.count()).toBe(history.items.length);
  });

  it('the archive import saves 20,001 posts in two writes, so open pages don’t recount after every 2,000', async () => {
    await resetDb();
    await db.accounts.put(account);
    const tweets = Array.from({ length: 20_001 }, (_, n) => ({
      tweet: { id_str: String(1_500_000_000_000_000_000n + BigInt(n)), full_text: `post ${String(n)}` },
    }));
    const imported = await measure('Archive import: 20,001 posts', 60_000, () =>
      importArchive(
        [
          new File([`window.YTD.account.part0 = ${JSON.stringify([{ account: { accountId: id } }])}`], 'account.js'),
          new File([`window.YTD.tweets.part0 = ${JSON.stringify(tweets)}`], 'tweets.js'),
        ],
        account,
        () => undefined,
      ),
    );
    expect(imported.result.tweets).toBe(20_001);
    expect(imported.reads.writes.items).toBe(2);
  });

  it('the archive import takes X’s whole archive, in chunks', async () => {
    await resetDb();
    await db.accounts.put(account);
    const files = archiveFilesOf(history);
    const fromArchive = history.items.filter((i) => i.sources.includes('archive'));
    const imported = await measure('Archive import', 240_000, () =>
      importArchive(
        [
          new File([files.account], 'account.js'),
          new File([files.tweets], 'tweets.js'),
          new File([files.likes], 'like.js'),
        ],
        account,
        () => undefined,
      ),
    );
    expect(imported.result).toEqual({
      tweets: fromArchive.filter((i) => i.kind !== 'like').length,
      likes: fromArchive.filter((i) => i.kind === 'like').length,
    });
    expect(await db.items.count()).toBe(fromArchive.length);
    expect(await archiveImported(id)).toBe(true);
  });
});
