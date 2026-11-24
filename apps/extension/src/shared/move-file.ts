// The file that moves Xomoni's data to another Xomoni on the same computer (#300, ADR-0032): what is in it, how it
// is checked, and in what shape each record must be. A move is needed when Chrome sees the new Xomoni as another
// extension (a fixed id, or the store's version): IndexedDB belongs to the old one. The file is written in the
// dashboard and saved on the person's computer; nothing in it is ever sent anywhere (ADR-0004).
//
// Every record is checked and copied field by field, like the messages in `inbound.ts`: ids are X ids, keys agree with
// their fields, kinds and states are ones Xomoni knows, times are not far in the future, texts and lists have a size
// limit. A field an older Xomoni didn't write yet gets the value Xomoni gives it today; a field that is there in the
// wrong shape makes the record broken, and a broken record makes the whole file refused. Pure, apart from the SHA-256
// of the Web Crypto API.
import type { DailyStats } from './daily';
import { type ReadUse, itemKey } from './db';
import type { JobHealth, HealthSignal, SampleTally } from './health';
import { isXId } from './ids';
import { AVATAR_URL } from './inbound';
import { INCOMING_TEXT, incomingKey } from './incoming';
import { asNumber, asObject } from './json';
import type { RiskEvent, RiskEventKind, RiskLevel } from './risk';
import type {
  Account,
  ActionKind,
  CleanupFilter,
  CleanupOptions,
  CleanupTarget,
  DateRange,
  IncomingReply,
  Item,
  ItemKind,
  ItemSource,
  ItemStatus,
  Job,
  JobKind,
  JobState,
  JobStats,
  LogEntry,
  LogLevel,
  Outcome,
  RateObservation,
  SampleCheck,
  ScanTarget,
} from './types';
import { READY_TABS, type ReadyTab, type WatchResult, type WatchTab } from './watch';
import type { ArchiveMode, ArchiveRequest } from './x-archive';
import { MAX_ENTITY_COUNT } from './x-entities';
import type { ViewCap } from './x-limits';
import { WATCHED_OPS } from './x-operations';

/** What the file says it is. A JSON file without it is not Xomoni's export. */
export const MOVE_FORMAT = 'xomoni-export';

/**
 * The version of the file's shape. Raise it when a table or a field is added or changes meaning: a Xomoni reads only
 * its own version, and tells the person to update when a file is newer.
 */
export const MOVE_VERSION = 1;

/**
 * The largest file an import reads: 256 MB, read before anything else. A large account (a hundred thousand posts and
 * likes, years of log) is far smaller; a larger file is refused before it is read, so it can't freeze the dashboard.
 */
export const MAX_MOVE_BYTES = 256 * 1024 * 1024;

/**
 * The tables a move carries, in the file's order. Together with `LEFT_OUT_TABLES` they name every table of the
 * database, which a test checks, so a table added later has to be decided on.
 */
export const MOVE_TABLES = [
  'accounts',
  'items',
  'jobs',
  'logs',
  'limits',
  'reads',
  'risk',
  'checks',
  'daily',
  'incoming',
  'kv',
] as const;

/** One of the tables in a move file. */
export type MoveTable = (typeof MOVE_TABLES)[number];

/** The tables a move leaves out on purpose, and why. */
export const LEFT_OUT_TABLES: Readonly<Record<string, string>> = {
  consents:
    'Informed consent is the person’s own act in this Xomoni: the new one asks again once, so no file can stand in for it.',
  // The vault's tables (ADR-0043) move from version 2 of the file on (#424, CV.1.4); until then nothing writes them.
  vaultImports: 'The vault’s import ledger moves with version 2 of the move file.',
  analyticsPosts: 'The vault’s analytics move with version 2 of the move file.',
  analyticsDays: 'The vault’s analytics move with version 2 of the move file.',
  accountEvents: 'The account’s timeline moves with version 2 of the move file.',
};

/** The `kv` values moved for the whole browser: the settings, and which account the dashboard shows. */
export const MOVED_VALUES = ['settings', 'activeAccount'] as const;

/**
 * The `kv` values moved for each X account (`<name>:<account id>`): Watch's searches, their last results and the posts
 * from new accounts already seen in its ready tabs (#391), so they don't count on the toolbar again, when the
 * X archive was imported (so the Cleanup page knows, PLAYBOOK E2), the archive asked for on X, and the daily view cap
 * learned from X (PLAYBOOK A4).
 */
export const MOVED_ACCOUNT_VALUES = [
  'watchTabs',
  'watchResults',
  'watchSeen',
  'archive',
  'archiveRequest',
  'viewCap',
] as const;

/**
 * Every other `kv` value stays behind, because it belongs to this browser's copy of Xomoni, not to the person's data:
 * the xomoni.com connection and its device token (`cloud`, a secret that must never be in a file; the new Xomoni signs
 * in with one click), the sign-in state (`signedOut`, `webLeftAt`, `connectRequest`), what was sent to xomoni.com
 * (`dailyStats`), release news, requests from xomoni.com that last minutes (`websitePlan`, `websiteStop`,
 * `websiteAsk`), the Downloads folder Chrome let this extension read (`downloadsFolder`, `archiveFolderMade`,
 * `archiveFolderChosen`, `archiveFilesSeen:…`), and whether the first-run offer was dismissed. A value added later
 * stays behind too, unless it is added to the lists above.
 */
