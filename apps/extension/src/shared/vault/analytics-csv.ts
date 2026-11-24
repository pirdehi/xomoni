// X's analytics export, read (#425, ADR-0043): the CSV of posts (X's current *Content* export, or the older *Tweet
// activity* one) and the CSV of days (the *Overview* export). X renames columns without notice, so each field is found
// by its known names (`HEADER_ALIASES`), a column Xomoni doesn't know is ignored and named in the ledger's problems, and
// a row that can't be read is skipped with its line number. A file is refused only when nothing in it is X's analytics.
// Pure; safe for the content script.
import { isXId } from '../ids';
import { snowflakeTime } from '../time';
import { type CsvTable, parseCsv } from './csv';
import { isVaultDay } from './records';
import {
  ANALYTICS_TEXT,
  type AnalyticsDay,
  type AnalyticsPost,
  DAY_METRICS,
  type DayMetric,
  POST_METRICS,
  type PostMetric,
} from './types';

/** A column of X's analytics Xomoni reads: a post's id, link, text or date, or one of its numbers. */
export type AnalyticsField = 'postId' | 'postLink' | 'text' | 'date' | PostMetric | DayMetric;

/**
 * The names X has given each field, lowercased with single spaces, in its current exports and its older one. A column
 * whose name isn't here is ignored, and named in the ledger's problems.
 */
export const HEADER_ALIASES: Readonly<Record<AnalyticsField, readonly string[]>> = {
  postId: ['post id', 'tweet id', 'id'],
  postLink: ['post link', 'tweet permalink', 'permalink'],
  text: ['post text', 'tweet text', 'text'],
  date: ['date', 'time', 'day'],
  impressions: ['impressions', 'views'],
  engagements: ['engagements'],
  likes: ['likes'],
  reposts: ['reposts', 'retweets'],
  replies: ['replies'],
  quotes: ['quotes'],
  bookmarks: ['bookmarks'],
  shares: ['shares'],
  profileVisits: ['profile visits', 'user profile clicks'],
  linkClicks: ['url clicks', 'link clicks'],
  detailExpands: ['detail expands'],
  newFollows: ['new follows', 'follows'],
  unfollows: ['unfollows'],
  postsCreated: ['create post', 'posts created'],
  mediaViews: ['media views'],
  videoViews: ['video views'],
};

/** Columns X writes that Xomoni knows and leaves out on purpose: rates it can compute, and paid promotion. */
const KNOWN_UNUSED = new Set([
  'engagement rate',
  'hashtag clicks',
  'permalink clicks',
  'app opens',
  'app installs',
  'email tweet',
  'dial phone',
  'media engagements',
  'promoted impressions',
  'promoted engagements',
  'promoted engagement rate',
  'promoted retweets',
  'promoted replies',
  'promoted likes',
  'promoted user profile clicks',
  'promoted url clicks',
  'promoted hashtag clicks',
  'promoted detail expands',
  'promoted permalink clicks',
  'promoted app opens',
  'promoted app installs',
  'promoted follows',
  'promoted email tweet',
  'promoted dial phone',
  'promoted media views',
  'promoted media engagements',
]);

/** A header as `HEADER_ALIASES` names it: trimmed, lowercased, with single spaces. */
export const normalizeHeader = (header: string) => header.trim().toLowerCase().replace(/\s+/g, ' ');

const BY_NAME = new Map<string, AnalyticsField>(
  (Object.entries(HEADER_ALIASES) as [AnalyticsField, readonly string[]][]).flatMap(([field, names]) =>
    names.map((name) => [name, field] as const),
  ),
);

/** Each column's field, in order (null for one Xomoni doesn't read), and the names of those it doesn't know. */
export function mapHeaders(headers: readonly string[]): { fields: (AnalyticsField | null)[]; unknown: string[] } {
  const seen = new Set<AnalyticsField>();
  const fields = headers.map((header) => {
    const field = BY_NAME.get(normalizeHeader(header)) ?? null;
    // A field named twice is read from its first column only.
    if (!field || seen.has(field)) return null;
    seen.add(field);
    return field;
  });
  const unknown = headers.filter((h, i) => fields[i] === null && h.trim() && !KNOWN_UNUSED.has(normalizeHeader(h)));
  return { fields, unknown: unknown.map((h) => h.trim().slice(0, 60)) };
}

const POST_SET: ReadonlySet<string> = new Set(POST_METRICS);
const DAY_SET: ReadonlySet<string> = new Set(DAY_METRICS);

/** What a CSV's header says it is, and how sure that is: the share of its columns Xomoni knows, from 0 to 1. */
export interface AnalyticsKind {
  kind: 'posts' | 'days' | null;
  confidence: number;
}

/**
 * Whether a header is X's analytics of posts (a post's id or link, and at least one of its numbers) or of days (a date
 * and at least two numbers, no post id), or neither.
 */
