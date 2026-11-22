import Dexie, { type Table } from 'dexie';
import {
  type DailyRow,
  type DailyStats,
  type ProfileCounts,
  type PublishedItem,
  type Removal,
  addDelta,
  emptyDay,
  isEmptyDelta,
  localDay,
  sightingDelta,
  sumDeltas,
  withProfile,
  withPublishedAndRemoved,
} from './daily';
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
import { type ArchiveRequest, expectsArchive } from './x-archive';
import type { ViewCap } from './x-limits';
import { CONSENT_VERSION } from '@xomoni/consent';
import type {
  Account,
  Consent,
  IncomingReply,
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
  daily!: Table<DailyStats, [string, string]>;
  incoming!: Table<IncomingReply, string>;
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
    this.version(6).stores({ daily: '[accountId+day], accountId' });
    this.version(7).stores({ incoming: 'key, accountId, [accountId+createdAt]' });
  }
}

/**
 * The extension's IndexedDB database (`xomoni`), used by the dashboard and the service worker. Tables:
 * `accounts`, `items` (the inventory), `jobs`, `logs`, `limits` (X rate-limit observations), `reads` (page loads of
 * the last 24 hours), `risk` (the risk ladder's events, see `risk.ts`), `checks` (sampled actions to check again,
 * see `engine/samples.ts`), `consents` (informed consent per X account), `daily` (each day's numbers), `incoming`
 * (replies others wrote to the person, ADR-0030, see `incoming.ts`) and `kv`.
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
 * The `kv` keys of a one-click update of a zip install (#305, ADR-0033), defined here so wiping can keep them and
 * `update/` names them once: the journal that can put back an update cut short (`journal`), Xomoni's own folder, which
 * putting back needs (`folder`), and the files the last one-click update wrote (`shipped`), the only files a later one
 * may remove. They hold no X content, only Xomoni's own files.
 */
export const UPDATE_KEYS = { journal: 'updateJournal', folder: 'ownFolder', shipped: 'updateShipped' } as const;

/** The `kv` values `wipeLocalData` keeps: an update's (`UPDATE_KEYS`), so wiping never strands a half-written Xomoni. */
export const KV_KEPT_ON_WIPE: readonly string[] = Object.values(UPDATE_KEYS);

/**
 * Deletes everything Xomoni keeps in this browser except `KEPT_ON_WIPE`, in one transaction: the inventory, jobs,
 * the activity log, X's observed limits, accounts, sampled post ids to check again (`checks`), consents, and
 * `kv` (settings, Watch, the xomoni.com connection) but `KV_KEPT_ON_WIPE`. A table added later is wiped too unless it
 * is listed there. Disconnect from xomoni.com first: that needs the token this deletes.
 */
export async function wipeLocalData() {
  const wiped = db.tables.filter((table) => !KEPT_ON_WIPE.includes(table.name));
  await db.transaction('rw', wiped, () =>
    Promise.all(
      wiped.map((table) =>
        // By name: `db.tables` hands out other `Table` objects than `db.kv`.
        table.name === 'kv'
          ? db.kv
              .where('key')
              .noneOf([...KV_KEPT_ON_WIPE])
              .delete()
          : table.clear(),
      ),
    ),
  );
}

/**
 * The `kv` values kept for one account (`<name>:<account id>`) that removing its data keeps, like `KEPT_ON_WIPE`:
 * the daily view cap learned from X (`viewCap`, PLAYBOOK A4) holds no X content and keeps Xomoni within X's limits.
 */
const KEPT_ACCOUNT_VALUES: readonly string[] = ['viewCap'];

/**
 * Removes one X account's data from this browser when the person signs out with *Remove its data* (#226): its
 * inventory, jobs, activity log, X's observed limits, sampled posts to check again, its consent, its daily numbers, the
 * replies others wrote to it (ADR-0030), every `kv` value
 * kept for it (Watch, the archive and its request, archive files seen) and the account itself, in one transaction.
 * Like `wipeLocalData`, it keeps `KEPT_ON_WIPE` and the view cap, so X's limits still hold; other accounts keep
 * everything. Stop the account's running job first.
 */
