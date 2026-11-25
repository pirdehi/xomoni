// Moving Xomoni's data to another Xomoni on the same computer (#300, ADR-0032). The export writes every moved table
// into one checked file (`move-file.ts`); the import merges a checked file into this database. The import never
// replaces more data with less and never deletes anything (only ADR-0030's limits on others' replies still apply), it
// starts nothing on X, and it runs only while no job does: it holds the runner's lock, so no job can start meanwhile.
import type { DailyStats } from './daily';
import { db, kvGet, kvSet } from './db';
import { incomingSince, trimIncoming } from './incoming';
import {
  CORE_MOVE_TABLES,
  MOVE_TABLES,
  MOVED_ACCOUNT_VALUES,
  type MoveCounts,
  type MoveData,
  type MoveFile,
  type MoveTable,
  VAULT_MOVE_TABLES,
  VAULT_TABLE_NAMES,
  type VaultMoveTableName,
  moveCounts,
  moveRecord,
  movedValueName,
  writeMoveFile,
} from './move-file';
import { RUNNER_LOCK } from './runner-lock';
import { normalizeSettings } from './settings';
import type { Account, Item, Job, JobState, LogEntry, Settings } from './types';
import { WATCH_POSTS, normalizeTabs } from './watch';
import type { ArchiveRequest } from './x-archive';
import { type ViewCap, capReset } from './x-limits';

/** A finished export: the file's text, what it holds, and how many damaged records were left out of it. */
export interface MoveExport {
  text: string;
  counts: MoveCounts;
  /** Records that are out of shape in this database (damaged) and so not in the file; 0 normally. */
  skipped: number;
}

/** What an import did, per table: records added, and records here that a newer copy from the file updated. */
export interface MoveResult {
  added: MoveCounts;
  updated: MoveCounts;
}

/** Why a job that hadn't finished in the other Xomoni arrives ended (ADR-0032). */
export const MOVED_JOB_REASON =
  'Moved from another Xomoni before it finished. Start a new one here to go on: it skips what is already done.';

/** States of a job that hasn't finished: a moved job in one of them arrives cancelled. */
const UNFINISHED: ReadonlySet<JobState> = new Set(['queued', 'running', 'waiting', 'paused', 'blocked']);

const TABLES = () => [
  db.accounts,
  db.items,
  db.jobs,
  db.logs,
  db.limits,
  db.reads,
  db.risk,
  db.checks,
  db.daily,
  db.incoming,
  db.kv,
  db.vaultImports,
  db.analyticsPosts,
  db.analyticsDays,
  db.accountEvents,
  db.labelMonths,
];

/** The vault's rows (#424), all of them or one account's, read through `VAULT_MOVE_TABLES`; inside `readTables`. */
async function readVault(accountId?: string): Promise<Record<VaultMoveTableName, unknown[]>> {
  const rows = await Promise.all(VAULT_TABLE_NAMES.map((table) => VAULT_MOVE_TABLES[table].read(accountId)));
  return Object.fromEntries(VAULT_TABLE_NAMES.map((table, i) => [table, rows[i] ?? []])) as Record<
    VaultMoveTableName,
    unknown[]
  >;
}

