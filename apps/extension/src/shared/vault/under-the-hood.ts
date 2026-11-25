// X's monthly *Under the hood* report (#428, ADR-0045): the labels X applied to the person's posts and account in one
// month, and how many posts each touched. X doesn't say which posts. The person downloads it as JSON from
// x.com/i/under_the_hood and drops it on the Vault page. X hasn't documented its shape, which has already changed once
// (a web view came on 27 September 2026), so it is read by what it holds rather than by one fixed layout: a month, arrays
// of objects with a label's name and a count, and a few known extras. A field Xomoni doesn't know is only named in
// `unknownFields`, never kept. Pure, without IndexedDB.
import { isHandle, isXId } from '../ids';
import { asArray, asNumber, asObject, asString, type JsonObject } from '../json';

/** The largest *Under the hood* file Xomoni reads: 5 MB. X's own is a few kilobytes. */
export const UNDER_THE_HOOD_MAX_BYTES = 5 * 1024 * 1024;

/** X's page where the person can see and download the report. Opened in a normal tab, by the person only. */
export const UNDER_THE_HOOD_PAGE = 'https://x.com/i/under_the_hood';

/** X gives the report only to accounts with at least this many posts in the month before (and a year old or more). */
export const UNDER_THE_HOOD_MIN_POSTS = 10;

/** The longest label name kept; X's are short words in capitals, such as `SPAM_HIGH_RECALL`. */
export const LABEL_NAME_MAX = 100;

/** The longest text kept of X's own words about a label (`about`, `effect`) or of a country's name. */
export const LABEL_TEXT_MAX = 500;

/** The most unknown fields named in a result; the rest are only counted. */
const UNKNOWN_FIELDS_MAX = 50;

/** What a label was applied to: posts (X counts them), the account itself, or X didn't say. */
export type LabelScope = 'posts' | 'account' | 'unknown';

/** One label of one month, as X's file names it. */
export interface MonthLabel {
  /** X's own name, kept as text: control characters removed, trimmed, at most `LABEL_NAME_MAX`. */
  name: string;
  /** Posts it touched that month; 1 for a label on the account that comes without a count. */
  count: number;
  scope: LabelScope;
  /** X's own words in the file: what the label is (`about`) and what it does (`effect`); text, at most 500 each. */
  about?: string;
  effect?: string;
}

/** Orders from a government about the account's posts, by country, when X's file lists them. */
export interface GovernmentOrder {
  country: string;
  count: number;
}

/** One month of X's *Under the hood* report, as read from its file. */
export interface LabelMonth {
  /** The month the report covers, `yyyy-mm`, from its period's start (X's periods are in UTC). */
  month: string;
  /** Every label X listed, most posts first; empty for a month without labels, which is never "clean". */
  labels: MonthLabel[];
  /** The account's posts that month, as X counted them; missing when the file doesn't say. */
  postsInMonth?: number;
  /** False when X's file says the account wasn't eligible for the report that month; missing when it doesn't say. */
  eligible?: boolean;
  governmentOrders?: GovernmentOrder[];
  /** When X made the file (epoch ms); missing when it doesn't say. */
  generatedAt?: number;
}

/** Why a file isn't read as an *Under the hood* report. */
export type UnderTheHoodProblem = 'too-large' | 'not-json' | 'not-under-the-hood' | 'bad-month' | 'bad-count';

/** What the person is told for each `UnderTheHoodProblem`. */
export const UNDER_THE_HOOD_PROBLEMS: Readonly<Record<UnderTheHoodProblem, string>> = {
  'too-large': "This file is larger than X's Under the hood file can be (5 MB). Nothing was imported.",
  'not-json': "This isn't X's Under the hood file: it isn't JSON. Nothing was imported.",
  'not-under-the-hood': "This isn't X's Under the hood file. Nothing was imported.",
  'bad-month': "This Under the hood file names a month that can't be right. Nothing was imported.",
  'bad-count': "This Under the hood file has a count that isn't a whole number of 0 or more. Nothing was imported.",
};

/** Whose report a file is, when it says: X's numeric id, a handle, or both. */
export interface UnderTheHoodOwner {
  accountId?: string;
  handle?: string;
}