export function classifyAnalyticsCsv(headers: readonly string[]): AnalyticsKind {
  const { fields } = mapHeaders(headers);
  const named = headers.filter((h) => h.trim()).length;
  const known =
    fields.filter((f) => f !== null).length + headers.filter((h) => KNOWN_UNUSED.has(normalizeHeader(h))).length;
  const confidence = named ? Math.round((known / named) * 100) / 100 : 0;
  const has = (f: AnalyticsField) => fields.includes(f);
  const postNumbers = fields.filter((f): f is AnalyticsField => f !== null && POST_SET.has(f)).length;
  const dayNumbers = fields.filter((f): f is AnalyticsField => f !== null && DAY_SET.has(f)).length;
  if ((has('postId') || has('postLink')) && postNumbers >= 1) return { kind: 'posts', confidence };
  if (has('date') && dayNumbers >= 2) return { kind: 'days', confidence };
  return { kind: null, confidence };
}

/**
 * A count in X's export: a whole number of 0 or more, written plainly, with thousands separators (`1,234`, `1 234`) or
 * as X's older export did (`845.0`). Empty or `-` is unknown (null); anything else, a negative number among them, is
 * `bad`.
 */
export function toNumber(cell: string): number | null | 'bad' {
  const text = cell.trim().replace(/[\u00a0\u202f\u0020]/g, '');
  if (text === '' || text === '-' || text === '–') return null;
  const plain = /^\d{1,3}(,\d{3})+$/.test(text) ? text.replace(/,/g, '') : text;
  if (!/^\d+(\.0+)?$/.test(plain)) return 'bad';
  const n = Number(plain);
  return Number.isSafeInteger(n) ? n : 'bad';
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const pad = (n: number) => String(n).padStart(2, '0');

/** A day and a moment from its parts, or null when they aren't a real date. */
function dayFrom(year: number, month: number, day: number, at?: number): { day: string; at: number } | null {
  const text = `${String(year)}-${pad(month)}-${pad(day)}`;
  const ms = Date.UTC(year, month - 1, day);
  if (new Date(ms).toISOString().slice(0, 10) !== text) return null;
  return { day: text, at: at ?? ms + 12 * 3_600_000 };
}

/**
 * A date as X's exports write it, as a day (`YYYY-MM-DD`) and a moment (epoch ms; noon UTC when the cell has no time):
 * `Sat, Mar 14, 2020` (the current exports), `2020-03-14 09:26 +0000` (the older one), ISO 8601, `Mar 14, 2020`, and
 * `3/14/2020` (a first number above 12 is the day). Null when it is none of these, or not a real date.
 */
export function toDay(cell: string): { day: string; at: number } | null {
  const text = cell.trim();
  let m = /^(?:[A-Za-z]{3},?\s+)?([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  if (m) {
    const month = MONTHS.indexOf((m[1] ?? '').toLowerCase()) + 1;
    return month ? dayFrom(Number(m[3]), month, Number(m[2])) : null;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/.exec(text);
  if (m) {
    const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (m[4] === undefined) return dayFrom(year, month, day);
    const zone = m[7] ?? 'Z';
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}${zone === 'Z' ? 'Z' : `${zone.slice(0, 3)}:${zone.slice(-2)}`}`;
    const at = Date.parse(iso);
    if (!Number.isFinite(at)) return null;
    const utc = new Date(at).toISOString().slice(0, 10);
    return dayFrom(...(utc.split('-').map(Number) as [number, number, number]), at);
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (m) {
    const [a, b, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return a > 12 ? dayFrom(year, b, a) : dayFrom(year, a, b);
  }
  return null;
}

/** A post's id from an X link to it (`…/status/<id>`), or null. */
const idFromLink = (link: string) => /\/status(?:es)?\/(\d{1,20})(?:[/?#]|$)/.exec(link.trim())?.[1] ?? null;

/** A row X's file has that Xomoni couldn't read, and why: `bad-id`, `no-date`, `future-day`, `bad-number:<field>`. */
export interface SkippedRow {
  line: number;
  reason: string;
}

/** A post's analytics read from one row, before the vault keeps it; `text` is cut to `ANALYTICS_TEXT`. */
export type AnalyticsPostDraft = Omit<AnalyticsPost, 'key'>;

/** X's analytics export, read: which kind, its rows, what was skipped or unknown, and the days it covers. */
export interface AnalyticsReport {
  kind: 'posts' | 'days';
  posts: AnalyticsPostDraft[];
  days: AnalyticsDay[];
  /** Columns Xomoni doesn't know, by their name in the file. */
  unknownColumns: string[];
  skipped: SkippedRow[];
  /** The first and last moment the rows cover (epoch ms), or null when no row was read. */
  cover: { from: number; to: number } | null;
  /** Rows left unread past `MAX_CSV_ROWS`. */
  truncated: boolean;
}

/** The numbers of one row, read by `fields`, or the field whose number is bad. */
function numbersOf<K extends string>(
  cells: readonly string[],
  fields: readonly (AnalyticsField | null)[],
  allowed: ReadonlySet<string>,
): Partial<Record<K, number>> | { bad: string } {
  const out: Partial<Record<K, number>> = {};
  for (const [i, field] of fields.entries()) {
    if (!field || !allowed.has(field)) continue;
    const n = toNumber(cells[i] ?? '');
    if (n === 'bad') return { bad: field };
    if (n !== null) out[field as K] = n;
  }
  return out;
}

/**
 * The analytics of posts in `table`, for `accountId`, as of `now`. A row is skipped when its post has no X id (from its
 * id or its link), no date (from the row, or its id), a date in the future, or a number that isn't a count.
 */
export function analyticsPostRows(
  table: CsvTable,
  accountId: string,
  now: number,
): { rows: AnalyticsPostDraft[]; skipped: SkippedRow[] } {
  const { fields } = mapHeaders(table.headers);
  const col = (f: AnalyticsField) => fields.indexOf(f);
  const rows: AnalyticsPostDraft[] = [];
  const skipped: SkippedRow[] = [];
  for (const { line, cells } of table.rows) {
    const id =
      (col('postId') >= 0 ? (cells[col('postId')] ?? '').trim() : '') || idFromLink(cells[col('postLink')] ?? '');
    if (!id || !isXId(id)) {
      skipped.push({ line, reason: 'bad-id' });
      continue;
    }
    const dated = col('date') >= 0 ? toDay(cells[col('date')] ?? '') : null;
    const createdAt = dated?.at ?? snowflakeTime(id);
    if (createdAt === null) {
      skipped.push({ line, reason: 'no-date' });
      continue;
    }
    if (createdAt > now + 86_400_000) {
      skipped.push({ line, reason: 'future-day' });
      continue;
    }
    const numbers = numbersOf<PostMetric>(cells, fields, POST_SET);
    if ('bad' in numbers) {
      skipped.push({ line, reason: `bad-number:${numbers.bad}` });
      continue;
    }
    const text = col('text') >= 0 ? (cells[col('text')] ?? '').slice(0, ANALYTICS_TEXT) : '';
    rows.push({ accountId, postId: id, createdAt, asOf: now, ...numbers, ...(text && { text }) });
  }
  return { rows, skipped };
}

/** The analytics of days in `table`, for `accountId`, as of `now`; a row without a real past day, or with a bad count, is skipped. */
export function analyticsDayRows(
  table: CsvTable,
  accountId: string,
  now: number,
): { rows: AnalyticsDay[]; skipped: SkippedRow[] } {
  const { fields } = mapHeaders(table.headers);
  const dateAt = fields.indexOf('date');
  const rows: AnalyticsDay[] = [];
  const skipped: SkippedRow[] = [];
  for (const { line, cells } of table.rows) {
    const dated = toDay(cells[dateAt] ?? '');
    if (!dated) {
      skipped.push({ line, reason: 'no-date' });
      continue;
    }
    if (!isVaultDay(dated.day, now)) {
      skipped.push({ line, reason: 'future-day' });
      continue;
    }
    const numbers = numbersOf<DayMetric>(cells, fields, DAY_SET);
    if ('bad' in numbers) {
      skipped.push({ line, reason: `bad-number:${numbers.bad}` });
      continue;
    }
    rows.push({ accountId, day: dated.day, asOf: now, ...numbers });
  }
  return { rows, skipped };
}

/**
 * Reads the text of an analytics export for `accountId`, as of `now`: which kind it is, its rows, the columns Xomoni
 * doesn't know and the rows it skipped. Null when it isn't X's analytics at all: neither kind of header, or not one row
 * that reads. Unreadable records (a quote that never closes) are skipped rows too.
 */
export function parseReport(text: string, accountId: string, now: number): AnalyticsReport | null {
  const table = parseCsv(text);
  const { kind } = classifyAnalyticsCsv(table.headers);
  if (!kind) return null;
  const read = kind === 'posts' ? analyticsPostRows(table, accountId, now) : analyticsDayRows(table, accountId, now);
  const skipped = [...table.problems.map((p) => ({ line: p.line, reason: p.problem })), ...read.skipped].sort(
    (a, b) => a.line - b.line,
  );
  if (!read.rows.length) return null;
  const moments =
    kind === 'posts'
      ? (read.rows as AnalyticsPostDraft[]).map((r) => r.createdAt)
      : (read.rows as AnalyticsDay[]).map((r) => Date.parse(`${r.day}T00:00:00Z`));
  let [from, to] = [Infinity, -Infinity];
  for (const at of moments) [from, to] = [Math.min(from, at), Math.max(to, at)];
  return {
    kind,
    posts: kind === 'posts' ? (read.rows as AnalyticsPostDraft[]) : [],
    days: kind === 'days' ? (read.rows as AnalyticsDay[]) : [],
    unknownColumns: mapHeaders(table.headers).unknown,
    skipped,
    cover: { from, to },
    truncated: table.truncated,
  };
}