/** The rows of every moved table, or of one X account's, read in one transaction so the file is one moment's copy. */
async function readTables(accountId?: string): Promise<Record<MoveTable, unknown[]>> {
  return db.transaction('r', TABLES(), async () => {
    const kv = (await db.kv.toArray()).filter((row) => {
      const name = movedValueName(row.key);
      if (!name || accountId === undefined) return !!name;
      return (MOVED_ACCOUNT_VALUES as readonly string[]).includes(name) && row.key.endsWith(`:${accountId}`);
    });
    if (accountId === undefined) {
      const [accounts, items, jobs, logs, limits, reads, risk, checks, daily, incoming] = await Promise.all([
        db.accounts.toArray(),
        db.items.toArray(),
        db.jobs.toArray(),
        db.logs.toArray(),
        db.limits.toArray(),
        db.reads.toArray(),
        db.risk.toArray(),
        db.checks.toArray(),
        db.daily.toArray(),
        db.incoming.toArray(),
      ]);
      return { accounts, items, jobs, logs, limits, reads, risk, checks, daily, incoming, kv, ...(await readVault()) };
    }
    const id = accountId;
    const [from, to] = [
      [id, -Infinity],
      [id, Infinity],
    ];
    const [account, items, jobs, logs, limits, reads, risk, checks, daily, incoming] = await Promise.all([
      db.accounts.get(id),
      db.items.where('accountId').equals(id).toArray(),
      db.jobs.where('accountId').equals(id).toArray(),
      db.logs.where('[accountId+ts]').between(from, to, true, true).toArray(),
      db.limits.where('accountId').equals(id).toArray(),
      db.reads.where('[accountId+ts]').between(from, to, true, true).toArray(),
      db.risk.where('[accountId+at]').between(from, to, true, true).toArray(),
      db.checks.where('[accountId+dueAt]').between(from, to, true, true).toArray(),
      db.daily.where('accountId').equals(id).toArray(),
      db.incoming.where('accountId').equals(id).toArray(),
    ]);
    return {
      accounts: account ? [account] : [],
      items,
      jobs,
      logs,
      limits,
      reads,
      risk,
      checks,
      daily,
      incoming,
      kv,
      ...(await readVault(id)),
    };
  });
}

/**
 * Writes the move file (*Export everything*): every moved table (`MOVE_TABLES`), or with `accountId` only that X
 * account's records (the copy offered before removing an account's data, #226). Every record goes through the same
 * checks as an import (`moveRecord`), so the file always imports; a record out of shape is left out and counted in
 * `skipped`. Reads only: nothing is changed, and nothing is sent anywhere (ADR-0004). `app` is this Xomoni's version.
 */
export async function exportData(options: { app: string; accountId?: string; now?: number }): Promise<MoveExport> {
  const now = options.now ?? Date.now();
  const rows = await readTables(options.accountId);
  let skipped = 0;
  const data = {} as Record<MoveTable, unknown[]>;
  for (const table of MOVE_TABLES) {
    const copies: unknown[] = [];
    for (const row of rows[table]) {
      const copy = moveRecord(table, row, now);
      if (copy) copies.push(copy);
      else skipped++;
    }
    data[table] = copies;
  }
  const moved = data as unknown as MoveData;
  return { text: await writeMoveFile(options.app, moved, now), counts: moveCounts(moved), skipped };
}

/** Whether two flat records hold the same values. */
function same(a: object, b: object): boolean {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
    if (JSON.stringify(x[key]) !== JSON.stringify(y[key])) return false;
  }
  return true;
}

/**
 * Two copies of an account as one: the newer copy (by `updatedAt`) wins, and a field it left empty (null or `''`)
 * keeps the other's value, as `upsertAccount` does. On a tie, this Xomoni's copy (`here`) wins.
 */
export function mergeAccount(here: Account, there: Account): Account {
  const [newer, older] = there.updatedAt > here.updatedAt ? [there, here] : [here, there];
  const filled = Object.fromEntries(Object.entries(newer).filter(([, v]) => v != null && v !== ''));
  return { ...older, ...filled, id: here.id, updatedAt: Math.max(here.updatedAt, there.updatedAt) };
}

/**
 * Which of two copies of an item says where it stands. A removed copy (deleted or gone) wins over one still present,
 * unless X showed the item live more than 5 s after the removal, the rule `upsertItems` follows (PLAYBOOK E5): an item
 * only read from an archive since says nothing about whether it is still on X. Between two copies that agree, the one
 * changed last wins.
 */
function standingOf(here: Item, there: Item): Item {
  const removed = (i: Item) => i.status !== 'present';
  if (removed(here) === removed(there)) return there.statusAt > here.statusAt ? there : here;
  const [gone, shown] = removed(here) ? [here, there] : [there, here];
  return shown.seenAt > gone.statusAt + 5_000 ? shown : gone;
}