export async function forgetAccount(accountId: string) {
  const own = (key: string) => {
    const at = key.indexOf(':');
    return at > 0 && key.slice(at + 1) === accountId && !KEPT_ACCOUNT_VALUES.includes(key.slice(0, at));
  };
  const tables = [
    db.accounts,
    db.items,
    db.jobs,
    db.logs,
    db.limits,
    db.checks,
    db.consents,
    db.daily,
    db.incoming,
    db.kv,
  ];
  await db.transaction('rw', tables, async () => {
    const whole: [string, number] = [accountId, -Infinity];
    const end: [string, number] = [accountId, Infinity];
    await db.items.where('accountId').equals(accountId).delete();
    await db.jobs.where('accountId').equals(accountId).delete();
    await db.logs.where('[accountId+ts]').between(whole, end, true, true).delete();
    await db.limits.where('accountId').equals(accountId).delete();
    await db.checks.where('[accountId+dueAt]').between(whole, end, true, true).delete();
    await db.consents.delete(accountId);
    await db.daily.where('accountId').equals(accountId).delete();
    await db.incoming.where('accountId').equals(accountId).delete();
    await db.kv.filter((row) => own(row.key)).delete();
    if ((await kvGet<string | null>('activeAccount', null)) === accountId) await db.kv.delete('activeAccount');
    await db.accounts.delete(accountId);
  });
}

/** Primary key of an inventory item in the `items` table. */
export const itemKey = (accountId: string, kind: ItemKind, id: string) => `${accountId}:${kind}:${id}`;

/**
 * Merges drafts into the inventory. Live observations refresh metrics and can
 * revive an item marked deleted only if they were captured after that mark.
 * A live sighting also adds what it shows to the day's numbers (#249): the rise
 * in the counts of the person's own posts since they were last seen.
 */
export async function upsertItems(accountId: string, drafts: ItemDraft[], source: ItemSource, observedAt = Date.now()) {
  if (!drafts.length) return 0;
  return db.transaction('rw', db.items, db.daily, async () => {
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
        for (const name of ['quotes', 'bookmarks', 'views', 'quote'] as const) {
          if (d[name] !== undefined) Object.assign(next, { [name]: d[name] });
        }
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
      // Whom a reply answers (#256): what X shows live wins; the archive only fills it in.
      if (d.replyTo && (source === 'scan' || !next.replyTo)) next.replyTo = d.replyTo;
      if (d.likedAt != null) next.likedAt = Math.max(prev.likedAt ?? 0, d.likedAt);
      return next;
    });
    await db.items.bulkPut(rows);
    if (source === 'scan') await addSightings(accountId, existing, rows, observedAt);
    return rows.length;
  });
}

/** Adds the sightings of one live observation to the day's numbers; runs inside `upsertItems`'s transaction. */
async function addSightings(
  accountId: string,
  before: readonly (Item | undefined)[],
  after: readonly Item[],
  observedAt: number,
) {
  const sum = sumDeltas(after.map((next, i) => sightingDelta(before[i], next, observedAt)));
  if (isEmptyDelta(sum)) return;
  const day = localDay(observedAt);
  const row = (await db.daily.get([accountId, day])) ?? emptyDay(accountId, day, observedAt);
  await db.daily.put(addDelta(row, sum, Date.now()));
}

/**
 * Keeps the profile's counts X showed at `at` as that day's (#249). A count X left out keeps the day's earlier value.
 */
export async function recordProfileDay(accountId: string, profile: ProfileCounts, at: number): Promise<void> {
  const day = localDay(at);
  await db.transaction('rw', db.daily, async () => {
    const row = (await db.daily.get([accountId, day])) ?? emptyDay(accountId, day, at);
    await db.daily.put(withProfile(row, profile, at));
  });
}

const PUBLISHED_KINDS = ['post', 'reply', 'repost'] as const;

/**
 * The account's days from `from` to `to` (epoch ms, inclusive), oldest first (#249): the recorded numbers, what the
 * person published (from the inventory) and what Xomoni removed (from the activity log). A day with none of them is
 * left out, so a page shows a gap, not zeros.
 */
