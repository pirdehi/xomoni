import Dexie, { type Table } from 'dexie';
import { type RiskEvent, type RiskEventKind, isDuplicateRisk } from './risk';
import { normalizeSettings } from './settings';
import { DAY } from './time';
import {
  WATCH_TABS,
  type WatchResult,
  type WatchTab,
  isInitialTab,
  newTabId,
  normalizeQuery,
  normalizeTabs,
} from './watch';
import type { ArchiveRequest } from './x-archive';
import type { ViewCap } from './x-limits';
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
  /** Posts the page load or scroll showed, for the daily view cap (#28); missing on older rows. */
  posts?: number;
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

/**
 * Tables "Delete local data" keeps on purpose (#151). They hold no X content, only account ids and times, and keep
 * Xomoni within X's limits and the risk ladder: page loads of the last 24 hours (`reads`) and the risk events
 * (`risk`). Without them, a wipe right after a warning from X would let Xomoni run at full pace again at once.
 */
export const KEPT_ON_WIPE: readonly string[] = ['reads', 'risk'];

/**
 * Deletes everything Xomoni keeps in this browser except `KEPT_ON_WIPE`, in one transaction: the inventory, jobs,
 * the activity log, X's observed limits, accounts, sampled post ids to check again (`checks`), consents, and
 * `kv` (settings, Watch, the xomoni.com connection). A table added later is wiped too unless it is listed there.
 * Disconnect from xomoni.com first: that needs the token this deletes.
 */
export async function wipeLocalData() {
  const wiped = db.tables.filter((table) => !KEPT_ON_WIPE.includes(table.name));
  await db.transaction('rw', wiped, () => Promise.all(wiped.map((table) => table.clear())));
}

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
          key: itemKey(accountId, d.kind, d.id),
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

/** Where an account's Watch tabs (#158) are kept in `kv`. */
export const watchTabsKey = (accountId: string) => `watchTabs:${accountId}`;
/** Where the last check of each of an account's Watch tabs is kept in `kv`, by tab id. */
export const watchResultsKey = (accountId: string) => `watchResults:${accountId}`;

/** An account's Watch tabs, checked by `normalizeTabs`: the two initial ones when nothing is stored. */
export async function watchTabs(accountId: string): Promise<WatchTab[]> {
  return normalizeTabs(await kvGet<unknown>(watchTabsKey(accountId), null));
}

/** Stores an account's Watch tabs, and forgets the results of tabs no longer there. */
export async function saveWatchTabs(accountId: string, tabs: readonly WatchTab[]) {
  const kept = normalizeTabs(tabs);
  await db.transaction('rw', db.kv, async () => {
    await kvSet(watchTabsKey(accountId), kept);
    const results = await watchResults(accountId);
    const ids = new Set(kept.map((t) => t.id));
    await kvSet(watchResultsKey(accountId), Object.fromEntries(Object.entries(results).filter(([id]) => ids.has(id))));
  });
}

/**
 * Adds a Watch tab after the others and returns its id, or null when there are `WATCH_TABS.max` already. In one
 * transaction, so quick clicks never give two tabs the same id.
 */
export async function addWatchTab(accountId: string): Promise<string | null> {
  return db.transaction('rw', db.kv, async () => {
    const tabs = await watchTabs(accountId);
    if (tabs.length >= WATCH_TABS.max) return null;
    const id = newTabId(tabs);
    await saveWatchTabs(accountId, [...tabs, { id, query: '' }]);
    return id;
  });
}

/** Sets the query of one Watch tab (normalized); a tab that isn't there is left as it is. */
export async function setWatchQuery(accountId: string, tabId: string, query: string) {
  await db.transaction('rw', db.kv, async () => {
    const tabs = await watchTabs(accountId);
    await saveWatchTabs(
      accountId,
      tabs.map((t) => (t.id === tabId ? { ...t, query: normalizeQuery(query) } : t)),
    );
  });
}

