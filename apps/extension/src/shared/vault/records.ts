// The shape of every vault row (ADR-0043), checked and copied field by field before it is written: by the vault's own
// writers (`vault/db.ts`) and by the move file (ADR-0032, version 2). Every value is `unknown` until checked
// (ADR-0016): ids are X ids, numbers are whole and between 0 and `MAX_COUNT`, days are `YYYY-MM-DD` and not in the
// future, kinds come from closed lists, texts have a size limit. A record out of shape gives null. Pure.
import { isXId } from '../ids';
import { asObject } from '../json';
import {
  ACCOUNT_EVENT_KINDS,
  ACCOUNT_EVENT_SOURCES,
  type AccountEvent,
  type AccountEventKind,
  type AccountEventSource,
  type AnalyticsDay,
  type AnalyticsPost,
  ANALYTICS_TEXT,
  DAY_METRICS,
  DAY_TEXT,
  EVENT_WORDS,
  FINGERPRINT,
  type ImportCounts,
  MAX_COUNT,
  MAX_FILE_NAME,
  MAX_PROBLEM,
  MAX_PROBLEMS,
  POST_METRICS,
  REF,
  VAULT_SOURCES,
  type VaultImport,
  type VaultSource,
} from './types';

/** How far ahead of now a time or a day may lie: a computer's clock can run a little behind, as in `inbound.ts`. */
export const FUTURE_SLACK_MS = 86_400_000;

/** The key of an analytics post row: `<account id>:<post id>`. */
export const analyticsPostKey = (accountId: string, postId: string) => `${accountId}:${postId}`;

/** Thrown inside a check: the record is out of shape. Never leaves this file. */
class Bad extends Error {}

function bad(): never {
  throw new Bad();
}

const isCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= MAX_COUNT;

/** A time (epoch ms): not before 1970, at most `FUTURE_SLACK_MS` ahead of `now`. */
const isTime = (v: unknown, now: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= now + FUTURE_SLACK_MS;

const SOURCES: ReadonlySet<string> = new Set(VAULT_SOURCES);
const KINDS: ReadonlySet<string> = new Set(ACCOUNT_EVENT_KINDS);
const EVENT_SOURCES: ReadonlySet<string> = new Set(ACCOUNT_EVENT_SOURCES);
/** Ledger ids: what `newImportId` makes, and nothing that could carry markup. */
const IMPORT_ID = /^[0-9]{1,20}:[a-z-]{1,40}:[0-9]{1,16}:[0-9a-z]{1,16}$/;
/** A parser's name and version, such as `x-archive@1`. */
const PARSER = /^[a-z0-9-]{1,40}@[0-9]{1,4}$/;

/**
 * Whether `day` (`YYYY-MM-DD`) is a real calendar day, not after the day `FUTURE_SLACK_MS` from `now` (in UTC, so a
 * person ahead of UTC is never refused their own today).
 */
export function isVaultDay(day: unknown, now: number): day is string {
  if (typeof day !== 'string' || !DAY_TEXT.test(day)) return false;
  const at = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(at) || new Date(at).toISOString().slice(0, 10) !== day) return false;
  return at >= Date.UTC(2006, 0, 1) && at <= now + FUTURE_SLACK_MS;
}

/**
 * The person's or Xomoni's words for the timeline, as stored: control characters (but line breaks) removed, trimmed,
 * and cut to `EVENT_WORDS`. Markup stays as typed: it is text, and is only ever shown as text.
 */
export function cleanWords(words: string): string {
  let kept = '';
  for (const char of words) {
    const code = char.charCodeAt(0);
    if (char === '\n' || (code >= 0x20 && code !== 0x7f)) kept += char;
  }
  return kept.trim().slice(0, EVENT_WORDS);
}

/** Reads `value` as an object with `read`, or null when it is out of shape. */
function checked<T>(value: unknown, read: (record: Record<string, unknown>) => T): T | null {
  const record = asObject(value);
  if (!record) return null;
  try {
    return read(record);
  } catch (err) {
    if (err instanceof Bad) return null;
    throw err;
  }
}

/** Copies the metrics named in `names` that are present, each a count; any other value makes the record bad. */
function metrics<K extends string>(record: Record<string, unknown>, names: readonly K[]): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  for (const name of names) {
    const v = record[name];
    if (v === undefined) continue;
    if (!isCount(v)) bad();
    out[name] = v;
  }
  return out;
}

