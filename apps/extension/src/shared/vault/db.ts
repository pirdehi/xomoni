// The vault's storage (ADR-0043, #424): the import ledger, X's analytics of each post and each day, and the account's
// timeline, in the extension's IndexedDB (`db.ts`, Dexie version 8). Every row is checked by `records.ts` before it is
// written, and one bad row refuses the whole write: nothing is written. Merges never lower a number. Nothing here sends
// anything anywhere (ADR-0004) or acts on X.
import { db, kvGet, kvSet } from '../db';
import type { RiskEvent, RiskEventKind } from '../risk';
import { DAY } from '../time';
import { accountEventRecord, analyticsDayRecord, analyticsPostRecord, cleanWords, vaultImportRecord } from './records';
import {
  type AccountEvent,
  type AccountEventKind,
  type AccountEventSource,
  type AnalyticsDay,
  type AnalyticsPost,
  DAY_METRICS,
  POST_METRICS,
  type VaultImport,
  type VaultSource,
} from './types';

/** Why the vault refused a write; nothing was written. `row` is the number (from 1) of the first row out of shape. */
export class VaultError extends Error {
  override name = 'VaultError';
  constructor(
    message: string,
    readonly row?: number,
  ) {
    super(message);
  }
}

/**
 * A new ledger id: `<account id>:<source>:<importedAt>:<random>`, unique and sorted by account, source and time. The
 * random part is 8 base-36 digits from Web Crypto.
 */
export function newImportId(accountId: string, source: VaultSource, importedAt: number): string {
  const [word = 0] = crypto.getRandomValues(new Uint32Array(1));
  const random = word.toString(36).padStart(8, '0').slice(-8);
  return `${accountId}:${source}:${String(Math.floor(importedAt))}:${random}`;
}

/**
 * Writes one row of the import ledger, checked by `vaultImportRecord`, and returns it as stored. A row given without an
 * `id` gets one (`newImportId`). Throws `VaultError` for a row out of shape.
 */
export async function recordImport(
  row: Omit<VaultImport, 'id'> & { id?: string },
  now = Date.now(),
): Promise<VaultImport> {
  const record = vaultImportRecord(
    { ...row, id: row.id ?? newImportId(row.accountId, row.source, row.importedAt) },
    now,
  );
  if (!record) throw new VaultError('This import’s ledger row is out of shape. Nothing was written.');
  await db.vaultImports.put(record);
  return record;
}

/** What a ledger row says when the file wasn't read in whole: a duplicate, a cancelled import or a failed one. */
const UNFINISHED: readonly string[] = ['duplicate', 'cancelled', 'failed'];

/** Whether a ledger row records a file that was read in whole. */
const completed = (row: VaultImport) => !row.problems.some((p) => UNFINISHED.includes(p));

/**
 * The first completed import of the file with this fingerprint for this account, or undefined: a file found here is a
 * duplicate (ADR-0043, decision 4). Imports that were themselves duplicates, or were cancelled or failed, don't count.
 */
export async function findImport(accountId: string, fingerprint: string): Promise<VaultImport | undefined> {
  const rows = await db.vaultImports.where('fingerprint').equals(fingerprint).toArray();
  return rows
    .filter((row) => row.accountId === accountId && completed(row))
    .sort((a, b) => a.importedAt - b.importedAt)[0];
}

/** Where the files whose owner the person confirmed are kept, per account, in `kv` (ADR-0043, decision 5). */
const confirmedKey = (accountId: string) => `vaultConfirmed:${accountId}`;

/** How many confirmed fingerprints an account keeps: the newest. */
const CONFIRMED_KEPT = 500;

/** Whether the person confirmed that the files with this fingerprint are the account's (a days CSV, #425). */
export async function isConfirmed(accountId: string, fingerprint: string): Promise<boolean> {
  const kept = await kvGet<unknown>(confirmedKey(accountId), null);
  return Array.isArray(kept) && kept.includes(fingerprint);
}

/**
 * Remembers that the person confirmed the files with this fingerprint are the account's, so the same file isn't asked
 * about again. The answer goes with the account's data (`forgetAccount`) and stays behind in a move.
 */
