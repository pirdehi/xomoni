// X's analytics export on the vault's importer (#425, ADR-0043): one parser for the CSV of days (`x-analytics-days`)
// and one for the CSV of posts (`x-analytics-posts`), registered in that order, so a CSV of days goes to the first and
// every other CSV to the second, which refuses one that isn't X's analytics. Each CSV is a part of its own. A file over
// 50 MB is refused before it is read. Whose file it is (decision 5): a posts CSV is the account's when at least half of
// its posts are the account's own in the inventory, and the person confirms it when the inventory has none; a days CSV
// has no ids, so the person confirms it once, and the answer is kept for that file.
import { db, itemKey } from '../db';
import type { ItemKind } from '../types';
import { classifyAnalyticsCsv, parseReport, type AnalyticsReport } from './analytics-csv';
import { parseCsv } from './csv';
import { isConfirmed, mergeAnalyticsDays, mergeAnalyticsPosts } from './db';
import { type OwnerVerdict, type VaultBatch, type VaultFile, type VaultParser, registerParser } from './importer';

/** The largest analytics CSV Xomoni reads: 50 MB, far above X's export of a heavy account (ADR-0043, decision 3). */
export const MAX_ANALYTICS_BYTES = 50 * 1024 * 1024;

/** Rows merged at a time, each batch in a transaction of its own. */
export const ANALYTICS_CHUNK = 2_000;

/** How much of a CSV is read to know its kind: its header line is far shorter. */
const HEAD_BYTES = 16 * 1024;

/** What the person reads for a CSV that isn't X's analytics export. */
export const NOT_ANALYTICS = 'This isn’t an X analytics export. Nothing was imported.';

/** A CSV by its name. */
const isCsv = (file: VaultFile) => file.name.toLowerCase().endsWith('.csv');

const megabytes = (bytes: number) => `${Math.ceil(bytes / (1024 * 1024)).toLocaleString()} MB`;

/** The kind of a CSV within the limit, by its header; read once per file. */
const kinds = new WeakMap<VaultFile, 'posts' | 'days' | null>();

async function kindOf(file: VaultFile): Promise<'posts' | 'days' | null> {
  const known = kinds.get(file);
  if (known !== undefined) return known;
  const head = await file.head(HEAD_BYTES);
  const kind = classifyAnalyticsCsv(parseCsv(head, { maxRows: 0 }).headers).kind;
  kinds.set(file, kind);
  return kind;
}

/** Each CSV's report, read once for the owner check and the import, for the account it was read for. */
const reports = new WeakMap<VaultFile, { accountId: string; now: number; report: AnalyticsReport | null }>();

async function reportOf(file: VaultFile, accountId: string, now: number): Promise<AnalyticsReport | null> {
  const kept = reports.get(file);
  if (kept?.accountId === accountId) return kept.report;
  const report = parseReport(await file.text(), accountId, now);
  reports.set(file, { accountId, now, report });
  return report;
}

/** The account's own posts, replies and reposts with these ids in the inventory. */
async function ownIds(accountId: string, ids: readonly string[]): Promise<Set<string>> {
  const own = new Set<string>();
  for (const kind of ['post', 'reply', 'repost'] as ItemKind[]) {
    const found = await db.items.bulkGet(ids.map((id) => itemKey(accountId, kind, id)));
    for (const item of found) if (item) own.add(item.id);
  }
  return own;
}

/** Whether the inventory holds any post, reply or repost of the account. */
async function hasOwnPosts(accountId: string): Promise<boolean> {
  for (const kind of ['post', 'reply', 'repost'] as ItemKind[]) {
    const one = await db.items
      .where('[accountId+kind+createdAt]')
      .between([accountId, kind, -Infinity], [accountId, kind, Infinity])
      .limit(1)
      .count();
    if (one) return true;
  }
  return false;
}

/** What both parsers share: one part per CSV, the 50 MB limit and its words. */
const CSV_PARSER = {
  onePerFile: true,
  /** 50 MB for every CSV. */
  maxBytes: () => MAX_ANALYTICS_BYTES,
  /** The words for a CSV over the limit. */
  tooBig: (file: VaultFile) =>
    `${file.name} is ${megabytes(file.size)}, larger than X's analytics export can be (50 MB). Nothing was imported.`,
} as const;

/** Notes in the ledger what the report left out: columns Xomoni doesn't know, and rows it skipped, by line. */
function noteProblems(report: AnalyticsReport, problem: (code: string) => void) {
  for (const column of report.unknownColumns) problem(`unknown-field:${column}`);
  for (const row of report.skipped) problem(`skipped-row:${String(row.line)}:${row.reason}`);
  if (report.truncated) problem('truncated');
}

