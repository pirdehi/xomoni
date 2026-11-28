// X's *Under the hood* months in the vault (#428, ADR-0043, ADR-0045): the `labelMonths` table's rows and their check,
// how a month is kept, with the timeline's events for a new or larger label, and how a move merges them. One row per
// account and month; a newer file for a month replaces the older one. Nothing here leaves the computer.
import { isXId } from '../ids';
import { asArray, asObject } from '../json';
import { db } from '../db';
import { type MergeResult, addAccountEvent } from './db';
import { FUTURE_SLACK_MS } from './records';
import {
  LABEL_NAME_MAX,
  LABEL_TEXT_MAX,
  type LabelChange,
  type LabelMonth,
  type LabelMonthRow,
  type LabelScope,
  type MonthLabel,
  labelChanges,
  labelEventWords,
  previousMonth,
} from './under-the-hood';

/** The most labels a month keeps; X lists a handful. */
export const MAX_MONTH_LABELS = 200;

/** The most government orders a month keeps. */
export const MAX_MONTH_ORDERS = 200;

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const SCOPES: ReadonlySet<string> = new Set<LabelScope>(['posts', 'account', 'unknown']);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

/** Thrown inside a check: the row is out of shape. Never leaves this file. */
class Bad extends Error {}
function bad(): never {
  throw new Bad();
}

/** A month's label, checked and copied. */
function label(value: unknown): MonthLabel {
  const l = asObject(value) ?? bad();
  if (!isText(l.name, LABEL_NAME_MAX) || !isCount(l.count) || typeof l.scope !== 'string' || !SCOPES.has(l.scope))
    bad();
  const out: MonthLabel = { name: l.name, count: l.count, scope: l.scope as LabelScope };
  for (const field of ['about', 'effect'] as const) {
    const text = l[field];
    if (text === undefined) continue;
    if (!isText(text, LABEL_TEXT_MAX)) bad();
    out[field] = text;
  }
  return out;
}

/**
 * A `labelMonths` row checked and copied field by field (the importer's writes and the move file, ADR-0032): an X id, a
 * real month not after `now`'s, at most `MAX_MONTH_LABELS` labels of known scopes with texts of their size, whole counts
 * of 0 or more, and times not ahead of `now`. Null when anything is out of shape.
 */
export function labelMonthRecord(value: unknown, now: number): LabelMonthRow | null {
  const r = asObject(value);
  if (!r) return null;
  try {
    const { accountId, month, importedAt, postsInMonth, eligible, generatedAt } = r;
    if (typeof accountId !== 'string' || !isXId(accountId)) bad();
    const m = typeof month === 'string' ? MONTH.exec(month) : null;
    if (!m) bad();
    const latest = new Date(now + FUTURE_SLACK_MS);
    if (Number(m[1]) * 12 + Number(m[2]) > latest.getUTCFullYear() * 12 + latest.getUTCMonth() + 1) bad();
    if (Number(m[1]) < 2006) bad();
    const isTime = (v: unknown): v is number =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= now + FUTURE_SLACK_MS;
    if (!isTime(importedAt)) bad();
    const labels = asArray(r.labels);
    if (!Array.isArray(r.labels) || labels.length > MAX_MONTH_LABELS) bad();
    const row: LabelMonthRow = { accountId, month: m[0], importedAt, labels: labels.map(label) };
    if (postsInMonth !== undefined) row.postsInMonth = isCount(postsInMonth) ? postsInMonth : bad();
    if (eligible !== undefined) row.eligible = typeof eligible === 'boolean' ? eligible : bad();
    if (generatedAt !== undefined) row.generatedAt = isTime(generatedAt) ? generatedAt : bad();
    if (r.governmentOrders !== undefined) {
      const orders = asArray(r.governmentOrders);
      if (!Array.isArray(r.governmentOrders) || orders.length > MAX_MONTH_ORDERS) bad();
      row.governmentOrders = orders.map((value) => {
        const o = asObject(value) ?? bad();
        if (!isText(o.country, LABEL_TEXT_MAX) || !isCount(o.count)) bad();
        return { country: o.country, count: o.count };
      });
    }
    return row;
  } catch (err) {
    if (err instanceof Bad) return null;
    throw err;
  }
}

/**
 * The account's months of labels, newest first, each checked again (`labelMonthRecord`): a row damaged on the computer
 * is left out rather than breaking the page.
 */
export async function labelMonths(accountId: string, now = Date.now()): Promise<LabelMonthRow[]> {
  const rows = await db.labelMonths.where('accountId').equals(accountId).toArray();
  return rows
    .flatMap((row) => {
      const checked = labelMonthRecord(row, now);
      return checked ? [checked] : [];
    })
    .sort((a, b) => b.month.localeCompare(a.month));
}

/** The ref of a label change on the timeline: one event per month, scope and label, ever. */
const changeRef = (month: string, change: LabelChange) =>
  `${month}:${change.scope}:${change.name.replace(/[^A-Za-z0-9._@-]/g, '_')}`.slice(0, 200);

/**
 * Keeps `month` for `accountId`, in place of any earlier file's for that month, and puts each label that is new or
 * larger than the month before on the account's timeline (`x_label`, in Xomoni's words, `labelEventWords`). Answers the
 * changes. A row out of shape writes nothing and throws.
 */
export async function saveLabelMonth(
  accountId: string,
  month: LabelMonth,
  importedAt: number,
  now = Date.now(),
): Promise<LabelChange[]> {
  const row = labelMonthRecord({ ...month, accountId, importedAt }, now);
  if (!row) throw new Error('This Under the hood month is out of shape. Nothing was written.');
  const changes = await db.transaction('rw', db.labelMonths, async () => {
    const before = await db.labelMonths.get([accountId, previousMonth(row.month)]);
    await db.labelMonths.put(row);
    return labelChanges(before, row);
  });
  const [year, m] = row.month.split('-').map(Number) as [number, number];
  const at = Math.min(Date.UTC(year, m, 1) - 1, now);
  for (const change of changes) {
    await addAccountEvent(
      {
        accountId,
        kind: 'x_label',
        at,
        source: 'under-the-hood',
        words: labelEventWords(change, row.month),
        ref: changeRef(row.month, change),
      },
      now,
    );
  }
  return changes;
}

/**
 * Two copies of the account's months as one (a move, ADR-0032): for each month, the later import's row. Answers the rows
 * added and the rows here it replaced.
 */
export async function mergeLabelMonths(rows: readonly LabelMonthRow[]): Promise<MergeResult> {
  return db.transaction('rw', db.labelMonths, async () => {
    const result: MergeResult = { added: 0, updated: 0 };
    for (const row of rows) {
      const here = await db.labelMonths.get([row.accountId, row.month]);
      if (here && here.importedAt >= row.importedAt) continue;
      await db.labelMonths.put(row);
      if (here) result.updated++;
      else result.added++;
    }
    return result;
  });
}

/** Every account's months, or one account's: what a move writes. */
export function readLabelMonths(accountId?: string): Promise<LabelMonthRow[]> {
  return accountId === undefined
    ? db.labelMonths.toArray()
    : db.labelMonths.where('accountId').equals(accountId).toArray();
}