export async function rememberConfirmed(accountId: string, fingerprint: string): Promise<void> {
  await db.transaction('rw', db.kv, async () => {
    const kept = await kvGet<unknown>(confirmedKey(accountId), null);
    const list = Array.isArray(kept) ? kept.filter((f): f is string => typeof f === 'string' && f !== fingerprint) : [];
    await kvSet(confirmedKey(accountId), [...list, fingerprint].slice(-CONFIRMED_KEPT));
  });
}

/** The account's ledger, newest first; with `source`, only that source's imports. */
export function importLedger(accountId: string, source?: VaultSource): Promise<VaultImport[]> {
  const rows = source
    ? db.vaultImports
        .where('[accountId+source+importedAt]')
        .between([accountId, source, -Infinity], [accountId, source, Infinity])
    : db.vaultImports.where('accountId').equals(accountId);
  return rows.toArray().then((list) => list.sort((a, b) => b.importedAt - a.importedAt));
}

/** What a merge did: rows that were new, and rows already here that the merge changed. */
export interface MergeResult {
  added: number;
  updated: number;
}

/** Checks every row with `check`, or throws `VaultError` naming the first that is out of shape. */
function checkAll<T>(rows: readonly unknown[], check: (row: unknown, now: number) => T | null, now: number): T[] {
  return rows.map((row, i) => {
    const copy = check(row, now);
    if (!copy) throw new VaultError(`Row ${i + 1} is out of shape. Nothing was written.`, i + 1);
    return copy;
  });
}

/**
 * Two copies of a post's analytics as one: each number is the larger (X's counts only grow, so a merge never lowers
 * one), `asOf` the newer, the creation time the one known, and the text the one kept (only for a post the inventory
 * doesn't hold).
 */
export function mergeAnalyticsPost(here: AnalyticsPost, there: AnalyticsPost): AnalyticsPost {
  const merged: AnalyticsPost = {
    key: here.key,
    accountId: here.accountId,
    postId: here.postId,
    createdAt: here.createdAt || there.createdAt,
    asOf: Math.max(here.asOf, there.asOf),
  };
  for (const name of POST_METRICS) {
    const [a, b] = [here[name], there[name]];
    if (a !== undefined || b !== undefined) merged[name] = Math.max(a ?? 0, b ?? 0);
  }
  const text = here.text ?? there.text;
  if (text !== undefined) merged.text = text;
  return merged;
}

/**
 * Two copies of a day's analytics as one: the newer count (by `asOf`) wins, as the newest import says best what the day
 * was; a number it doesn't name keeps the older copy's. On a tie, `there` (the import) wins.
 */
export function mergeAnalyticsDay(here: AnalyticsDay, there: AnalyticsDay): AnalyticsDay {
  const [newer, older] = there.asOf >= here.asOf ? [there, here] : [here, there];
  const merged: AnalyticsDay = { accountId: here.accountId, day: here.day, asOf: newer.asOf };
  for (const name of DAY_METRICS) {
    const value = newer[name] ?? older[name];
    if (value !== undefined) merged[name] = value;
  }
  return merged;
}

const same = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Merges analytics rows of posts (`analyticsPosts`) with `mergeAnalyticsPost`, in one transaction. Every row is checked
 * first; one out of shape (a negative or broken number, an id that isn't X's, a time in the future) throws `VaultError`
 * and nothing is written.
 */
export async function mergeAnalyticsPosts(rows: readonly unknown[], now = Date.now()): Promise<MergeResult> {
  const fresh = checkAll(rows, analyticsPostRecord, now);
  return db.transaction('rw', db.analyticsPosts, async () => {
    const result: MergeResult = { added: 0, updated: 0 };
    // The same post twice in one batch merges with itself first.
    const byKey = new Map<string, AnalyticsPost>();
    for (const row of fresh) {
      const prev = byKey.get(row.key);
      byKey.set(row.key, prev ? mergeAnalyticsPost(prev, row) : row);
    }
    const keys = [...byKey.keys()];
    const here = await db.analyticsPosts.bulkGet(keys);
    const out: AnalyticsPost[] = [];
    keys.forEach((key, i) => {
      const there = byKey.get(key) as AnalyticsPost;
      const mine = here[i];
      if (!mine) {
        out.push(there);
        result.added++;
        return;
      }
      const merged = mergeAnalyticsPost(mine, there);
      if (same(merged, mine)) return;
      out.push(merged);
      result.updated++;
    });
    if (out.length) await db.analyticsPosts.bulkPut(out);
    return result;
  });
}