export const LEFT_OUT_VALUES =
  'cloud, signedOut, webLeftAt, connectRequest, dailyStats, releaseNews, releaseDismissed, websitePlan, websiteStop, websiteAsk, downloadsFolder, archiveFolderMade, archiveFolderChosen, archiveFilesSeen:…, moveOffer';

/** One `kv` value in the file, by its key. */
export interface MoveValue {
  key: string;
  value: unknown;
}

/** The records of every moved table. `logs`, `reads`, `risk` and `checks` carry no `seq`: the receiver numbers them. */
export interface MoveData {
  accounts: Account[];
  items: Item[];
  jobs: Job[];
  logs: LogEntry[];
  limits: RateObservation[];
  reads: ReadUse[];
  risk: RiskEvent[];
  checks: SampleCheck[];
  daily: DailyStats[];
  incoming: IncomingReply[];
  kv: MoveValue[];
}

/** What the file says about itself; the checksum covers it with the data. */
export interface MoveHeader {
  format: typeof MOVE_FORMAT;
  version: typeof MOVE_VERSION;
  /** The version of the Xomoni that wrote it (`manifest.json`). */
  app: string;
  /** When it was written, as an ISO 8601 time. */
  exportedAt: string;
}

/** A whole move file, as written and as read back after every check. */
export interface MoveFile extends MoveHeader {
  /** `sha256:` and the hex SHA-256 of the header and the data (`moveChecksum`). */
  checksum: string;
  data: MoveData;
}

/** Why a file was refused; the message for each is in `MOVE_PROBLEMS`. */
export type MoveProblem =
  | 'too-big'
  | 'not-xomoni'
  | 'old-export'
  | 'newer'
  | 'other-version'
  | 'broken'
  | 'changed'
  | 'unknown-table'
  | 'bad-record'
  | 'empty';

/** What the person reads when a file is refused. Every one of them means nothing was imported. */
export const MOVE_PROBLEMS: Record<MoveProblem, string> = {
  'too-big': 'This file is larger than 256 MB, more than any Xomoni export. Nothing was imported.',
  'not-xomoni': 'This isn’t a file from Xomoni’s Export everything. Nothing was imported.',
  'old-export':
    'This file comes from an older Xomoni’s Export everything, which doesn’t hold all a move needs. Update the Xomoni you’re leaving, export again, and import the new file.',
  newer: 'This file was made by a newer Xomoni. Update this Xomoni first, then import it. Nothing was imported.',
  'other-version': 'This file’s format isn’t one this Xomoni reads. Nothing was imported.',
  broken: 'This file is damaged: parts of it are missing or out of shape. Export again. Nothing was imported.',
  changed:
    'This file was changed or damaged after it was exported: its checksum doesn’t match. Export again from the Xomoni you’re leaving. Nothing was imported.',
  'unknown-table':
    'This file holds data Xomoni doesn’t know. It was changed after it was exported, or made by another tool. Nothing was imported.',
  'bad-record':
    'A record in this file isn’t in the shape Xomoni writes. It was changed after it was exported, or made by another tool. Nothing was imported.',
  empty: 'This file holds no Xomoni data. Nothing was imported.',
};

/** A file that was refused: why, in the person's words, and where when a record was out of shape. */
export interface MoveRefusal {
  ok: false;
  problem: MoveProblem;
  message: string;
  /** The table and the record's number in it (from 1), for a broken record or an unknown table. */
  where?: string;
}

/** How many records of each table a file holds. */
export type MoveCounts = Record<MoveTable, number>;

/** One X account in a file, as the import's confirmation shows it. */
export interface MoveAccount {
  id: string;
  handle: string;
  /** Its posts, replies and reposts, and its likes. */
  posts: number;
  likes: number;
  jobs: number;
  logs: number;
}

/** What a checked file holds, for the person to confirm before anything is written. */
export interface MoveSummary {
  app: string;
  /** Epoch ms. */
  exportedAt: number;
  accounts: MoveAccount[];
  counts: MoveCounts;
}

/** A file that passed every check, with what it holds. */
export interface MoveCheck {
  ok: true;
  file: MoveFile;
  summary: MoveSummary;
}

const DAY_MS = 86_400_000;
/** How far in the future a time may lie: a computer's clock can run a little behind, as in `inbound.ts`. */
const FUTURE_SLACK_MS = DAY_MS;

/** The most accounts, `kv` values, sampled checks and rate-limit observations a file may hold. */
export const MOVE_LIMITS = { accounts: 100, kv: 2_000, checks: 10_000, limits: 5_000 } as const;

/** The longest text of a post kept in a file: longer than X allows, so no real post is refused. */
const MAX_POST_TEXT = 100_000;
/** The longest text of Xomoni's own (a log line, a job's reason or title, a report). */
const MAX_NOTE = 10_000;
/** The longest list of words or ids in a cleanup's rules. */
const MAX_LIST = 100_000;

const HANDLE_LIKE = /^[A-Za-z0-9_]{1,50}$/;
const JOB_ID = /^[A-Za-z0-9_-]{1,100}$/;
const APP_VERSION = /^[0-9A-Za-z.+-]{1,50}$/;
const CHECKSUM = /^sha256:[0-9a-f]{64}$/;
const DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/;

