import Dexie, { type Table } from 'dexie';
import { type RiskEvent, type RiskEventKind, isDuplicateRisk } from './risk';
import { normalizeSettings } from './settings';
import { DAY } from './time';
import { CONSENT_VERSION } from '@xomoni/consent';
import type {
  Account,
  Consent,
  Item,
  ItemDraft,
  ItemKind,
  ItemSource,
  Job,
  LogEntry,
  RateObservation,
  SampleCheck,
  Settings,
} from './types';

interface KV {
  key: string;
  value: unknown;
}

/**
 * One page load or scroll in the worker tab, kept for 24 hours so read budgets and the page-load caps
 * survive pauses and restarts. `budget` is a `BudgetId` from `x-limits.ts`.
 */
export interface ReadUse {
  /** Auto-increment key. */
  seq?: number;
  accountId: string;
  budget: string;
  /** Epoch ms. */
  ts: number;
}

class XomoniDB extends Dexie {
  accounts!: Table<Account, string>;
  items!: Table<Item, string>;
  jobs!: Table<Job, string>;
  logs!: Table<LogEntry, number>;
  limits!: Table<RateObservation, string>;
  reads!: Table<ReadUse, number>;
  risk!: Table<RiskEvent, number>;
  checks!: Table<SampleCheck, number>;
  consents!: Table<Consent, string>;
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
    this.version(2).stores({ reads: '++seq, [accountId+ts]' });
    this.version(3).stores({ risk: '++seq, [accountId+at]' });
    this.version(4).stores({ checks: '++seq, [accountId+dueAt]' });
    this.version(5).stores({ consents: 'accountId' });
  }
}

/**
 * The extension's IndexedDB database (`xomoni`), used by the dashboard and the service worker. Tables:
 * `accounts`, `items` (the inventory), `jobs`, `logs`, `limits` (X rate-limit observations), `reads` (page loads of
 * the last 24 hours), `risk` (the risk ladder's events, see `risk.ts`), `checks` (sampled actions to check again,
 * see `engine/samples.ts`), `consents` (informed consent per X account) and `kv`.
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
 * Creates or updates an account row and returns it. Fields that are `undefined`, `null` or `''` in `patch`
 * keep their stored value: X sometimes leaves a count or the creation date out of a response, and that must
 * not erase what is known (a lost `createdAt` would make the history scan start from 2006). `updatedAt`
 * becomes now.
 */
export async function upsertAccount(patch: Partial<Account> & { id: string }) {
  const prev = await db.accounts.get(patch.id);
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v != null && v !== '')) as Partial<Account>;
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
 * The stored settings over `DEFAULT_SETTINGS`, normalized by `normalizeSettings`: presets always use the
 * current numbers, and custom pacing is clamped to the one-fifth ceilings (ADR-0012).
 */
export async function getSettings(): Promise<Settings> {
  return normalizeSettings(await kvGet<Partial<Settings> | null>('settings', null));
}

/**
 * Appends an activity log entry stamped with the current time. Entries with `outcome: 'done'` count toward
 * the limiter's caps when the next run starts.
 */
export function addLog(entry: Omit<LogEntry, 'ts' | 'seq'>) {
  return db.logs.add({ ...entry, ts: Date.now() });
}

/** The account's risk events of the last 30 days (the longest window the risk ladder looks at). */
export function riskEvents(accountId: string) {
  return db.risk
    .where('[accountId+at]')
    .between([accountId, Date.now() - 30 * DAY], [accountId, Infinity])
    .toArray();
}

/**
 * Records a risk event for the account, unless the same signal was recorded in the last 10 minutes.
 * Returns the account's events afterwards, ready for `assessRisk`.
 */
export async function recordRisk(accountId: string, kind: RiskEventKind): Promise<RiskEvent[]> {
  const events = await riskEvents(accountId);
  const now = Date.now();
  if (isDuplicateRisk(events, kind, now)) return events;
  const event: RiskEvent = { accountId, kind, at: now };
  await db.risk.add(event);
  return [...events, event];
}

/** Whether the person gave informed consent for this X account to the current version of the text (#24). */
export async function hasConsent(accountId: string): Promise<boolean> {
  const consent = await db.consents.get(accountId);
  return !!consent && consent.version >= CONSENT_VERSION;
}

/** Records the person's informed consent for this X account, for the current version of the text. */
export async function recordConsent(accountId: string) {
  await db.consents.put({ accountId, version: CONSENT_VERSION, at: Date.now() });
}
