import { useLiveQuery } from 'dexie-react-hooks';
import { unseenPosts } from '../shared/coverage';
import { archiveImported, archiveImportedAt, archiveRequest, db, postTotals } from '../shared/db';
import type { Account, Item, ItemKind, ItemStatus, Job, ScanTarget } from '../shared/types';
import type { ArchiveRequest } from '../shared/x-archive';

/** All item kinds, in display order. */
export const KINDS: ItemKind[] = ['post', 'reply', 'repost', 'like'];

/** Per item kind: items still on X (`present`) and items Xomoni removed (`deleted`). Items marked `gone` are not counted. */
export type KindCounts = Record<ItemKind, { present: number; deleted: number }>;

/** Every item of a kind of an account, counted on the primary key (`<account id>:<kind>:<id>`), whatever its status. */
function countKind(accountId: string, kind: ItemKind) {
  return db.items.where(':id').between(`${accountId}:${kind}:`, `${accountId}:${kind};`).count();
}

function countStatus(accountId: string, kind: ItemKind, status: ItemStatus) {
  return db.items
    .where('[accountId+kind+status+createdAt]')
    .between([accountId, kind, status, -Infinity], [accountId, kind, status, Infinity])
    .count();
}

/**
 * `KindCounts` for an account, counted without loading rows: the items removed and gone on the compound index, and
 * those present as all of the kind, counted on the primary key, less those (#390). In a browser, counting on an index
 * checks each entry against its row, about five times as slow as on the primary key: with a heavy X user's 200,000
 * items, the counts alone kept Home and the Library waiting two seconds. Every item has one of the three statuses.
 */
export async function kindCounts(accountId: string): Promise<KindCounts> {
  const entries = await Promise.all(
    KINDS.map(async (k) => {
      const [all, deleted, gone] = await Promise.all([
        countKind(accountId, k),
        countStatus(accountId, k, 'deleted'),
        countStatus(accountId, k, 'gone'),
      ]);
      return [k, { present: all - deleted - gone, deleted }] as const;
    }),
  );
  return Object.fromEntries(entries) as KindCounts;
}

/** Live `KindCounts` for an account (`kindCounts`); undefined while loading or without an account. */
export function useKindCounts(accountId: string | undefined): KindCounts | undefined {
  return useLiveQuery(async () => (accountId ? kindCounts(accountId) : undefined), [accountId]);
}

/** One year of `yearHistogram`: how many present items of each kind were created in it. */
export interface YearCount {
  year: number;
  values: Record<string, number>;
}

/** Items the Library lists on one page (`libraryPage`). */
export const LIBRARY_PAGE_SIZE = 25;

/** What the Library lists: one kind, still on X or removed, with an optional search, at a page (from 0). */
export interface LibraryQuery {
  accountId: string;
  kind: ItemKind;
  status: 'present' | 'deleted';
  /** Words in the text, or an author with or without its `@`; case doesn't matter. Empty lists everything. */
  query: string;
  page: number;
}

/** Rows a search reads at a time, newest first. */
const SEARCH_CHUNK = 1_000;

/**
 * The items of one list, newest first (by `createdAt`, then by key, as the index orders them), handed to `take` a
 * bulk read of `SEARCH_CHUNK` at a time until it returns true or the list ends. A cursor would hand them over one at a
 * time, which took seconds for a heavy X user's tens of thousands of posts (#390).
 */
async function newestFirst(
  accountId: string,
  kind: ItemKind,
  status: ItemStatus,
  take: (items: readonly Item[]) => boolean,
): Promise<void> {
  let upper = Infinity;
  // Items read already with `createdAt` equal to `upper`: the next read starts at that time again, so none is missed.
  let seen = new Set<string>();
  for (;;) {
    const limit = SEARCH_CHUNK + seen.size;
    const rows = await db.items
      .where('[accountId+kind+status+createdAt]')
      .between([accountId, kind, status, -Infinity], [accountId, kind, status, upper], true, true)
      .reverse()
      .limit(limit)
      .toArray();
    if (take(rows.filter((item) => !(item.createdAt === upper && seen.has(item.key))))) return;
    const last = rows.at(-1);
    if (rows.length < limit || !last) return;
    const tied = rows.filter((item) => item.createdAt === last.createdAt).map((item) => item.key);
    seen = new Set(last.createdAt === upper ? [...seen, ...tied] : tied);
    upper = last.createdAt;
  }
}