const ITEM_KINDS: ReadonlySet<string> = new Set<ItemKind>(['post', 'reply', 'repost', 'like']);
const ITEM_STATUSES: ReadonlySet<string> = new Set<ItemStatus>(['present', 'deleted', 'gone']);
const ITEM_SOURCES: ReadonlySet<string> = new Set<ItemSource>(['archive', 'scan']);
const JOB_KINDS: ReadonlySet<string> = new Set<JobKind>(['cleanup', 'scan', 'watch', 'archive']);
const JOB_STATES: ReadonlySet<string> = new Set<JobState>([
  'queued',
  'running',
  'waiting',
  'paused',
  'blocked',
  'completed',
  'cancelled',
  'failed',
]);
const SCAN_TARGETS: ReadonlySet<string> = new Set<ScanTarget>([
  'posts',
  'replies',
  'likes',
  'history',
  'complete',
  'range',
]);
const CLEANUP_TARGETS: ReadonlySet<string> = new Set<CleanupTarget>(['post', 'reply', 'repost', 'like']);
const ARCHIVE_MODES: ReadonlySet<string> = new Set<ArchiveMode>(['get', 'look']);
const LOG_LEVELS: ReadonlySet<string> = new Set<LogLevel>(['info', 'success', 'warn', 'error']);
const ACTIONS: ReadonlySet<string> = new Set<ActionKind | 'system'>([
  'delete',
  'unretweet',
  'unlike',
  'relike',
  'read',
  'system',
]);
const OUTCOMES: ReadonlySet<string> = new Set<Outcome>([
  'done',
  'already',
  'not_found',
  'skipped',
  'rate_limited',
  'daily_limit',
  'automation_flag',
  'locked',
  'suspended',
  'restricted',
  'logged_out',
  'failed',
]);
const RISK_KINDS: ReadonlySet<string> = new Set<RiskEventKind>([
  'automation_flag',
  'lock',
  'restricted',
  'suspended',
  'silent_block',
  'rate_limited',
  'override',
]);
const HEALTH_SIGNALS: ReadonlySet<string> = new Set<HealthSignal>([
  'automation_flag',
  'lock',
  'restricted',
  'suspended',
  'silent_block',
  'rate_limited',
]);
const BUDGETS: ReadonlySet<string> = new Set([
  'deletePost',
  'undoRepost',
  'unlike',
  'like',
  'search',
  'userTimeline',
  'likedPosts',
  'postLookup',
]);
const SAMPLED_ACTIONS: ReadonlySet<string> = new Set<SampleCheck['action']>([
  'delete',
  'unretweet',
  'unlike',
  'relike',
]);
const PACING_KEYS = ['minDelay', 'maxDelay', 'batchSize', 'batchPauseMin', 'batchPauseMax', 'hourlyCap', 'dailyCap'];

/** Thrown inside a record's check: the record is out of shape. Never leaves this file. */
class Bad extends Error {}

function bad(): never {
  throw new Bad();
}