/** What reading a file gives: the month, or the problem and what to tell the person. */
export type UnderTheHoodResult =
  | {
      ok: true;
      month: LabelMonth;
      /** Whose report it is, when the file says; null when it doesn't, and the person confirms the account. */
      owner: UnderTheHoodOwner | null;
      /** The fields Xomoni doesn't know, by name (`postLabels[].severity`), at most 50; their values aren't kept. */
      unknownFields: string[];
      /** Entries left out: a label without a name, or a post label without a count. */
      skipped: number;
    }
  | { ok: false; problem: UnderTheHoodProblem; message: string };

/** Objects some versions of the file wrap the report in. */
const WRAPPERS = ['data', 'report', 'underTheHood', 'under_the_hood'] as const;

/** Arrays of labels, and what they were applied to. */
const LABEL_LISTS: Readonly<Record<string, LabelScope>> = {
  postLabels: 'posts',
  post_labels: 'posts',
  accountLabels: 'account',
  account_labels: 'account',
  labels: 'unknown',
};

/** Arrays of government orders. */
const ORDER_LISTS = ['governmentOrders', 'government_orders', 'legalDemands', 'legal_demands'];

const MONTH_KEYS = ['month', 'reportMonth', 'report_month'];
const PERIOD_KEYS = ['period', 'reportPeriod', 'report_period'];
const PERIOD_START_KEYS = ['startDate', 'start_date', 'start', 'from'];
const POST_COUNT_KEYS = ['postCount', 'post_count', 'postsInMonth', 'posts_in_month', 'totalPosts', 'total_posts'];
const ELIGIBLE_KEYS = ['eligible', 'isEligible', 'is_eligible'];
const GENERATED_KEYS = ['generatedAt', 'generated_at'];
const OWNER_ID_KEYS = ['accountId', 'account_id', 'userId', 'user_id'];
const OWNER_HANDLE_KEYS = ['screenName', 'screen_name', 'handle', 'username'];

/** Root fields Xomoni knows and doesn't keep: X's notes, its account-label total, a status and the reason for it. */
const KNOWN_IGNORED = ['notes', 'totalAccountLabels', 'total_account_labels', 'status', 'reason', 'message'];

const NAME_KEYS = ['label', 'name', 'labelName', 'label_name'];
const COUNT_KEYS = ['posts', 'count', 'postCount', 'post_count', 'numPosts', 'num_posts'];
const ABOUT_KEYS = ['about', 'description'];
const EFFECT_KEYS = ['effect', 'impact'];
const SCOPE_KEYS = ['scope', 'level', 'appliesTo', 'applies_to'];
const MONTH_TOTAL_KEYS = ['totalPostsInMonth', 'total_posts_in_month'];
/** Label fields Xomoni knows and doesn't keep: X's own percentage, which `count` and `postsInMonth` give again. */
const LABEL_IGNORED = ['percentageOfPosts', 'percentage_of_posts', 'percentage'];

const COUNTRY_KEYS = ['country', 'countryCode', 'country_code'];
const ORDER_COUNT_KEYS = ['count', 'orders', 'posts'];

/** Thrown inside the reader for a value that can't be right; never leaves this file. */
class Refused extends Error {
  constructor(readonly problem: UnderTheHoodProblem) {
    super(problem);
  }
}

/** The first of `keys` that `obj` has, with its value; undefined when none. */
function pick(obj: JsonObject, keys: readonly string[], used: Set<string>): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined) {
      used.add(key);
      return obj[key];
    }
  }
  return undefined;
}