function counts(value: unknown): ImportCounts {
  const record = asObject(value) ?? bad();
  const { read, merged, skipped, parts } = record;
  if (!isCount(read) || !isCount(merged) || !isCount(skipped)) bad();
  const out: ImportCounts = { read, merged, skipped };
  if (parts !== undefined) {
    const entries = Object.entries(asObject(parts) ?? bad());
    if (entries.length > 20) bad();
    out.parts = {};
    for (const [name, n] of entries) {
      if (!/^[a-zA-Z0-9_-]{1,40}$/.test(name) || !isCount(n)) bad();
      out.parts[name] = n;
    }
  }
  return out;
}

/** A row of the import ledger, checked and copied, or null. */
export function vaultImportRecord(value: unknown, now: number): VaultImport | null {
  return checked(value, (r) => {
    const { id, accountId, source, fileName, bytes, fingerprint, importedAt, coverFrom, coverTo, parser, problems } = r;
    if (typeof accountId !== 'string' || !isXId(accountId)) bad();
    if (typeof source !== 'string' || !SOURCES.has(source)) bad();
    if (typeof id !== 'string' || !IMPORT_ID.test(id) || !id.startsWith(`${accountId}:${source}:`)) bad();
    if (typeof fileName !== 'string' || fileName.length > MAX_FILE_NAME) bad();
    if (!isCount(bytes)) bad();
    if (typeof fingerprint !== 'string' || !FINGERPRINT.test(fingerprint)) bad();
    if (!isTime(importedAt, now)) bad();
    const cover = (v: unknown) => (v === null || v === undefined ? null : isTime(v, now) ? v : bad());
    const [from, to] = [cover(coverFrom), cover(coverTo)];
    if (from !== null && to !== null && from > to) bad();
    if (typeof parser !== 'string' || !PARSER.test(parser)) bad();
    if (!Array.isArray(problems) || problems.length > MAX_PROBLEMS) bad();
    const codes = (problems as unknown[]).map((p) => (typeof p === 'string' && p.length <= MAX_PROBLEM ? p : bad()));
    return {
      id,
      accountId,
      source: source as VaultSource,
      fileName,
      bytes,
      fingerprint,
      importedAt,
      coverFrom: from,
      coverTo: to,
      counts: counts(r.counts),
      parser,
      problems: codes,
    };
  });
}

/** An analytics post row, checked and copied, or null. Its `key` must agree with its account and post. */
export function analyticsPostRecord(value: unknown, now: number): AnalyticsPost | null {
  return checked(value, (r) => {
    const { accountId, postId, createdAt, asOf, text } = r;
    if (typeof accountId !== 'string' || !isXId(accountId)) bad();
    if (typeof postId !== 'string' || !isXId(postId)) bad();
    if (r.key !== undefined && r.key !== analyticsPostKey(accountId, postId)) bad();
    if (!isTime(createdAt, now) || !isTime(asOf, now)) bad();
    if (text !== undefined && (typeof text !== 'string' || text.length > ANALYTICS_TEXT)) bad();
    return {
      key: analyticsPostKey(accountId, postId),
      accountId,
      postId,
      createdAt,
      asOf,
      ...metrics(r, POST_METRICS),
      ...(text !== undefined && { text }),
    };
  });
}

/** An analytics day row, checked and copied, or null. */
export function analyticsDayRecord(value: unknown, now: number): AnalyticsDay | null {
  return checked(value, (r) => {
    const { accountId, day, asOf } = r;
    if (typeof accountId !== 'string' || !isXId(accountId)) bad();
    if (!isVaultDay(day, now)) bad();
    if (!isTime(asOf, now)) bad();
    return { accountId, day, asOf, ...metrics(r, DAY_METRICS) };
  });
}

/**
 * A timeline event, checked and copied, or null. `words` longer than `EVENT_WORDS` make it bad: the vault's writers cut
 * them first (`cleanWords`), so a longer one was written by something else. `seq` is left out; the receiver numbers.
 */
export function accountEventRecord(value: unknown, now: number): AccountEvent | null {
  return checked(value, (r) => {
    const { accountId, kind, at, source, words, ref } = r;
    if (typeof accountId !== 'string' || !isXId(accountId)) bad();
    if (typeof kind !== 'string' || !KINDS.has(kind)) bad();
    if (!isTime(at, now)) bad();
    if (typeof source !== 'string' || !EVENT_SOURCES.has(source)) bad();
    if (typeof words !== 'string' || words.length > EVENT_WORDS) bad();
    if (ref !== undefined && (typeof ref !== 'string' || !REF.test(ref))) bad();
    return {
      accountId,
      kind: kind as AccountEventKind,
      at,
      source: source as AccountEventSource,
      words,
      ...(ref !== undefined && { ref }),
    };
  });
}