/**
 * Two copies of an inventory item as one, field by field, so neither loses what it knows:
 * - where it stands (`status`, `statusAt`, `lastJobId`) comes from `standingOf`, so an item Xomoni removed stays
 *   removed unless X showed it again later;
 * - X's counts (`likes`, `views`, …), the links and media (#428) and `seenAt` come from the copy X showed last, and
 *   the other fills in what it lacks;
 * - text, author, dates and ids come from the newer copy, and fill in what it left empty from the other;
 * - `sources` is both copies' sources, and `likedAt` the later one.
 * On a tie, this Xomoni's copy (`here`) wins.
 */
export function mergeItem(here: Item, there: Item): Item {
  const stamp = (i: Item) => Math.max(i.statusAt, i.seenAt);
  const [base, other] = stamp(there) > stamp(here) ? [there, here] : [here, there];
  const standing = standingOf(here, there);
  const [seen, unseen] = there.seenAt > here.seenAt ? [there, here] : [here, there];
  const likedAt = [here.likedAt, there.likedAt].filter((t): t is number => t !== null);
  const merged: Item = {
    key: here.key,
    accountId: here.accountId,
    kind: here.kind,
    id: here.id,
    targetId: base.targetId || other.targetId,
    createdAt: base.createdAt || other.createdAt,
    likedAt: likedAt.length ? Math.max(...likedAt) : null,
    text: base.text || other.text,
    author: base.author || other.author,
    inReplyToId: base.inReplyToId ?? other.inReplyToId,
    selfReply: base.selfReply,
    likes: seen.likes,
    reposts: seen.reposts,
    replies: seen.replies,
    sources: [...new Set([...here.sources, ...there.sources])],
    status: standing.status,
    seenAt: seen.seenAt,
    statusAt: standing.statusAt,
    lastJobId: standing.lastJobId,
  };
  for (const name of ['quotes', 'bookmarks', 'views', 'quote', 'replyTo', 'links', 'media'] as const) {
    const value = seen[name] ?? unseen[name];
    if (value !== undefined) Object.assign(merged, { [name]: value });
  }
  return merged;
}

/** The counts of a day that only ever go up: what was received, seen and liked that day. */
const DAY_SUMS = [
  'receivedLikes',
  'receivedReplies',
  'receivedReposts',
  'receivedQuotes',
  'receivedViews',
  'observedPosts',
  'postsWithLikes',
  'repliesWithLikes',
] as const;

/**
 * Two copies of a day's numbers as one: each count of what was received or seen is the larger of the two, so none
 * goes down; the profile's counts come from the copy changed last, filled in from the other where it has none.
 */
export function mergeDaily(here: DailyStats, there: DailyStats): DailyStats {
  const [newer, older] = there.updatedAt > here.updatedAt ? [there, here] : [here, there];
  const merged: DailyStats = {
    ...here,
    followers: newer.followers ?? older.followers,
    following: newer.following ?? older.following,
    postsTotal: newer.postsTotal ?? older.postsTotal,
    likesTotal: newer.likesTotal ?? older.likesTotal,
    updatedAt: Math.max(here.updatedAt, there.updatedAt),
  };
  for (const name of DAY_SUMS) merged[name] = Math.max(here[name], there[name]);
  return merged;
}

/**
 * A moved job as it arrives: a job that had finished stays as it was; one that hadn't (queued, running, waiting,
 * paused or blocked) arrives cancelled with `MOVED_JOB_REASON`, so nothing a file brings can resume work on X. A new
 * cleanup with the same rules goes on where it stopped, because the inventory knows what was already removed.
 */
export function arrivedJob(job: Job, now: number): Job {
  if (!UNFINISHED.has(job.state)) return job;
  return { ...job, state: 'cancelled', stateReason: MOVED_JOB_REASON, finishedAt: job.finishedAt ?? now };
}

const zero = (): MoveCounts => Object.fromEntries(MOVE_TABLES.map((t) => [t, 0])) as MoveCounts;