export async function dailyRows(accountId: string, from: number, to: number): Promise<DailyRow[]> {
  const [first, last] = [localDay(from), localDay(to)];
  const stored = await db.daily
    .where('[accountId+day]')
    .between([accountId, first], [accountId, last], true, true)
    .toArray();
  const published: PublishedItem[] = [];
  for (const kind of PUBLISHED_KINDS) {
    const items = await db.items
      .where('[accountId+kind+createdAt]')
      .between([accountId, kind, from], [accountId, kind, to], true, true)
      .toArray();
    for (const item of items) published.push({ kind, createdAt: item.createdAt, quote: item.quote });
  }
  const logs = await db.logs.where('[accountId+ts]').between([accountId, from], [accountId, to], true, true).toArray();
  const done = logs.filter((l) => l.outcome === 'done' && l.action !== 'system' && l.action !== 'read' && l.targetId);
  const deletes = done.filter((l) => l.action === 'delete');
  const replies = await db.items.bulkGet(deletes.map((l) => itemKey(accountId, 'reply', l.targetId ?? '')));
  const isReply = new Set(replies.filter((r): r is Item => r !== undefined).map((r) => r.id));
  const removals: Removal[] = done.map((l) => ({
    kind:
      l.action === 'delete'
        ? isReply.has(l.targetId ?? '')
          ? 'reply'
          : 'post'
        : l.action === 'unretweet'
          ? 'repost'
          : 'like',
    at: l.ts,
  }));
  return withPublishedAndRemoved(accountId, stored, published, removals, Date.now());
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

/**
 * Sets an account's Watch searches in order, as xomoni.com sends them (ADR-0029): each tab keeps its place and id,
 * tabs past the end are removed (the initial ones come back empty), and a tab whose search changed loses its old
 * results, so they never show under the new search.
 */
export async function setWatchQueries(accountId: string, queries: readonly string[]) {
  await db.transaction('rw', db.kv, async () => {
    const before = await watchTabs(accountId);
    const tabs: WatchTab[] = [];
    for (const query of queries.slice(0, WATCH_TABS.max)) {
      tabs.push({ id: before[tabs.length]?.id ?? newTabId([...before, ...tabs]), query: normalizeQuery(query) });
    }
    await saveWatchTabs(accountId, tabs);
    const kept = await watchTabs(accountId);
    const same = new Set(kept.filter((t) => before.some((b) => b.id === t.id && b.query === t.query)).map((t) => t.id));
    const results = await watchResults(accountId);
    await kvSet(watchResultsKey(accountId), Object.fromEntries(Object.entries(results).filter(([id]) => same.has(id))));
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

const ARCHIVE_FOLDER_CHOSEN = 'archiveFolderChosen';

/** Remembers whether the person chose the Xomoni folder in Downloads for the archive's import (#196). */
export async function setArchiveFolderChosen(chosen: boolean) {
  await kvSet(ARCHIVE_FOLDER_CHOSEN, chosen);
}

/**
 * Whether Xomoni is waiting for X's archive to land in Downloads (`expectsArchive`), read from the database: the
 * service worker asks it for each download named like X's archive, to save that one in the Xomoni folder (#196).
 */
export async function expectingArchive(now = Date.now()): Promise<boolean> {
  const rows = await db.kv.where('key').startsWith(archiveRequestKey('')).toArray();
  const requests = rows
    .map((row) => row.value as ArchiveRequest | null)
    .filter((r): r is ArchiveRequest => !!r && typeof r.requestedAt === 'number');
  return expectsArchive(requests, (await kvGet<unknown>(ARCHIVE_FOLDER_CHOSEN, false)) === true, now);
}

/**
 * Posts, replies and reposts of an account still present in the inventory, and those Xomoni removed after X's count
 * was last seen, which that count still includes (PLAYBOOK E2). Counted without loading rows but the removed ones,
 * which are read in one bulk read rather than a cursor's row at a time (#390).
 */
export async function postTotals(account: Account): Promise<{ present: number; removedSinceProfile: number }> {
  let present = 0;
  let removedSinceProfile = 0;
  for (const kind of ['post', 'reply', 'repost'] as const) {
    const range = (status: Item['status']) =>
      db.items
        .where('[accountId+kind+status+createdAt]')
        .between([account.id, kind, status, -Infinity], [account.id, kind, status, Infinity]);
    // Present: all of the kind, counted on the primary key, less those removed or gone, the fast count (#390).
    const all = await db.items
      .where(':id')
      .between(itemKey(account.id, kind, ''), `${account.id}:${kind};`)
      .count();
    const removed = await range('deleted').toArray();
    present += all - removed.length - (await range('gone').count());
    // Before X's count was ever seen, nothing removed is in it.
    if (account.profileAt == null) continue;
    const since = account.profileAt;
    removedSinceProfile += removed.filter((item) => item.statusAt > since).length;
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
  // Keys are `<account id>:<kind>:<id>`, so the account's items are one range of keys, read in bulk a chunk at a
  // time until one came from an archive (#390): a cursor walked a heavy X user's whole copy a row at a time.
  let after = `${accountId}:`;
  for (;;) {
    const rows = await db.items
      .where(':id')
      .between(after, `${accountId};`, false, false)
      .limit(ARCHIVE_CHUNK)
      .toArray();
    if (rows.some((item) => item.accountId === accountId && item.sources.includes('archive'))) return true;
    const last = rows.at(-1);
    if (rows.length < ARCHIVE_CHUNK || !last) return false;
    after = last.key;
  }
}

/** Items `archiveImported` reads at a time when no marker says an archive was imported. */
const ARCHIVE_CHUNK = 2_000;

const viewCapKey = (accountId: string) => `viewCap:${accountId}`;

/** The daily view cap learned for an account (PLAYBOOK A4, #28), or null when none was learned. */
export function getViewCap(accountId: string): Promise<ViewCap | null> {
  return kvGet<ViewCap | null>(viewCapKey(accountId), null);
}

/** Stores the daily view cap learned for an account; it applies to every later run. */
export function setViewCap(accountId: string, cap: ViewCap) {
  return kvSet(viewCapKey(accountId), cap);
}