/**
 * One page of the Library, newest first: `LIBRARY_PAGE_SIZE` items of the kind and status, matching the search in
 * their text or their author. Without a search it reads only the page; with one, the list in bulk reads, newest
 * first, until the page is full (#390).
 */
export async function libraryPage({ accountId, kind, status, query, page }: LibraryQuery): Promise<Item[]> {
  const q = query.trim().toLowerCase();
  if (!q) {
    return db.items
      .where('[accountId+kind+status+createdAt]')
      .between([accountId, kind, status, -Infinity], [accountId, kind, status, Infinity])
      .reverse()
      .offset(page * LIBRARY_PAGE_SIZE)
      .limit(LIBRARY_PAGE_SIZE)
      .toArray();
  }
  // Authors are stored without the "@" the rows show and the search box suggests.
  const author = q.replace(/^@/, '');
  const wanted = (page + 1) * LIBRARY_PAGE_SIZE;
  const found: Item[] = [];
  await newestFirst(accountId, kind, status, (items) => {
    for (const i of items) {
      if (i.text.toLowerCase().includes(q) || i.author.toLowerCase().includes(author)) found.push(i);
    }
    return found.length >= wanted;
  });
  return found.slice(page * LIBRARY_PAGE_SIZE, wanted);
}

/** The newest and oldest `createdAt` of an account's present items of one kind, with a known date; null if none. */
async function presentSpan(accountId: string, kind: ItemKind): Promise<[number, number] | null> {
  const present = () =>
    db.items
      .where('[accountId+kind+status+createdAt]')
      .between([accountId, kind, 'present', 1], [accountId, kind, 'present', Infinity]);
  const [first] = (await present().limit(1).keys()) as unknown as [string, string, string, number][];
  const [last] = (await present().reverse().limit(1).keys()) as unknown as [string, string, string, number][];
  return first && last ? [first[3], last[3]] : null;
}

/**
 * Present items per year (local time) and kind, from the first year with any to the last, empty years included.
 * Counted on the index a year at a time (#390): no row is loaded, and no cursor walks the inventory, which took
 * seconds for 100,000 items. Items without a date (`createdAt` 0) are left out.
 */
export async function yearHistogram(accountId: string, kinds: readonly ItemKind[]): Promise<YearCount[]> {
  const byYear = new Map<number, Record<string, number>>();
  for (const kind of kinds) {
    const span = await presentSpan(accountId, kind);
    if (!span) continue;
    const [from, to] = span.map((at) => new Date(at).getFullYear()) as [number, number];
    for (let year = from; year <= to; year++) {
      // At least 1: the first year's start is before 1970 in time zones east of UTC, where 0 means no date.
      const start = Math.max(1, new Date(year, 0, 1).getTime());
      const count = await db.items
        .where('[accountId+kind+status+createdAt]')
        .between([accountId, kind, 'present', start], [accountId, kind, 'present', new Date(year + 1, 0, 1).getTime()])
        .count();
      if (count) byYear.set(year, { ...byYear.get(year), [kind]: count });
    }
  }
  if (!byYear.size) return [];
  const years = [...byYear.keys()];
  const out: YearCount[] = [];
  for (let y = Math.min(...years); y <= Math.max(...years); y++) out.push({ year: y, values: byYear.get(y) ?? {} });
  return out;
}

/** Live `yearHistogram`; undefined while loading or without an account. */
export function useYearHistogram(accountId: string | undefined, kinds: ItemKind[]) {
  const key = kinds.join(',');
  return useLiveQuery(async () => (accountId ? yearHistogram(accountId, kinds) : undefined), [accountId, key]);
}