/**
 * Adds the rows of a table that has no key of its own (`logs`, `reads`, `risk`, `checks`) unless the same row is here
 * already, so importing the same file twice adds nothing the second time. `signature` names what makes two rows the
 * same; `local` reads this Xomoni's rows of one account that could match.
 */
async function addMissing<T extends { accountId: string }>(
  rows: readonly T[],
  signature: (row: T) => string,
  local: (accountId: string, rows: readonly T[]) => Promise<T[]>,
  add: (rows: T[]) => Promise<unknown>,
): Promise<number> {
  const byAccount = new Map<string, T[]>();
  for (const row of rows) {
    const list = byAccount.get(row.accountId);
    if (list) list.push(row);
    else byAccount.set(row.accountId, [row]);
  }
  let added = 0;
  for (const [accountId, mine] of byAccount) {
    const here = new Map<string, number>();
    for (const row of await local(accountId, mine)) here.set(signature(row), (here.get(signature(row)) ?? 0) + 1);
    const fresh = mine.filter((row) => {
      const left = here.get(signature(row)) ?? 0;
      if (left > 0) here.set(signature(row), left - 1);
      return left === 0;
    });
    if (fresh.length) await add(fresh);
    added += fresh.length;
  }
  return added;
}

/** The smallest and largest of `values`, without spreading: a table holds more rows than a call takes arguments. */
function span(values: readonly number[]): [number, number] {
  let low = Infinity;
  let high = -Infinity;
  for (const v of values) {
    if (v < low) low = v;
    if (v > high) high = v;
  }
  return [low, high];
}

/** Rows written at a time, so one bulk read or write stays a reasonable size. */
const CHUNK = 5_000;

async function mergeItems(items: readonly Item[], result: MoveResult) {
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const here = await db.items.bulkGet(chunk.map((item) => item.key));
    const rows: Item[] = [];
    chunk.forEach((there, j) => {
      const mine = here[j];
      if (!mine) {
        rows.push(there);
        result.added.items++;
        return;
      }
      const merged = mergeItem(mine, there);
      if (same(merged, mine)) return;
      rows.push(merged);
      result.updated.items++;
    });
    if (rows.length) await db.items.bulkPut(rows);
  }
}

async function mergeAccounts(accounts: readonly Account[], result: MoveResult) {
  const here = await db.accounts.bulkGet(accounts.map((a) => a.id));
  for (const [i, there] of accounts.entries()) {
    const mine = here[i];
    if (!mine) {
      await db.accounts.put(there);
      result.added.accounts++;
      continue;
    }
    const merged = mergeAccount(mine, there);
    if (same(merged, mine)) continue;
    await db.accounts.put(merged);
    result.updated.accounts++;
  }
}

async function mergeJobs(jobs: readonly Job[], result: MoveResult, now: number) {
  const here = await db.jobs.bulkGet(jobs.map((j) => j.id));
  for (const [i, there] of jobs.entries()) {
    const mine = here[i];
    if (mine && mine.updatedAt >= there.updatedAt) continue;
    await db.jobs.put(arrivedJob(there, now));
    if (mine) result.updated.jobs++;
    else result.added.jobs++;
  }
}

async function mergeLimits(data: MoveData, result: MoveResult, now: number) {
  const here = await db.limits.bulkGet(data.limits.map((l) => l.key));
  for (const [i, there] of data.limits.entries()) {
    const mine = here[i];
    if (mine && mine.at >= there.at) continue;
    // A reset is believed at most a day ahead, as when X's page reports it (#145).
    await db.limits.put({ ...there, reset: capReset(there.reset, now) });
    if (mine) result.updated.limits++;
    else result.added.limits++;
  }
}

async function mergeDays(days: readonly DailyStats[], result: MoveResult) {
  const here = await db.daily.bulkGet(days.map((d): [string, string] => [d.accountId, d.day]));
  for (const [i, there] of days.entries()) {
    const mine = here[i];
    const next = mine ? mergeDaily(mine, there) : there;
    if (mine && same(next, mine)) continue;
    await db.daily.put(next);
    if (mine) result.updated.daily++;
    else result.added.daily++;
  }
}

