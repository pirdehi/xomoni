import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../shared/db';
import type { ItemKind, ItemStatus } from '../shared/types';

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