const isId = (v: unknown): v is string => typeof v === 'string' && isXId(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isFinite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/**
 * Reads the record's fields one by one: each getter returns the checked value, gives a field that is missing the
 * `fallback` (what an older Xomoni didn't write yet), and throws `Bad` for a field in the wrong shape.
 */
class Fields {
  constructor(
    private readonly record: Record<string, unknown>,
    private readonly now: number,
  ) {}

  /** The raw value of a field. */
  raw(name: string): unknown {
    return this.record[name];
  }

  private value<T>(name: string, ok: (v: unknown) => v is T, fallback?: T): T {
    const v = this.record[name];
    if (v === undefined && fallback !== undefined) return fallback;
    return ok(v) ? v : bad();
  }

  /** An X id. */
  id(name: string): string {
    return this.value(name, isId);
  }
  /** An X id, or `''` where the field may be empty. */
  idOrEmpty(name: string, fallback?: string): string {
    return this.value(name, (v): v is string => v === '' || isId(v), fallback);
  }
  /** An X id or null. */
  idOrNull(name: string): string | null {
    return this.value(name, (v): v is string | null => v === null || isId(v), null);
  }
  /** A whole number of 0 or more. */
  count(name: string, fallback?: number): number {
    return this.value(name, isCount, fallback);
  }
  /** A post's links or media: a whole number from 0 to `MAX_ENTITY_COUNT` (#428). */
  entityCount(name: string): number {
    return this.value(name, (v): v is number => isCount(v) && v <= MAX_ENTITY_COUNT);
  }
  /** A count or null. */
  countOrNull(name: string): number | null {
    return this.value(name, (v): v is number | null => v === null || isCount(v), null);
  }
  /** A finite number (a date bound, which may lie in the future). */
  number(name: string, fallback?: number): number {
    return this.value(name, isFinite, fallback);
  }
  /** When something happened (epoch ms): not before 1970, and at most a day ahead of now. */
  time(name: string, fallback?: number): number {
    return this.value(name, (v): v is number => isFinite(v) && v >= 0 && v <= this.now + FUTURE_SLACK_MS, fallback);
  }
  /** A time or null. */
  timeOrNull(name: string): number | null {
    const v = this.record[name];
    return v === undefined || v === null ? null : this.time(name);
  }
  /** A text of at most `max` characters. */
  text(name: string, max: number, fallback?: string): string {
    return this.value(name, (v): v is string => isText(v, max), fallback);
  }
  /** A text or null. */
  textOrNull(name: string, max: number): string | null {
    return this.value(name, (v): v is string | null => v === null || isText(v, max), null);
  }
  /** A handle-like name (letters, digits, `_`, as X allows, up to 50), or `''`. */
  handle(name: string): string {
    return this.value(name, (v): v is string => v === '' || (typeof v === 'string' && HANDLE_LIKE.test(v)), '');
  }
  /** A boolean. */
  bool(name: string, fallback?: boolean): boolean {
    return this.value(name, (v): v is boolean => typeof v === 'boolean', fallback);
  }
  /** One of `allowed`. */
  oneOf<T extends string>(name: string, allowed: ReadonlySet<string>, fallback?: T): T {
    return this.value(name, (v): v is T => typeof v === 'string' && allowed.has(v), fallback);
  }
  /** A job's id, or null. */
  jobIdOrNull(name: string): string | null {
    return this.value(name, (v): v is string | null => v === null || (typeof v === 'string' && JOB_ID.test(v)), null);
  }
  /** An optional field: `read` when it is there, nothing when it is missing. */
  optional<K extends string, T>(name: K, read: (name: K) => T): Partial<Record<K, T>> {
    return this.record[name] === undefined ? {} : ({ [name]: read(name) } as Record<K, T>);
  }
}

/** Reads `value` as an object with `read`, or throws `Bad`. */
function object<T>(value: unknown, now: number, read: (f: Fields) => T): T {
  const record = asObject(value);
  return record ? read(new Fields(record, now)) : bad();
}

/** An array of at most `max` values, each one checked by `ok`. */
function list<T>(value: unknown, max: number, ok: (v: unknown) => v is T): T[] {
  if (!Array.isArray(value) || value.length > max) return bad();
  return (value as unknown[]).map((v) => (ok(v) ? v : bad()));
}

function account(f: Fields): Account {
  // The dashboard loads avatars from X's image hosts only (#143).
  const avatar = f.text('avatar', 1_100, '');
  if (avatar !== '' && !AVATAR_URL.test(avatar)) bad();
  return {
    id: f.id('id'),
    handle: f.handle('handle'),
    name: f.text('name', 1_000, ''),
    avatar,
    postsCount: f.countOrNull('postsCount'),
    likesCount: f.countOrNull('likesCount'),
    followers: f.countOrNull('followers'),
    following: f.countOrNull('following'),
    createdAt: f.timeOrNull('createdAt'),
    ...f.optional('profileAt', (n) => f.time(n)),
    ...f.optional('verified', (n) => (f.raw(n) === null ? null : f.bool(n))),
    updatedAt: f.time('updatedAt', 0),
  };
}

function item(f: Fields): Item {
  const accountId = f.id('accountId');
  const kind = f.oneOf<ItemKind>('kind', ITEM_KINDS);
  const id = f.id('id');
  if (f.raw('key') !== itemKey(accountId, kind, id)) bad();
  const sources = list(
    f.raw('sources') ?? ['scan'],
    2,
    (v): v is ItemSource => typeof v === 'string' && ITEM_SOURCES.has(v),
  );
  if (!sources.length || new Set(sources).size !== sources.length) bad();
  const extra: Partial<Item> = {};
  for (const name of ['quotes', 'bookmarks', 'views'] as const)
    Object.assign(
      extra,
      f.optional(name, (n) => f.count(n)),
    );
  Object.assign(
    extra,
    f.optional('quote', (n) => f.bool(n)),
  );
  // Links and media (#428): optional, 0 to 100 each, as `entityCounts` counts them, on the person's own posts and
  // replies only, as `inbound.ts` takes them from X's pages.
  for (const name of ['links', 'media'] as const)
    Object.assign(
      extra,
      f.optional(name, (n) => (kind === 'post' || kind === 'reply' ? f.entityCount(n) : bad())),
    );
  if (f.raw('replyTo') !== undefined) {
    const replyTo = f.handle('replyTo');
    if (kind !== 'reply' || !replyTo) bad();
    extra.replyTo = replyTo;
  }
  return {
    key: itemKey(accountId, kind, id),
    accountId,
    kind,
    id,
    targetId: f.idOrEmpty('targetId', kind === 'repost' ? '' : id),
    createdAt: f.time('createdAt', 0),
    likedAt: f.timeOrNull('likedAt'),
    text: f.text('text', MAX_POST_TEXT, ''),
    author: f.handle('author'),
    inReplyToId: f.idOrNull('inReplyToId'),
    selfReply: f.bool('selfReply', false),
    likes: f.count('likes', 0),
    reposts: f.count('reposts', 0),
    replies: f.count('replies', 0),
    ...extra,
    sources,
    status: f.oneOf<ItemStatus>('status', ITEM_STATUSES, 'present'),
    seenAt: f.time('seenAt', 0),
    statusAt: f.time('statusAt', 0),
    lastJobId: f.jobIdOrNull('lastJobId'),
  };
}

function filter(value: unknown, now: number): CleanupFilter {
  return object(value, now, (f) => {
    const target = f.oneOf<CleanupTarget>('target', CLEANUP_TARGETS);
    const words = list(f.raw('keepKeywords') ?? [], MAX_LIST, (v): v is string => isText(v, 1_000));
    const keepIds = list(f.raw('keepIds') ?? [], MAX_LIST, isId);
    const after = f.raw('after');
    return {
      target,
      before: f.number('before'),
      after: after === null || after === undefined ? null : f.number('after'),
      keepMinLikes: f.countOrNull('keepMinLikes'),
      keepKeywords: words,
      keepIds,
      skipSelfReplies: f.bool('skipSelfReplies', false),
      ...f.optional('onlyIds', (n) => list(f.raw(n), MAX_LIST, isId)),
    };
  });
}

function options(value: unknown, now: number): CleanupOptions {
  return object(value, now, (f) => ({
    sweep: f.bool('sweep'),
    deep: f.bool('deep'),
    ghostLikes: f.bool('ghostLikes', false),
  }));
}

function stats(value: unknown, now: number): JobStats {
  return object(value, now, (f) => ({
    matched: f.count('matched', 0),
    done: f.count('done', 0),
    skipped: f.count('skipped', 0),
    ...f.optional('unavailable', (n) => f.count(n)),
    failed: f.count('failed', 0),
    scanned: f.count('scanned', 0),
  }));
}

function range(value: unknown, now: number): DateRange {
  return object(value, now, (f) => ({ after: f.number('after'), before: f.number('before') }));
}

function health(value: unknown, now: number): JobHealth {
  return object(value, now, (f) => {
    const signals: JobHealth['signals'] = {};
    const raw = asObject(f.raw('signals') ?? {}) ?? bad();
    for (const [name, n] of Object.entries(raw)) {
      if (!HEALTH_SIGNALS.has(name) || !isCount(n)) bad();
      signals[name as HealthSignal] = n;
    }
    const checks: SampleTally = object(f.raw('checks'), now, (c) => ({
      applied: c.count('applied', 0),
      notApplied: c.count('notApplied', 0),
      unclear: c.count('unclear', 0),
      pending: c.count('pending', 0),
    }));
    const level = f.count('level', 0);
    if (level > 4) bad();
    return {
      at: f.time('at'),
      level: level as RiskLevel,
      signals,
      checks,
      notice: f.textOrNull('notice', MAX_NOTE),
      restHours: f.count('restHours', 0),
      summary: f.text('summary', MAX_NOTE, ''),
    };
  });
}

function job(f: Fields, now: number): Job {
  const id = f.raw('id');
  if (typeof id !== 'string' || !JOB_ID.test(id)) return bad();
  const nullable = <T>(name: string, read: (v: unknown, now: number) => T): T | null => {
    const v = f.raw(name);
    return v === undefined || v === null ? null : read(v, now);
  };
  return {
    id,
    accountId: f.id('accountId'),
    kind: f.oneOf<JobKind>('kind', JOB_KINDS),
    title: f.text('title', MAX_NOTE, ''),
    filter: nullable('filter', filter),
    options: nullable('options', options),
    scan: f.raw('scan') === null || f.raw('scan') === undefined ? null : f.oneOf<ScanTarget>('scan', SCAN_TARGETS),
    ...f.optional('range', (n) => range(f.raw(n), now)),
    ...f.optional('archive', (n) => f.oneOf<ArchiveMode>(n, ARCHIVE_MODES)),
    state: f.oneOf<JobState>('state', JOB_STATES),
    phase: f.text('phase', 200, ''),
    ...f.optional('scannedAtPageStart', (n) => f.count(n)),
    ...f.optional('health', (n) => health(f.raw(n), now)),
    stateReason: f.text('stateReason', MAX_NOTE, ''),
    stats: f.raw('stats') === undefined ? stats({}, now) : stats(f.raw('stats'), now),
    createdAt: f.time('createdAt', 0),
    startedAt: f.timeOrNull('startedAt'),
    finishedAt: f.timeOrNull('finishedAt'),
    updatedAt: f.time('updatedAt', 0),
  };
}

function log(f: Fields): LogEntry {
  const targetId = f.raw('targetId');
  if (!(targetId === undefined || targetId === null || targetId === '' || isId(targetId))) bad();
  const outcome = f.raw('outcome');
  return {
    ts: f.time('ts'),
    accountId: f.idOrEmpty('accountId'),
    jobId: f.jobIdOrNull('jobId'),
    level: f.oneOf<LogLevel>('level', LOG_LEVELS),
    action: f.oneOf<ActionKind | 'system'>('action', ACTIONS),
    targetId: targetId ?? null,
    outcome: outcome === undefined || outcome === null ? null : f.oneOf<Outcome>('outcome', OUTCOMES),
    message: f.text('message', MAX_NOTE, ''),
  };
}

function limit(f: Fields): RateObservation {
  const accountId = f.id('accountId');
  const op = f.oneOf<string>('op', WATCHED_OPS);
  if (f.raw('key') !== `${accountId}:${op}`) bad();
  const status = f.count('status');
  if (status > 599) bad();
  const reset = f.raw('reset');
  return {
    key: `${accountId}:${op}`,
    accountId,
    op,
    limit: f.countOrNull('limit'),
    remaining: f.countOrNull('remaining'),
    reset: reset === null || reset === undefined ? null : f.number('reset'),
    status,
    at: f.time('at'),
  };
}

function read(f: Fields): ReadUse {
  return {
    accountId: f.id('accountId'),
    budget: f.oneOf<string>('budget', BUDGETS),
    ts: f.time('ts'),
    ...f.optional('posts', (n) => f.count(n)),
  };
}

function risk(f: Fields): RiskEvent {
  return { accountId: f.id('accountId'), kind: f.oneOf<RiskEventKind>('kind', RISK_KINDS), at: f.time('at') };
}

function check(f: Fields): SampleCheck {
  const jobId = f.jobIdOrNull('jobId') ?? bad();
  return {
    accountId: f.id('accountId'),
    jobId,
    action: f.oneOf<SampleCheck['action']>('action', SAMPLED_ACTIONS),
    postId: f.id('postId'),
    at: f.time('at'),
    dueAt: f.time('dueAt'),
  };
}

function daily(f: Fields): DailyStats {
  const day = f.text('day', 10);
  if (!DAY_TEXT.test(day)) bad();
  return {
    accountId: f.id('accountId'),
    day,
    followers: f.countOrNull('followers'),
    following: f.countOrNull('following'),
    postsTotal: f.countOrNull('postsTotal'),
    likesTotal: f.countOrNull('likesTotal'),
    receivedLikes: f.count('receivedLikes', 0),
    receivedReplies: f.count('receivedReplies', 0),
    receivedReposts: f.count('receivedReposts', 0),
    receivedQuotes: f.count('receivedQuotes', 0),
    receivedViews: f.count('receivedViews', 0),
    observedPosts: f.count('observedPosts', 0),
    postsWithLikes: f.count('postsWithLikes', 0),
    repliesWithLikes: f.count('repliesWithLikes', 0),
    updatedAt: f.time('updatedAt', 0),
  };
}

function incoming(f: Fields): IncomingReply {
  const accountId = f.id('accountId');
  const id = f.id('id');
  if (f.raw('key') !== incomingKey(accountId, id)) bad();
  const author = f.handle('author');
  if (!author) bad();
  return {
    key: incomingKey(accountId, id),
    accountId,
    id,
    author,
    // Replies are kept cut to 1,000 characters (ADR-0030); a longer one is cut the same way.
    text: f.text('text', MAX_POST_TEXT).slice(0, INCOMING_TEXT),
    createdAt: f.time('createdAt'),
    toId: f.id('toId'),
  };
}

/**
 * A number of the settings, 0 or more. Settings are stored as they were typed, so an older Xomoni may have kept one as
 * text (`normalizeSettings` reads it the same way).
 */
function setting(value: unknown): number {
  const n = asNumber(value);
  return n !== undefined && n >= 0 ? n : bad();
}

function pacingRule(value: unknown, now: number): Record<string, number> {
  return object(value, now, (f) => {
    const rule: Record<string, number> = {};
    for (const key of PACING_KEYS) if (f.raw(key) !== undefined) rule[key] = setting(f.raw(key));
    return rule;
  });
}

/** The stored settings, checked field by field; `normalizeSettings` brings them inside the safety rules on import. */
function settings(value: unknown, now: number): Record<string, unknown> {
  return object(value, now, (f) => {
    const copy: Record<string, unknown> = {};
    if (f.raw('preset') !== undefined) copy.preset = f.text('preset', 20);
    if (f.raw('pacing') !== undefined) {
      const pacing = asObject(f.raw('pacing')) ?? bad();
      const rules: Record<string, unknown> = {};
      for (const [action, rule] of Object.entries(pacing)) {
        if (!ACTIONS.has(action) || action === 'system') bad();
        rules[action] = pacingRule(rule, now);
      }
      copy.pacing = rules;
    }
    if (f.raw('activeHours') !== undefined) {
      copy.activeHours = object(f.raw('activeHours'), now, (h) => {
        const start = setting(h.raw('start'));
        const end = setting(h.raw('end'));
        if (!Number.isInteger(start) || !Number.isInteger(end) || start > 23 || end > 23) bad();
        return { enabled: h.bool('enabled'), start, end };
      });
    }
    if (f.raw('maxConsecutiveFailures') !== undefined)
      copy.maxConsecutiveFailures = setting(f.raw('maxConsecutiveFailures'));
    if (f.raw('notifications') !== undefined) copy.notifications = f.bool('notifications');
    if (f.raw('whileAway') !== undefined) copy.whileAway = f.bool('whileAway');
    return copy;
  });
}

/** The names of Watch's ready tabs (#391). */
const READY: ReadonlySet<string> = new Set(READY_TABS);

function watchTabs(value: unknown, now: number): WatchTab[] {
  if (!Array.isArray(value) || value.length > 20) return bad();
  return (value as unknown[]).map((tab) =>
    object(tab, now, (f) => ({
      id: f.text('id', 50),
      query: f.text('query', 500),
      // A ready tab (#391), by its name: its query is the account's own.
      ...f.optional('ready', (n) => f.oneOf<ReadyTab>(n, READY)),
    })),
  );
}

function watchResults(value: unknown, now: number): Record<string, WatchResult> {
  const record = asObject(value) ?? bad();
  const entries = Object.entries(record);
  if (entries.length > 20) bad();
  const results: Record<string, WatchResult> = {};
  for (const [tabId, result] of entries) {
    if (tabId.length > 50) bad();
    results[tabId] = object(result, now, (f) => {
      const posts = f.raw('posts') ?? [];
      if (!Array.isArray(posts) || posts.length > 50) bad();
      return {
        query: f.text('query', 500),
        checkedAt: f.time('checkedAt'),
        posts: (posts as unknown[]).map((post) =>
          object(post, now, (p) => ({
            id: p.id('id'),
            handle: p.handle('handle'),
            name: p.text('name', 1_000, ''),
            text: p.text('text', MAX_POST_TEXT, ''),
            time: p.timeOrNull('time'),
            // When the author's account was made, as X's search said (#391); any past time, or a little ahead.
            ...p.optional('accountCreatedAt', (n) => p.time(n)),
          })),
        ),
        error: f.text('error', MAX_NOTE, ''),
      };
    });
  }
  return results;
}

/** The posts from new accounts seen in each ready tab (#391): post ids by tab id, a few checks' worth each. */
function watchSeen(value: unknown): Record<string, string[]> {
  const record = asObject(value) ?? bad();
  const entries = Object.entries(record);
  if (entries.length > 20) bad();
  const seen: Record<string, string[]> = {};
  for (const [tabId, ids] of entries) {
    if (tabId.length > 50) bad();
    seen[tabId] = list(ids, 200, (id): id is string => typeof id === 'string' && isXId(id));
  }
  return seen;
}

function archiveRequest(value: unknown, now: number): ArchiveRequest | null {
  if (value === null) return null;
  return object(value, now, (f) => ({
    requestedAt: f.time('requestedAt'),
    checkedAt: f.time('checkedAt', 0),
    downloadedAt: f.timeOrNull('downloadedAt'),
  }));
}

function viewCap(value: unknown, now: number): ViewCap {
  return object(value, now, (f) => ({
    cap: f.count('cap'),
    seen: f.count('seen', 0),
    learnedAt: f.time('learnedAt', 0),
  }));
}

/** The check of each moved `kv` value, by its name. */
const VALUE_CHECKS: Record<string, (value: unknown, now: number) => unknown> = {
  settings,
  activeAccount: (v) => (isId(v) ? v : bad()),
  watchTabs,
  watchResults,
  watchSeen,
  // When the archive was imported; imports before #185 kept no date, only that it happened.
  archive: (v, now) => (v === true || (isFinite(v) && v >= 0 && v <= now + FUTURE_SLACK_MS) ? v : bad()),
  archiveRequest,
  viewCap,
};

/** The name of a moved `kv` key (`settings`, or `watchTabs` for `watchTabs:<account id>`); null for any other. */
export function movedValueName(key: string): string | null {
  if ((MOVED_VALUES as readonly string[]).includes(key)) return key;
  const at = key.indexOf(':');
  if (at <= 0) return null;
  const name = key.slice(0, at);
  return (MOVED_ACCOUNT_VALUES as readonly string[]).includes(name) && isXId(key.slice(at + 1)) ? name : null;
}

function value(f: Fields, now: number): MoveValue {
  const key = f.text('key', 200);
  const name = movedValueName(key);
  const checkValue = name ? VALUE_CHECKS[name] : undefined;
  if (!checkValue) throw new UnknownTable(`kv: ${key}`);
  return { key, value: checkValue(f.raw('value'), now) };
}

/** A table, or a `kv` key, this version doesn't move. */
class UnknownTable extends Error {}

/** The check of each moved table's records. */
const RECORD_CHECKS: { [T in MoveTable]: (f: Fields, now: number) => MoveData[T][number] } = {
  accounts: account,
  items: item,
  jobs: job,
  logs: log,
  limits: limit,
  reads: read,
  risk,
  checks: check,
  daily,
  incoming,
  kv: value,
};

/** The primary key of each table that has one of its own; rows of the other tables may repeat. */
const KEYS: { [T in MoveTable]?: (record: MoveData[T][number]) => string } = {
  accounts: (a) => a.id,
  items: (i) => i.key,
  jobs: (j) => j.id,
  limits: (l) => l.key,
  daily: (d) => `${d.accountId}:${d.day}`,
  incoming: (r) => r.key,
  kv: (v) => v.key,
};

/**
 * A record of `table` as a move file holds it, checked and copied field by field, or null when it is out of shape. The
 * export runs every row through it, so a file Xomoni writes always passes the import's checks.
 */
export function moveRecord<T extends MoveTable>(table: T, record: unknown, now: number): MoveData[T][number] | null {
  try {
    return object<MoveData[T][number]>(record, now, (f) => RECORD_CHECKS[table](f, now));
  } catch (err) {
    if (err instanceof Bad || err instanceof UnknownTable) return null;
    throw err;
  }
}

/** Hex SHA-256 of the header and data, as `sha256:<hex>`: the checksum a move file carries. */
export async function moveChecksum(header: MoveHeader, data: unknown): Promise<string> {
  const { format, version, app, exportedAt } = header;
  const text = JSON.stringify({ format, version, app, exportedAt, data });
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return `sha256:${Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** The text of a move file holding `data`, with its checksum; `now` is the export's time. */
export async function writeMoveFile(app: string, data: MoveData, now: number): Promise<string> {
  const header: MoveHeader = {
    format: MOVE_FORMAT,
    version: MOVE_VERSION,
    app,
    exportedAt: new Date(now).toISOString(),
  };
  const checksum = await moveChecksum(header, data);
  return JSON.stringify({ ...header, checksum, data } satisfies MoveFile);
}

const refuse = (problem: MoveProblem, where?: string): MoveRefusal => ({
  ok: false,
  problem,
  message: MOVE_PROBLEMS[problem],
  ...(where && { where }),
});

/** Whether `root` looks like the *Export everything* file of Xomoni 0.4 and older: no format, four tables. */
const isOldExport = (root: Record<string, unknown>) =>
  root.format === undefined &&
  typeof root.exportedAt === 'string' &&
  Array.isArray(root.accounts) &&
  Array.isArray(root.items);

/** How many records of each table `data` holds. */
export function moveCounts(data: MoveData): MoveCounts {
  return Object.fromEntries(MOVE_TABLES.map((t) => [t, data[t].length])) as MoveCounts;
}

/** What `file` holds, per X account and per table, for the person to confirm. */
export function summarizeMove(file: MoveFile): MoveSummary {
  const per = new Map<string, MoveAccount>();
  for (const a of file.data.accounts)
    per.set(a.id, { id: a.id, handle: a.handle, posts: 0, likes: 0, jobs: 0, logs: 0 });
  for (const i of file.data.items) {
    const a = per.get(i.accountId);
    if (a && i.kind === 'like') a.likes++;
    else if (a) a.posts++;
  }
  for (const j of file.data.jobs) {
    const a = per.get(j.accountId);
    if (a) a.jobs++;
  }
  for (const l of file.data.logs) {
    const a = per.get(l.accountId);
    if (a) a.logs++;
  }
  return {
    app: file.app,
    exportedAt: Date.parse(file.exportedAt),
    accounts: [...per.values()],
    counts: moveCounts(file.data),
  };
}

/**
 * Reads the text of a move file and checks all of it, in this order: it is JSON, it says it is Xomoni's export of this
 * version (an older Xomoni's partial export, a newer format and any other version are refused with their own message),
 * its checksum matches its content, it holds every moved table and no other, no table is larger than Xomoni keeps
 * (`MOVE_LIMITS`), and every record has the shape Xomoni writes. Anything wrong refuses the whole file. Writes nothing.
 */
export async function checkMoveText(text: string, now = Date.now()): Promise<MoveCheck | MoveRefusal> {
  if (text.length > MAX_MOVE_BYTES) return refuse('too-big');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refuse('not-xomoni');
  }
  const root = asObject(parsed);
  if (!root) return refuse('not-xomoni');
  if (root.format !== MOVE_FORMAT) return refuse(isOldExport(root) ? 'old-export' : 'not-xomoni');
  const { version, app, exportedAt, checksum, data } = root;
  if (typeof version !== 'number' || !Number.isInteger(version)) return refuse('other-version');
  if (version > MOVE_VERSION) return refuse('newer');
  if (version !== MOVE_VERSION) return refuse('other-version');
  const at = typeof exportedAt === 'string' ? Date.parse(exportedAt) : NaN;
  if (typeof app !== 'string' || !APP_VERSION.test(app) || !(at >= 0 && at <= now + FUTURE_SLACK_MS)) {
    return refuse('broken');
  }
  if (typeof checksum !== 'string' || !CHECKSUM.test(checksum) || !asObject(data)) return refuse('broken');
  const header: MoveHeader = { format: MOVE_FORMAT, version: MOVE_VERSION, app, exportedAt: exportedAt as string };
  if ((await moveChecksum(header, data)) !== checksum) return refuse('changed');

  const tables = asObject(data) ?? {};
  const unknown = Object.keys(tables).find((name) => !(MOVE_TABLES as readonly string[]).includes(name));
  if (unknown !== undefined) return refuse('unknown-table', unknown.slice(0, 50));
  const checked = {} as Record<MoveTable, unknown[]>;
  for (const table of MOVE_TABLES) {
    const rows = tables[table];
    if (!Array.isArray(rows)) return refuse('broken', table);
    const most = (MOVE_LIMITS as Partial<Record<MoveTable, number>>)[table];
    if (most !== undefined && rows.length > most) return refuse('too-big', table);
    const copies: unknown[] = [];
    const keys = new Set<string>();
    const keyOf = KEYS[table];
    for (const [i, row] of (rows as unknown[]).entries()) {
      try {
        const copy = object(row, now, (f) => RECORD_CHECKS[table](f, now));
        // Two records with one key can't come from one table: the file was put together by hand.
        const key = keyOf?.(copy as never);
        if (key !== undefined && keys.has(key)) bad();
        if (key !== undefined) keys.add(key);
        copies.push(copy);
      } catch (err) {
        if (err instanceof UnknownTable) return refuse('unknown-table', err.message);
        if (err instanceof Bad) return refuse('bad-record', `${table}, record ${i + 1}`);
        throw err;
      }
    }
    checked[table] = copies;
  }
  const file: MoveFile = { ...header, checksum, data: checked as unknown as MoveData };
  if (MOVE_TABLES.every((t) => file.data[t].length === 0)) return refuse('empty');
  return { ok: true, file, summary: summarizeMove(file) };
}

/**
 * Checks a file the person chose: refused at once when it is larger than `MAX_MOVE_BYTES` (before it is read), else
 * read as text and checked by `checkMoveText`.
 */
export async function checkMoveFile(
  file: Pick<Blob, 'size' | 'text'>,
  now = Date.now(),
): Promise<MoveCheck | MoveRefusal> {
  if (file.size > MAX_MOVE_BYTES) return refuse('too-big');
  return checkMoveText(await file.text(), now);
}