async function mergeIncoming(data: MoveData, result: MoveResult, now: number) {
  // Only replies within ADR-0030's 90 days come in; a reply already here is kept as it is.
  const recent = data.incoming.filter((r) => r.createdAt >= incomingSince(now));
  const here = await db.incoming.bulkGet(recent.map((r) => r.key));
  const fresh = recent.filter((_, i) => !here[i]);
  if (fresh.length) await db.incoming.bulkAdd(fresh);
  result.added.incoming = fresh.length;
  for (const accountId of new Set(fresh.map((r) => r.accountId))) await trimIncoming(accountId, now);
}

/**
 * The value to keep for one moved `kv` key, or undefined to keep what is here:
 * - the settings, the active account and Watch fill in only what this Xomoni doesn't have yet: what the person set up
 *   here stays as it is. Settings are brought inside the safety rules first (`normalizeSettings`, ADR-0012);
 * - when the archive was imported: the later time;
 * - the archive asked for on X: the later request;
 * - the daily view cap learned from X: the lower one, so a move never lets Xomoni read more;
 * - the posts from new accounts seen in Watch's ready tabs (#391): those seen in either.
 */
function mergedValue(name: string, here: unknown, there: unknown, tabsHere: boolean): unknown {
  switch (name) {
    case 'settings':
      return here === undefined ? normalizeSettings(there as Partial<Settings>) : undefined;
    case 'watchTabs':
      return here === undefined && !tabsHere ? normalizeTabs(there) : undefined;
    case 'watchResults':
      return here === undefined && !tabsHere ? there : undefined;
    case 'watchSeen': {
      // Seen in either Xomoni is seen (#391): both lists, each tab's a few checks' worth.
      const mine = (here ?? {}) as Record<string, string[]>;
      const theirs = there as Record<string, string[]>;
      const merged: Record<string, string[]> = { ...mine };
      for (const [tab, ids] of Object.entries(theirs)) {
        merged[tab] = [...new Set([...(mine[tab] ?? []), ...ids])].slice(-WATCH_POSTS * 5);
      }
      return JSON.stringify(merged) === JSON.stringify(mine) ? undefined : merged;
    }
    case 'archive': {
      if (here === undefined || (here === true && typeof there === 'number')) return there;
      return typeof here === 'number' && typeof there === 'number' && there > here ? there : undefined;
    }
    case 'archiveRequest': {
      const mine = here as ArchiveRequest | null | undefined;
      const theirs = there as ArchiveRequest | null;
      if (!theirs) return undefined;
      if (!mine) return theirs;
      const later =
        theirs.requestedAt > mine.requestedAt ||
        (theirs.requestedAt === mine.requestedAt && theirs.checkedAt > mine.checkedAt);
      return later ? theirs : undefined;
    }
    case 'viewCap': {
      const mine = here as ViewCap | undefined;
      return !mine || (there as ViewCap).cap < mine.cap ? there : undefined;
    }
    default:
      // `activeAccount`.
      return here === undefined ? there : undefined;
  }
}

async function mergeValues(data: MoveData, result: MoveResult) {
  const withTabs = new Set(
    (await db.kv.where('key').startsWith('watchTabs:').primaryKeys()).map((key) => key.slice('watchTabs:'.length)),
  );
  for (const { key, value } of data.kv) {
    const name = movedValueName(key);
    if (!name) continue;
    const here = await db.kv.get(key);
    const account = key.slice(key.indexOf(':') + 1);
    const next = mergedValue(name, here?.value, value, withTabs.has(account));
    if (next === undefined) continue;
    await db.kv.put({ key, value: next });
    if (here) result.updated.kv++;
    else result.added.kv++;
  }
}

const dayOf = (iso: string) => iso.slice(0, 10);

