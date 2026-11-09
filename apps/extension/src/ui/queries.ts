import { useLiveQuery } from 'dexie-react-hooks';
import { unseenPosts } from '../shared/coverage';
import { archiveImported, archiveImportedAt, archiveRequest, db, postTotals } from '../shared/db';
import type { Account, ItemKind, ItemStatus, Job, ScanTarget } from '../shared/types';
import type { ArchiveRequest } from '../shared/x-archive';

/** All item kinds, in display order. */
export const KINDS: ItemKind[] = ['post', 'reply', 'repost', 'like'];

/** Per item kind: items still on X (`present`) and items Xomoni removed (`deleted`). Items marked `gone` are not counted. */
export type KindCounts = Record<ItemKind, { present: number; deleted: number }>;

function countStatus(accountId: string, kind: ItemKind, status: ItemStatus) {
  return db.items
    .where('[accountId+kind+status+createdAt]')
    .between([accountId, kind, status, -Infinity], [accountId, kind, status, Infinity])
    .count();
}

/** Live `KindCounts` for an account, counted on the compound index without loading rows; undefined while loading or without an account. */
export function useKindCounts(accountId: string | undefined): KindCounts | undefined {
  return useLiveQuery(async () => {
    if (!accountId) return undefined;
    const entries = await Promise.all(
      KINDS.map(
        async (k) =>
          [
            k,
            {
              present: await countStatus(accountId, k, 'present'),
              deleted: await countStatus(accountId, k, 'deleted'),
            },
          ] as const,
      ),
    );
    return Object.fromEntries(entries) as KindCounts;
  }, [accountId]);
}

/** Present items per year and kind, read from index keys only (no row loads). */
export function useYearHistogram(accountId: string | undefined, kinds: ItemKind[]) {
  const key = kinds.join(',');
  return useLiveQuery(async () => {
    if (!accountId) return undefined;
    const byYear = new Map<number, Record<string, number>>();
    for (const kind of kinds) {
      const keys = (await db.items
        .where('[accountId+kind+status+createdAt]')
        .between([accountId, kind, 'present', 1], [accountId, kind, 'present', Infinity])
        .keys()) as unknown as [string, string, string, number][];
      for (const k of keys) {
        const year = new Date(k[3]).getFullYear();
        const row = byYear.get(year) ?? {};
        row[kind] = (row[kind] ?? 0) + 1;
        byYear.set(year, row);
      }
    }
    if (!byYear.size) return [];
    const years = [...byYear.keys()];
    const out: { year: number; values: Record<string, number> }[] = [];
    for (let y = Math.min(...years); y <= Math.max(...years); y++) out.push({ year: y, values: byYear.get(y) ?? {} });
    return out;
  }, [accountId, key]);
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

/** Live `CopyStatus` of an account; undefined while loading. */
export function useCopyStatus(account: Account): CopyStatus | undefined {
  return useLiveQuery(async () => {
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
  }, [account.id, account.postsCount, account.profileAt]);
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

/** Live `ArchiveStatus` of an account; undefined while loading. */
export function useArchiveStatus(accountId: string): ArchiveStatus | undefined {
  return useLiveQuery(async () => {
    const jobs = await db.jobs.where('accountId').equals(accountId).toArray();
    return {
      request: await archiveRequest(accountId),
      imported: await archiveImported(accountId),
      importedAt: await archiveImportedAt(accountId),
      openJob: jobs.find((job) => job.kind === 'archive' && job.finishedAt == null) ?? null,
    };
  }, [accountId]);
}