/**
 * Merges analytics rows of days (`analyticsDays`) with `mergeAnalyticsDay`, in one transaction. Every row is checked
 * first; one out of shape (a negative number, a day in the future, an id that isn't X's) throws `VaultError` and
 * nothing is written.
 */
export async function mergeAnalyticsDays(rows: readonly unknown[], now = Date.now()): Promise<MergeResult> {
  const fresh = checkAll(rows, analyticsDayRecord, now);
  return db.transaction('rw', db.analyticsDays, async () => {
    const result: MergeResult = { added: 0, updated: 0 };
    const byDay = new Map<string, AnalyticsDay>();
    for (const row of fresh) {
      const key = `${row.accountId}:${row.day}`;
      const prev = byDay.get(key);
      byDay.set(key, prev ? mergeAnalyticsDay(prev, row) : row);
    }
    const days = [...byDay.values()];
    const here = await db.analyticsDays.bulkGet(days.map((d): [string, string] => [d.accountId, d.day]));
    const out: AnalyticsDay[] = [];
    days.forEach((there, i) => {
      const mine = here[i];
      if (!mine) {
        out.push(there);
        result.added++;
        return;
      }
      const merged = mergeAnalyticsDay(mine, there);
      if (same(merged, mine)) return;
      out.push(merged);
      result.updated++;
    });
    if (out.length) await db.analyticsDays.bulkPut(out);
    return result;
  });
}

/**
 * How close two events of a kind must be (ms) to be one. A Premium change seen again within a day is the same change;
 * an import or an X label is one event per `ref`, whenever it is added again; the person's notes are never merged.
 */
export const EVENT_WINDOWS: Record<AccountEventKind, number> = {
  note: 0,
  premium_on: DAY,
  premium_off: DAY,
  archive_requested: DAY,
  archive_imported: Infinity,
  x_label: Infinity,
};

/** An event to add: its words are cleaned and cut by `addAccountEvent`. */
export interface NewAccountEvent {
  accountId: string;
  kind: AccountEventKind;
  /** When it happened (epoch ms); now when left out. */
  at?: number;
  source: AccountEventSource;
  words: string;
  ref?: string;
}

/**
 * Adds an event to the account's timeline (`accountEvents`), unless the same event is there already: the same kind and
 * `ref` within the kind's window (`EVENT_WINDOWS`). The words are cleaned and cut to 500 characters (`cleanWords`).
 * Answers the event as stored, or null for a repeat. Throws `VaultError` for an event out of shape (an id that isn't
 * X's, a time in the future, a kind or source Xomoni doesn't know); nothing is written.
 */
export async function addAccountEvent(event: NewAccountEvent, now = Date.now()): Promise<AccountEvent | null> {
  const record = accountEventRecord({ ...event, at: event.at ?? now, words: cleanWords(event.words) }, now);
  if (!record) throw new VaultError('This timeline entry is out of shape. Nothing was written.');
  const window = EVENT_WINDOWS[record.kind];
  return db.transaction('rw', db.accountEvents, async () => {
    if (window > 0) {
      const near = await db.accountEvents
        .where('[accountId+kind+at]')
        .between(
          [record.accountId, record.kind, record.at - window],
          [record.accountId, record.kind, record.at + window],
          true,
          true,
        )
        .filter((e) => e.ref === record.ref)
        .count();
      if (near > 0) return null;
    }
    const seq = await db.accountEvents.add(record);
    return { ...record, seq };
  });
}