/** One activity log line per X account in the file, saying what came in (#300). */
async function logImport(file: MoveFile, now: number) {
  const say = (what: string) =>
    `Moved in from Xomoni ${file.app} (exported ${dayOf(file.exportedAt)}): ${what}. Nothing here was replaced with less or deleted.`;
  const lines: LogEntry[] = file.data.accounts.map((account) => {
    const items = file.data.items.filter((i) => i.accountId === account.id);
    const likes = items.filter((i) => i.kind === 'like').length;
    const jobs = file.data.jobs.filter((j) => j.accountId === account.id).length;
    const logs = file.data.logs.filter((l) => l.accountId === account.id).length;
    return {
      ts: now,
      accountId: account.id,
      jobId: null,
      level: 'success',
      action: 'system',
      targetId: null,
      outcome: null,
      message: say(
        `${(items.length - likes).toLocaleString('en')} posts, replies and reposts, ${likes.toLocaleString('en')} likes, ${jobs.toLocaleString('en')} jobs and ${logs.toLocaleString('en')} log entries`,
      ),
    };
  });
  if (!lines.length) {
    const active = await kvGet<string | null>('activeAccount', null);
    lines.push({
      ts: now,
      accountId: active ?? '',
      jobId: null,
      level: 'success',
      action: 'system',
      targetId: null,
      outcome: null,
      message: say('settings and other values'),
    });
  }
  await db.logs.bulkAdd(lines);
}

/**
 * Merges a checked move file (`checkMoveFile`) into this database, in one transaction, and writes what came in to the
 * activity log. The rules are ADR-0032's: an item, account or day in both keeps the newer copy, field by field
 * (`mergeItem`, `mergeAccount`, `mergeDaily`); a job here is kept unless the file's copy is newer, and a job that
 * hadn't finished arrives cancelled (`arrivedJob`); log lines, page loads, risk events and sampled checks are added
 * unless already here; the person's typed overrides of the risk ladder are not taken (a file can't lift a stop);
 * settings and Watch fill in only what is missing; the vault's tables merge by `VAULT_MOVE_TABLES` (the ledger joined,
 * analytics never lowered, the timeline's missing events added); nothing is ever deleted. In the same transaction it keeps what it did
 * for the dashboard to show until the person dismisses it (`importNotice`, #357). Returns `'busy'`, having written
 * nothing, when a job runs in any dashboard tab; while the import runs, it holds the runner's lock, so no job can start.
 */
export async function importData(file: MoveFile, now = Date.now()): Promise<MoveResult | 'busy'> {
  return navigator.locks.request(RUNNER_LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock) return 'busy' as const;
    const { data } = file;
    return db.transaction('rw', TABLES(), async () => {
      const result: MoveResult = { added: zero(), updated: zero() };
      await mergeAccounts(data.accounts, result);
      await mergeItems(data.items, result);
      await mergeJobs(data.jobs, result, now);
      result.added.logs = await addMissing(
        data.logs,
        (l) => JSON.stringify([l.ts, l.jobId, l.level, l.action, l.targetId, l.outcome, l.message]),
        (accountId, rows) => {
          const [from, to] = span(rows.map((l) => l.ts));
          return db.logs.where('[accountId+ts]').between([accountId, from], [accountId, to], true, true).toArray();
        },
        (rows) => db.logs.bulkAdd(rows),
      );
      await mergeLimits(data, result, now);
      result.added.reads = await addMissing(
        data.reads,
        (r) => JSON.stringify([r.budget, r.ts]),
        (accountId, rows) => {
          const [from, to] = span(rows.map((r) => r.ts));
          return db.reads.where('[accountId+ts]').between([accountId, from], [accountId, to], true, true).toArray();
        },
        (rows) => db.reads.bulkAdd(rows),
      );
      // The person's typed decision to resume despite the ladder is theirs to make again here.
      result.added.risk = await addMissing(
        data.risk.filter((e) => e.kind !== 'override'),
        (e) => JSON.stringify([e.kind, e.at]),
        (accountId, rows) => {
          const [from, to] = span(rows.map((e) => e.at));
          return db.risk.where('[accountId+at]').between([accountId, from], [accountId, to], true, true).toArray();
        },
        (rows) => db.risk.bulkAdd(rows),
      );
      result.added.checks = await addMissing(
        data.checks,
        (c) => JSON.stringify([c.jobId, c.action, c.postId, c.at]),
        (accountId) =>
          db.checks.where('[accountId+dueAt]').between([accountId, -Infinity], [accountId, Infinity]).toArray(),
        (rows) => db.checks.bulkAdd(rows),
      );
      await mergeDays(data.daily, result);
      await mergeIncoming(data, result, now);
      await mergeValues(data, result);
      // The vault (#424): the ledger joined, analytics never lowered, the timeline's missing events added.
      for (const table of VAULT_TABLE_NAMES) {
        const merged = await (
          VAULT_MOVE_TABLES[table].merge as (
            rows: readonly unknown[],
            now: number,
          ) => Promise<{ added: number; updated: number }>
        )(data[table], now);
        result.added[table] = merged.added;
        result.updated[table] = merged.updated;
      }
      await logImport(file, now);
      await kvSet(IMPORTED_KEY, { app: file.app, at: now, result } satisfies ImportNotice);
      return result;
    });
  });
}