/** Scan targets that read the recent timelines, and those that search the whole history (`range` is neither). */
const READS_RECENT: readonly ScanTarget[] = ['posts', 'replies', 'likes', 'complete'];
const READS_HISTORY: readonly ScanTarget[] = ['history', 'complete'];
const UNFINISHED: readonly Job['state'][] = ['queued', 'running', 'waiting', 'paused', 'blocked'];

/** How complete Xomoni's copy of an account is, for the Library (#185). */
export interface CopyStatus {
  /** Posts, replies and reposts Xomoni has that are still on X. */
  present: number;
  /** X's own count of posts, replies and reposts, when its profile was last read; null until then. */
  postsCount: number | null;
  /** About how many of those X has that Xomoni doesn't (PLAYBOOK E2); null when X's count is unknown. */
  unseen: number | null;
  /** Whether X's archive was imported; `importedAt` is null for imports made before the date was kept. */
  archive: { imported: boolean; importedAt: number | null };
  /** When a read of the recent timelines last finished; null if never. */
  recentAt: number | null;
  /** When a search of the whole history last finished; null if never. */
  historyAt: number | null;
  /** A read that hasn't finished yet (running, waiting, paused, blocked or never started), newest first. */
  openRead: Job | null;
}

/** When the newest finished scan of one of `targets` ended, or null. */
function lastFinished(jobs: readonly Job[], targets: readonly ScanTarget[]): number | null {
  let at: number | null = null;
  for (const job of jobs) {
    if (job.state !== 'completed' || !job.scan || !targets.includes(job.scan) || job.finishedAt == null) continue;
    at = Math.max(at ?? 0, job.finishedAt);
  }
  return at;
}

/** The `CopyStatus` of an account. */
export async function copyStatus(account: Account): Promise<CopyStatus> {
  const jobs = (await db.jobs.where('accountId').equals(account.id).toArray()).filter(
    (job) => job.kind === 'scan' && job.scan !== 'range',
  );
  const totals = await postTotals(account);
  const openRead = jobs.filter((job) => UNFINISHED.includes(job.state)).sort((a, b) => b.createdAt - a.createdAt)[0];
  return {
    present: totals.present,
    postsCount: account.postsCount,
    unseen: unseenPosts({ postsCount: account.postsCount, profileSeen: account.profileAt != null, ...totals }),
    archive: { imported: await archiveImported(account.id), importedAt: await archiveImportedAt(account.id) },
    recentAt: lastFinished(jobs, READS_RECENT),
    historyAt: lastFinished(jobs, READS_HISTORY),
    openRead: openRead ?? null,
  };
}

/** Live `copyStatus` of an account; undefined while loading. */
export function useCopyStatus(account: Account): CopyStatus | undefined {
  return useLiveQuery(() => copyStatus(account), [account.id, account.postsCount, account.profileAt]);
}

/** Where getting X's archive through X's page stands for one account (#186). */
export interface ArchiveStatus {
  /** The archive asked for on X and not yet given up on, or null. */
  request: ArchiveRequest | null;
  /** Whether an X archive was imported; `importedAt` is null for imports made before the date was kept. */
  imported: boolean;
  /** When an X archive was last imported, or null. */
  importedAt: number | null;
  /** The account's archive job that hasn't finished (queued, running, waiting, paused or blocked), or null. */
  openJob: Job | null;
}

/** The `ArchiveStatus` of an account. */
export async function archiveStatus(accountId: string): Promise<ArchiveStatus> {
  const jobs = await db.jobs.where('accountId').equals(accountId).toArray();
  return {
    request: await archiveRequest(accountId),
    imported: await archiveImported(accountId),
    importedAt: await archiveImportedAt(accountId),
    openJob: jobs.find((job) => job.kind === 'archive' && job.finishedAt == null) ?? null,
  };
}

/** Live `archiveStatus` of an account; undefined while loading. */
export function useArchiveStatus(accountId: string): ArchiveStatus | undefined {
  return useLiveQuery(() => archiveStatus(accountId), [accountId]);
}