/** Whether a character is a control character, or an invisible mark that reorders or hides text (`U+202E`, …). */
function hidden(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/**
 * `value` as text to keep: control characters and the invisible marks that reorder or hide text removed, trimmed, at
 * most `max`; undefined when nothing is left.
 */
function cleanText(value: unknown, max: number): string | undefined {
  const raw = asString(value);
  if (raw === undefined) return undefined;
  let kept = '';
  for (const char of raw) if (!hidden(char.codePointAt(0) ?? 0)) kept += char;
  const text = kept.trim();
  return text ? text.slice(0, max) : undefined;
}

/** A count: a whole number of 0 or more, as a number or as digits (X writes `"383"`). Anything else is refused. */
function count(value: unknown): number {
  const n = asNumber(value);
  if (n === undefined || !Number.isSafeInteger(n) || n < 0) throw new Refused('bad-count');
  return n;
}

/** The report object inside `json`: the root, or one or two of `WRAPPERS` down; undefined when it isn't an object. */
function reportOf(json: unknown): JsonObject | undefined {
  let obj = asObject(json);
  for (let depth = 0; depth < 2 && obj; depth++) {
    const inner = WRAPPERS.map((key) => asObject(obj?.[key])).find((o) => o !== undefined);
    if (!inner || looksLikeReport(obj)) break;
    obj = inner;
  }
  return obj;
}

/** Whether `obj` has a month or a period, and something only a report has: a label list, a post count or eligibility. */
function looksLikeReport(obj: JsonObject): boolean {
  const dated = [...MONTH_KEYS, ...PERIOD_KEYS].some((key) => obj[key] !== undefined);
  const lists = Object.keys(LABEL_LISTS).some((key) => Array.isArray(obj[key]));
  const facts = [...POST_COUNT_KEYS, ...ELIGIBLE_KEYS].some((key) => obj[key] !== undefined);
  return dated && (lists || facts);
}

/**
 * Whether `json` looks like X's *Under the hood* report: a month or a period, with a list of labels, a post count or
 * whether the account was eligible, at the root or inside `data` or `report`. Says nothing about whether it is valid;
 * `parseUnderTheHood` checks that.
 */
export function detectUnderTheHood(json: unknown): boolean {
  const report = reportOf(json);
  return report !== undefined && looksLikeReport(report);
}

const MONTH = /^(\d{4})-(\d{2})(?:-(\d{2})(?:[T ].*)?)?$/;

/** `yyyy-mm` from a `yyyy-mm` or `yyyy-mm-dd` date, between 2006 and the month of `now`; else refused. */
function monthOf(value: unknown, now: number): string {
  const match = MONTH.exec(asString(value)?.trim() ?? '');
  if (!match) throw new Refused('bad-month');
  const [year, month] = [Number(match[1]), Number(match[2])];
  const latest = new Date(now);
  const tooLate = year * 12 + month > latest.getUTCFullYear() * 12 + latest.getUTCMonth() + 1;
  if (year < 2006 || month < 1 || month > 12 || tooLate) throw new Refused('bad-month');
  return `${match[1]}-${match[2]}`;
}

/** What a label list's entries were applied to, from the list's key, or from the entry's own `scope` when it says. */
function scopeOf(list: LabelScope, entry: JsonObject, used: Set<string>): LabelScope {
  if (list !== 'unknown') return list;
  const said = asString(pick(entry, SCOPE_KEYS, used))?.toLowerCase() ?? '';
  if (/post|tweet/.test(said)) return 'posts';
  if (/account|user|profile/.test(said)) return 'account';
  return 'unknown';
}

/** Collects the names of fields Xomoni doesn't know, at most `UNKNOWN_FIELDS_MAX`. */
class Unknown {
  readonly names = new Set<string>();
  add(obj: JsonObject, used: ReadonlySet<string>, prefix: string) {
    for (const key of Object.keys(obj)) {
      if (used.has(key) || this.names.size >= UNKNOWN_FIELDS_MAX) continue;
      this.names.add(`${prefix}${cleanText(key, LABEL_NAME_MAX) ?? '?'}`);
    }
  }
}

/**
 * Reads X's *Under the hood* report from its parsed JSON, at `now` (a month after it is refused).
 *
 * - **The month** comes from `period.startDate` (or a `month` field), as `yyyy-mm`.
 * - **Labels** come from `postLabels` (posts), `accountLabels` (the account) and `labels` (each entry's own `scope`):
 *   each entry's `label` or `name`, its `posts` or `count`, and X's `about` and `effect`. A label without a name, or a
 *   post label without a count, is skipped; an account label without a count counts once. The same label twice in a
 *   month is added up.
 * - **A count** that isn't a whole number of 0 or more refuses the whole file: X's own never has one.
 * - **Text** is kept as text, never markup, cut to its maximum.
 */
export function parseUnderTheHood(json: unknown, now: number): UnderTheHoodResult {
  const report = reportOf(json);
  if (!report || !looksLikeReport(report)) return refuse('not-under-the-hood');
  try {
    return read(report, now);
  } catch (error) {
    if (error instanceof Refused) return refuse(error.problem);
    throw error;
  }
}

function refuse(problem: UnderTheHoodProblem): UnderTheHoodResult {
  return { ok: false, problem, message: UNDER_THE_HOOD_PROBLEMS[problem] };
}

function read(report: JsonObject, now: number): UnderTheHoodResult {
  const used = new Set<string>(KNOWN_IGNORED);
  const unknown = new Unknown();
  const period = asObject(pick(report, PERIOD_KEYS, used));
  const periodUsed = new Set<string>(['endDate', 'end_date', 'end', 'to', 'timezone', 'time_zone']);
  const start = period ? pick(period, PERIOD_START_KEYS, periodUsed) : undefined;
  const month = monthOf(start ?? pick(report, MONTH_KEYS, used), now);
  if (period) unknown.add(period, periodUsed, 'period.');

  const labels = new Map<string, MonthLabel>();
  let skipped = 0;
  let monthTotal: number | undefined;
  for (const [key, listScope] of Object.entries(LABEL_LISTS)) {
    if (!Array.isArray(report[key])) continue;
    used.add(key);
    for (const value of asArray(report[key])) {
      const entry = asObject(value);
      if (!entry) {
        skipped++;
        continue;
      }
      const entryUsed = new Set<string>(LABEL_IGNORED);
      const name = cleanText(pick(entry, NAME_KEYS, entryUsed), LABEL_NAME_MAX);
      const scope = scopeOf(listScope, entry, entryUsed);
      const rawCount = pick(entry, COUNT_KEYS, entryUsed);
      const total = pick(entry, MONTH_TOTAL_KEYS, entryUsed);
      if (total !== undefined) monthTotal ??= count(total);
      const about = cleanText(pick(entry, ABOUT_KEYS, entryUsed), LABEL_TEXT_MAX);
      const effect = cleanText(pick(entry, EFFECT_KEYS, entryUsed), LABEL_TEXT_MAX);
      unknown.add(entry, entryUsed, `${key}[].`);
      if (!name || (rawCount === undefined && scope !== 'account')) {
        skipped++;
        continue;
      }
      const n = rawCount === undefined ? 1 : count(rawCount);
      const id = `${scope}:${name}`;
      const seen = labels.get(id);
      if (seen) seen.count += n;
      else labels.set(id, { name, count: n, scope, ...(about && { about }), ...(effect && { effect }) });
    }
  }

  const orders: GovernmentOrder[] = [];
  for (const key of ORDER_LISTS) {
    if (!Array.isArray(report[key])) continue;
    used.add(key);
    for (const value of asArray(report[key])) {
      const entry = asObject(value);
      const entryUsed = new Set<string>();
      const country = entry && cleanText(pick(entry, COUNTRY_KEYS, entryUsed), LABEL_TEXT_MAX);
      const n = entry && pick(entry, ORDER_COUNT_KEYS, entryUsed);
      if (!entry || !country || n === undefined) {
        skipped++;
        continue;
      }
      orders.push({ country, count: count(n) });
      unknown.add(entry, entryUsed, `${key}[].`);
    }
  }

  const posts = pick(report, POST_COUNT_KEYS, used);
  const postsInMonth = posts === undefined ? monthTotal : count(posts);
  const eligible = eligibility(report, used);
  const generated = Date.parse(asString(pick(report, GENERATED_KEYS, used)) ?? '');
  const owner = ownerOf(report, used);
  unknown.add(report, used, '');

  const result: LabelMonth = {
    month,
    labels: [...labels.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    ...(postsInMonth !== undefined && { postsInMonth }),
    ...(eligible !== undefined && { eligible }),
    ...(orders.length > 0 && { governmentOrders: orders }),
    ...(Number.isFinite(generated) && { generatedAt: generated }),
  };
  return { ok: true, month: result, owner, unknownFields: [...unknown.names], skipped };
}

/** Whether the file says the account was eligible: a boolean field, or a status such as `NOT_ELIGIBLE`. */
function eligibility(report: JsonObject, used: Set<string>): boolean | undefined {
  const flag = pick(report, ELIGIBLE_KEYS, used);
  if (typeof flag === 'boolean') return flag;
  if (/not[\s_-]?eligible|ineligible/i.test(asString(report.status) ?? '')) return false;
  return undefined;
}

/** Whose report it is, from an X id or a handle in the file; null when it names neither. */
function ownerOf(report: JsonObject, used: Set<string>): UnderTheHoodOwner | null {
  const rawId = pick(report, OWNER_ID_KEYS, used);
  const id = typeof rawId === 'number' && Number.isSafeInteger(rawId) ? String(rawId) : asString(rawId);
  const handle = asString(pick(report, OWNER_HANDLE_KEYS, used))?.replace(/^@/, '');
  const owner: UnderTheHoodOwner = {
    ...(id && isXId(id) && { accountId: id }),
    ...(handle && isHandle(handle) && { handle }),
  };
  return owner.accountId || owner.handle ? owner : null;
}

/**
 * Reads an *Under the hood* file's text: refused when it is larger than `UNDER_THE_HOOD_MAX_BYTES` or isn't JSON, else
 * as `parseUnderTheHood`.
 */
export function parseUnderTheHoodText(text: string, now: number): UnderTheHoodResult {
  if (text.length > UNDER_THE_HOOD_MAX_BYTES || new TextEncoder().encode(text).length > UNDER_THE_HOOD_MAX_BYTES)
    return refuse('too-large');
  let json: unknown;
  try {
    json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return refuse('not-json');
  }
  return parseUnderTheHood(json, now);
}

/** A label that is new in a month, or touched more posts than the month before. */
export interface LabelChange {
  name: string;
  scope: LabelScope;
  /** Its count this month. */
  count: number;
  /** Its count the month before; 0 when it wasn't listed, or the month before isn't known. */
  before: number;
}

/**
 * The labels of `after` that are new or went up since `before`, the month before it (or undefined when that month
 * isn't known, so every label counts as new). A label that went down, or stayed, isn't a change.
 */
export function labelChanges(before: LabelMonth | undefined, after: LabelMonth): LabelChange[] {
  const earlier = new Map((before?.labels ?? []).map((l) => [`${l.scope}:${l.name}`, l.count]));
  return after.labels.flatMap((label) => {
    const was = earlier.get(`${label.scope}:${label.name}`) ?? 0;
    return label.count > was ? [{ name: label.name, scope: label.scope, count: label.count, before: was }] : [];
  });
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** A `yyyy-mm` month in words, such as "July 2026"; the text as it is when it isn't one. */
export function monthName(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const name = match ? MONTH_NAMES[Number(match[2]) - 1] : undefined;
  return match && name ? `${name} ${match[1]}` : month;
}

/**
 * The words of the account timeline's event for a label change (`x_label`): "X applied SPAM_HIGH_RECALL to 2 posts in
 * July 2026". Only X's label name and Xomoni's words; never a verdict (ADR-0045, point 3).
 */
export function labelEventWords(change: LabelChange, month: string): string {
  const when = monthName(month);
  if (change.scope === 'posts')
    return `X applied ${change.name} to ${change.count} ${change.count === 1 ? 'post' : 'posts'} in ${when}`;
  if (change.scope === 'account') return `X applied ${change.name} to the account in ${when}`;
  return `X listed ${change.name} (${change.count}) in ${when}`;
}

/** The `yyyy-mm` month, in UTC, that `ms` falls in. */
export function utcMonth(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The `yyyy-mm` month before `month`. */
export function previousMonth(month: string): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${year - 1}-12` : `${year}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * The latest month X's report should cover at `now`: from the 3rd of a month (UTC), the month before; until then, the
 * one before that. X made July 2026's on 8 August, so a reminder from the 3rd is early rather than late.
 */
export function expectedUnderTheHoodMonth(now: number): string {
  const last = previousMonth(utcMonth(now));
  return new Date(now).getUTCDate() >= 3 ? last : previousMonth(last);
}