/** X's analytics of days (`x-analytics-days`): the *Overview* CSV, one row per day; the newer import wins a day. */
export const ANALYTICS_DAYS_PARSER: VaultParser = {
  ...CSV_PARSER,
  source: 'x-analytics-days',
  label: 'X’s analytics of days',
  version: 1,
  async matches(files) {
    const mine: VaultFile[] = [];
    for (const file of files) {
      if (isCsv(file) && file.size <= MAX_ANALYTICS_BYTES && (await kindOf(file)) === 'days') mine.push(file);
    }
    return mine;
  },
  async owner(files, account, fingerprint): Promise<OwnerVerdict> {
    const [file] = files;
    if (!file || !(await reportOf(file, account.id, Date.now()))) return { ok: false, reason: NOT_ANALYTICS };
    if (await isConfirmed(account.id, fingerprint)) return { ok: true };
    return {
      ok: 'confirm',
      question: `This export of days has no post ids to show whose it is. Is it @${account.handle}’s?`,
    };
  },
  async *read(files, ctx): AsyncGenerator<VaultBatch> {
    for (const file of files) {
      const report = await reportOf(file, ctx.account.id, ctx.now);
      if (!report) continue;
      noteProblems(report, (code) => ctx.problem(code));
      if (report.cover) ctx.cover(report.cover.from, report.cover.to);
      ctx.count('days', report.days.length);
      for (let i = 0; i < report.days.length; i += ANALYTICS_CHUNK) {
        if (ctx.signal?.aborted) return;
        const rows = report.days.slice(i, i + ANALYTICS_CHUNK);
        yield {
          read: rows.length,
          skipped: i === 0 ? report.skipped.length : 0,
          write: async () => {
            await mergeAnalyticsDays(
              rows.map((row) => ({ ...row, asOf: ctx.now })),
              ctx.now,
            );
            ctx.progress(
              `Saving ${file.name}: ${Math.min(i + ANALYTICS_CHUNK, report.days.length).toLocaleString()} / ${report.days.length.toLocaleString()}`,
            );
            return rows.length;
          },
        };
      }
    }
  },
};

/**
 * X's analytics of posts (`x-analytics-posts`): the *Content* CSV, or the older *Tweet activity* one. It takes every
 * CSV the days' parser didn't, and refuses one that isn't X's analytics (`NOT_ANALYTICS`). A post's numbers are never
 * lowered; its text is kept, cut to 1,000 characters, only when the inventory doesn't hold the post.
 */
export const ANALYTICS_POSTS_PARSER: VaultParser = {
  ...CSV_PARSER,
  source: 'x-analytics-posts',
  label: 'X’s analytics of posts',
  version: 1,
  async matches(files) {
    const mine: VaultFile[] = [];
    // A CSV over the limit is taken unread, so it is refused for its size.
    for (const file of files) {
      if (isCsv(file) && (file.size > MAX_ANALYTICS_BYTES || (await kindOf(file)) !== 'days')) mine.push(file);
    }
    return mine;
  },
  async owner(files, account, fingerprint): Promise<OwnerVerdict> {
    const [file] = files;
    const report = file && (await reportOf(file, account.id, Date.now()));
    if (!report || report.kind !== 'posts') return { ok: false, reason: NOT_ANALYTICS };
    if (!(await hasOwnPosts(account.id))) {
      if (await isConfirmed(account.id, fingerprint)) return { ok: true };
      return {
        ok: 'confirm',
        question: `Xomoni has none of @${account.handle}’s posts yet to check this CSV against. Is it @${account.handle}’s analytics export?`,
      };
    }
    const ids = [...new Set(report.posts.map((p) => p.postId))];
    const own = await ownIds(account.id, ids);
    if (own.size * 2 >= ids.length) return { ok: true };
    return {
      ok: false,
      reason: `Fewer than half of the posts in this CSV are @${account.handle}’s in Xomoni’s copy: it looks like another account’s export. Nothing was imported.`,
    };
  },
  async *read(files, ctx): AsyncGenerator<VaultBatch> {
    for (const file of files) {
      const report = await reportOf(file, ctx.account.id, ctx.now);
      if (!report) continue;
      noteProblems(report, (code) => ctx.problem(code));
      if (report.cover) ctx.cover(report.cover.from, report.cover.to);
      ctx.count('posts', report.posts.length);
      for (let i = 0; i < report.posts.length; i += ANALYTICS_CHUNK) {
        if (ctx.signal?.aborted) return;
        const rows = report.posts.slice(i, i + ANALYTICS_CHUNK);
        yield {
          read: rows.length,
          skipped: i === 0 ? report.skipped.length : 0,
          write: async () => {
            // The inventory has the text of a post it holds: the vault keeps none of its own for it.
            const own = await ownIds(
              ctx.account.id,
              rows.map((r) => r.postId),
            );
            await mergeAnalyticsPosts(
              rows.map(({ text, ...row }) => ({
                ...row,
                asOf: ctx.now,
                ...(text !== undefined && !own.has(row.postId) && { text }),
              })),
              ctx.now,
            );
            ctx.progress(
              `Saving ${file.name}: ${Math.min(i + ANALYTICS_CHUNK, report.posts.length).toLocaleString()} / ${report.posts.length.toLocaleString()}`,
            );
            return rows.length;
          },
        };
      }
    }
  },
};

registerParser(ANALYTICS_DAYS_PARSER);
registerParser(ANALYTICS_POSTS_PARSER);
