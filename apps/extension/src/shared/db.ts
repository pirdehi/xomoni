import Dexie, { type Table } from 'dexie';
import { DEFAULT_SETTINGS } from './settings';
import type { Account, Item, ItemDraft, ItemKind, ItemSource, Job, LogEntry, RateObservation, Settings } from './types';

interface KV {
  key: string;
  value: unknown;
}

class XomoniDB extends Dexie {
  accounts!: Table<Account, string>;
  items!: Table<Item, string>;
  jobs!: Table<Job, string>;
  logs!: Table<LogEntry, number>;
  limits!: Table<RateObservation, string>;
  kv!: Table<KV, string>;

  constructor() {
    super('xomoni');
    this.version(1).stores({
      accounts: 'id, handle, updatedAt',
      items: 'key, accountId, [accountId+kind+createdAt], [accountId+kind+status+createdAt], [accountId+targetId]',
      jobs: 'id, accountId, state, createdAt',
      logs: '++seq, ts, [accountId+ts], jobId',
      limits: 'key, accountId',
      kv: 'key',
    });
  }
}

/**
 * The extension's IndexedDB database (`xomoni`), used by the dashboard and the service worker. Tables:
 * `accounts`, `items` (the inventory), `jobs`, `logs`, `limits` (X rate-limit observations) and `kv`.
 * @remarks Content scripts cannot use it: they run under x.com's origin, so they message the service worker.
 */
export const db = new XomoniDB();

/** Primary key of an inventory item in the `items` table. */
export const itemKey = (accountId: string, kind: ItemKind, id: string) => `${accountId}:${kind}:${id}`;

/**
 * Merges drafts into the inventory. Live observations refresh metrics and can
 * revive an item marked deleted only if they were captured after that mark.
 */
export async function upsertItems(accountId: string, drafts: ItemDraft[], source: ItemSource, observedAt = Date.now()) {
  if (!drafts.length) return 0;
  return db.transaction('rw', db.items, async () => {
    const keys = drafts.map((d) => itemKey(accountId, d.kind, d.id));
    const existing = await db.items.bulkGet(keys);
    const rows: Item[] = drafts.map((d, i) => {
      const prev = existing[i];
      if (!prev) {
        return {
          ...d,
          key: keys[i],
          accountId,
          sources: [source],
          status: 'present',
          seenAt: source === 'scan' ? observedAt : 0,
          statusAt: observedAt,
          lastJobId: null,
        };
      }
      const next: Item = { ...prev, sources: prev.sources.includes(source) ? prev.sources : [...prev.sources, source] };
      if (source === 'scan') {
        Object.assign(next, {
          text: d.text || prev.text,
          author: d.author || prev.author,
          likes: d.likes,
          reposts: d.reposts,
          replies: d.replies,
          createdAt: d.createdAt || prev.createdAt,
          seenAt: observedAt,
        });
        if (prev.status !== 'present' && observedAt > prev.statusAt + 5_000) {
          next.status = 'present';
          next.statusAt = observedAt;
        }
      } else {
        next.text ||= d.text;
        next.author ||= d.author;
        next.createdAt ||= d.createdAt;
      }
      next.targetId ||= d.targetId;
      if (d.likedAt != null) next.likedAt = Math.max(prev.likedAt ?? 0, d.likedAt);
      return next;
    });
    await db.items.bulkPut(rows);
    return rows.length;
  });
}

/**
 * Creates or updates an account row and returns it. Fields that are `undefined` or `''` in `patch` keep
 * their stored value; `updatedAt` becomes now.
 */
export async function upsertAccount(patch: Partial<Account> & { id: string }) {
  const prev = await db.accounts.get(patch.id);
  const clean = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined && v !== ''),
  ) as Partial<Account>;
  const next: Account = {
    handle: '',
    name: '',
    avatar: '',
    postsCount: null,
    likesCount: null,
    followers: null,
    following: null,
    createdAt: null,
    ...prev,
    ...clean,
    id: patch.id,
    updatedAt: Date.now(),
  };
  await db.accounts.put(next);
  return next;
}

/** Reads a value from the `kv` table, or `fallback` when the key is missing. The value is not validated. */
export async function kvGet<T>(key: string, fallback: T): Promise<T> {
  const row = await db.kv.get(key);
  return row ? (row.value as T) : fallback;
}

/** Writes a value to the `kv` table. Keys in use: `settings` and `activeAccount`. */
export async function kvSet(key: string, value: unknown) {
  await db.kv.put({ key, value });
}

/**
 * The stored settings merged over `DEFAULT_SETTINGS`, so fields added later get defaults. `pacing` merges
 * per action: a stored rule replaces that action's default rule as a whole.
 */
export async function getSettings(): Promise<Settings> {
  const stored = await kvGet<Partial<Settings> | null>('settings', null);
  return { ...DEFAULT_SETTINGS, ...stored, pacing: { ...DEFAULT_SETTINGS.pacing, ...stored?.pacing } };
}

/**
 * Appends an activity log entry stamped with the current time. Entries with `outcome: 'done'` count toward
 * the limiter's caps when the next run starts.
 */
export function addLog(entry: Omit<LogEntry, 'ts' | 'seq'>) {
  return db.logs.add({ ...entry, ts: Date.now() });
}