/** Removes a Watch tab added by the person, with its results; the initial tabs stay. */
export async function removeWatchTab(accountId: string, tabId: string) {
  await db.transaction('rw', db.kv, async () => {
    const tabs = await watchTabs(accountId);
    await saveWatchTabs(
      accountId,
      tabs.filter((t) => t.id !== tabId || isInitialTab(t)),
    );
  });
}

/** The last check of each of an account's Watch tabs, by tab id. */
export async function watchResults(accountId: string): Promise<Record<string, WatchResult>> {
  return kvGet<Record<string, WatchResult>>(watchResultsKey(accountId), {});
}

/** Stores the last check of one Watch tab. */
export async function saveWatchResult(accountId: string, tabId: string, result: WatchResult) {
  await db.transaction('rw', db.kv, async () => {
    await kvSet(watchResultsKey(accountId), { ...(await watchResults(accountId)), [tabId]: result });
  });
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

const archiveKey = (accountId: string) => `archive:${accountId}`;

/** Remembers that an X archive was imported for this account, for the Cleanup page's warning (PLAYBOOK E2). */
export async function markArchiveImported(accountId: string) {
  await kvSet(archiveKey(accountId), Date.now());
}

/** When an X archive was last imported for this account (epoch ms), or null; imports before #185 kept no date. */
export async function archiveImportedAt(accountId: string): Promise<number | null> {
  const at = await kvGet<number | null>(archiveKey(accountId), null);
  return typeof at === 'number' && at > 0 ? at : null;
}

const archiveRequestKey = (accountId: string) => `archiveRequest:${accountId}`;

/** The archive asked for on X for this account and not yet downloaded or given up on (#186), or null. */
export async function archiveRequest(accountId: string): Promise<ArchiveRequest | null> {
  const stored = await kvGet<ArchiveRequest | null>(archiveRequestKey(accountId), null);
  return stored && typeof stored.requestedAt === 'number' ? stored : null;
}

/** Keeps what the archive job saw of a request on X (#186); null forgets it. */
export async function saveArchiveRequest(accountId: string, request: ArchiveRequest | null) {
  await kvSet(archiveRequestKey(accountId), request);
}

/**
 * Posts, replies and reposts of an account still present in the inventory, and those Xomoni removed after X's count
 * was last seen, which that count still includes (PLAYBOOK E2). Counted on the index, without loading rows but the
 * removed ones.
 */
export async function postTotals(account: Account): Promise<{ present: number; removedSinceProfile: number }> {
  let present = 0;
  let removedSinceProfile = 0;
  for (const kind of ['post', 'reply', 'repost'] as const) {
    const range = (status: Item['status']) =>
      db.items
        .where('[accountId+kind+status+createdAt]')
        .between([account.id, kind, status, -Infinity], [account.id, kind, status, Infinity]);
    present += await range('present').count();
    removedSinceProfile += await range('deleted')
      .filter((item) => item.statusAt > (account.profileAt ?? Infinity))
      .count();
  }
  return { present, removedSinceProfile };
}

/**
 * Whether an X archive was ever imported for this account: the marker an import sets, or, for imports from
 * before the marker existed, an item that came from an archive. Read-only, so it can run inside a live query
 * (Dexie refuses writes there).
 */
export async function archiveImported(accountId: string): Promise<boolean> {
  if (await kvGet<number | null>(archiveKey(accountId), null)) return true;
  const fromArchive = await db.items
    .where('accountId')
    .equals(accountId)
    .filter((item) => item.sources.includes('archive'))
    .first();
  return !!fromArchive;
}

const viewCapKey = (accountId: string) => `viewCap:${accountId}`;

/** The daily view cap learned for an account (PLAYBOOK A4, #28), or null when none was learned. */
export function getViewCap(accountId: string): Promise<ViewCap | null> {
  return kvGet<ViewCap | null>(viewCapKey(accountId), null);
}

/** Stores the daily view cap learned for an account; it applies to every later run. */
export function setViewCap(accountId: string, cap: ViewCap) {
  return kvSet(viewCapKey(accountId), cap);
}