/** Where dismissing the first-run offer is kept in `kv`; left out of a move, and cleared by *Delete local data*. */
const OFFER_KEY = 'moveOffer';

/**
 * Whether the dashboard offers to import data from another Xomoni (#300): until the person dismisses it, while this
 * Xomoni hasn't done anything yet (no job and no line in the activity log), as right after it is installed. Read-only,
 * so it can run in a live query.
 */
export async function moveOfferShown(): Promise<boolean> {
  if ((await kvGet<unknown>(OFFER_KEY, null)) === 'dismissed') return false;
  return (await db.jobs.count()) === 0 && (await db.logs.count()) === 0;
}

/** Stops offering the import on this install. */
export function dismissMoveOffer() {
  return kvSet(OFFER_KEY, 'dismissed');
}

/** Where the last import's result waits for the person in `kv` (#357); left out of a move, and cleared by *Delete local data*. */
const IMPORTED_KEY = 'moveImported';

/** What the last import did (#357), kept until the person dismisses it. */
export interface ImportNotice {
  /** The version of the Xomoni the file came from. */
  app: string;
  /** When the import ran, in ms since the epoch. */
  at: number;
  /** What came in, as `importData` answered it. */
  result: MoveResult;
}

/**
 * `counts` as `MoveResult`'s counts, or null: a number for every core table, and for each vault table, 0 where a notice
 * kept before version 2 of the move file has none.
 */
function asCounts(counts: unknown): MoveResult['added'] | null {
  if (typeof counts !== 'object' || counts === null) return null;
  const record = counts as Record<string, unknown>;
  if (!CORE_MOVE_TABLES.every((table) => typeof record[table] === 'number')) return null;
  return Object.fromEntries(
    MOVE_TABLES.map((table) => [table, typeof record[table] === 'number' ? record[table] : 0]),
  ) as MoveResult['added'];
}

/**
 * What the last import did, until the person dismisses it (#357), so the dashboard keeps saying so: an import from the
 * first-run offer turns the dashboard to Home at once, and an import's log line ends the offer it was made from. Null
 * when there is none, or when the value kept is out of shape. Read-only, so it can run in a live query.
 */
export async function importNotice(): Promise<ImportNotice | null> {
  const value = await kvGet<unknown>(IMPORTED_KEY, null);
  if (typeof value !== 'object' || value === null) return null;
  const { app, at, result } = value as Partial<Record<keyof ImportNotice, unknown>>;
  if (typeof app !== 'string' || typeof at !== 'number' || typeof result !== 'object' || result === null) return null;
  const { added, updated } = result as Partial<Record<keyof MoveResult, unknown>>;
  const [a, u] = [asCounts(added), asCounts(updated)];
  return a && u ? { app, at, result: { added: a, updated: u } } : null;
}

/** Forgets the last import's result: the person has read it. */
export function dismissImportNotice() {
  return db.kv.delete(IMPORTED_KEY);
}