/** Xomoni's words for each risk event on the timeline: what X did, never X's own text (#146). */
export const RISK_EVENT_WORDS: Record<RiskEventKind, string> = {
  automation_flag: 'X warned of automated behavior (error 226). Xomoni slowed down.',
  lock: 'X locked the account until you confirmed it on X.',
  restricted: 'X refused an action. Xomoni slowed down.',
  suspended: 'X showed a suspension notice. Xomoni stopped.',
  silent_block: 'An action X confirmed wasn’t applied on X. Xomoni stopped.',
  rate_limited: 'X said a limit was reached. Xomoni waited.',
  override: 'You chose to resume despite the risk ladder.',
};

/** What a timeline entry is: one of the account's events, or a risk-ladder event (ADR-0013). */
export type TimelineKind = AccountEventKind | 'risk';

/** One entry of the account's timeline as `accountTimeline` reads it. `words` are shown as text, never as HTML. */
export interface TimelineEntry {
  kind: TimelineKind;
  /** Epoch ms. */
  at: number;
  source: AccountEventSource;
  words: string;
  ref?: string;
  /** The row's key in its table (`accountEvents` or `risk`). */
  seq?: number;
  /** For a risk event, its kind. */
  risk?: RiskEventKind;
}

/** What `accountTimeline` reads. */
export interface TimelineQuery {
  /** Oldest and newest moment (epoch ms, inclusive); all of time when left out. */
  from?: number;
  to?: number;
  /** Only these kinds; all when left out. */
  kinds?: readonly TimelineKind[];
  /** At most this many entries, the newest first; 50 when left out, and `Infinity` for all of them. */
  limit?: number;
}

/** Entries `accountTimeline` gives when the query names no limit: one page of the Vault page's timeline. */
export const TIMELINE_PAGE = 50;

/**
 * The account's timeline, newest first: its events (`accountEvents`) and its risk-ladder events (`risk`) as one list,
 * the risk events in Xomoni's own words (`RISK_EVENT_WORDS`). Read through the indexes, at most `limit` of each, in one
 * read-only transaction.
 */
export async function accountTimeline(accountId: string, query: TimelineQuery = {}): Promise<TimelineEntry[]> {
  const from = query.from ?? -Infinity;
  const to = query.to ?? Infinity;
  // IndexedDB counts in 32 bits: a larger limit, such as the whole timeline's, is read as all of it.
  const limit = Math.min(Math.max(0, query.limit ?? TIMELINE_PAGE), 2 ** 32 - 1);
  const kinds = query.kinds ? new Set<TimelineKind>(query.kinds) : null;
  const wantRisk = !kinds || kinds.has('risk');
  const wantEvents = !kinds || [...kinds].some((k) => k !== 'risk');
  if (limit === 0) return [];
  return db.transaction('r', db.accountEvents, db.risk, async () => {
    const events: AccountEvent[] = wantEvents
      ? await db.accountEvents
          .where('[accountId+at]')
          .between([accountId, from], [accountId, to], true, true)
          .reverse()
          .filter((e) => !kinds || kinds.has(e.kind))
          .limit(limit)
          .toArray()
      : [];
    const risks: RiskEvent[] = wantRisk
      ? await db.risk
          .where('[accountId+at]')
          .between([accountId, from], [accountId, to], true, true)
          .reverse()
          .limit(limit)
          .toArray()
      : [];
    const entries: TimelineEntry[] = [
      ...events.map((e): TimelineEntry => ({
        kind: e.kind,
        at: e.at,
        source: e.source,
        words: e.words,
        ...(e.ref !== undefined && { ref: e.ref }),
        ...(e.seq !== undefined && { seq: e.seq }),
      })),
      ...risks.map((e): TimelineEntry => ({
        kind: 'risk',
        at: e.at,
        source: 'xomoni',
        words: RISK_EVENT_WORDS[e.kind],
        risk: e.kind,
        ...(e.seq !== undefined && { seq: e.seq }),
      })),
    ];
    return entries.sort((a, b) => b.at - a.at || (b.seq ?? 0) - (a.seq ?? 0)).slice(0, limit);
  });
}
