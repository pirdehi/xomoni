// *Export my vault* (#426, ADR-0044): the vault as one ZIP a person keeps and reads without Xomoni. Each part is a CSV
// a spreadsheet can't run (`toCsvRow`) and a JSON for tools, beside `README.txt`, `schema.json`
// (`xomoni-vault-export@1`) and `index.html`, a page with every text escaped and no script, under `ARCHIVE_CSP`. A part
// that holds other people's words is left out unless the person asks for it. Everything is read here and written
// here; nothing is sent anywhere (ADR-0004).
import { ARCHIVE_CSP, escapeHtml } from '../backup';
import { db } from '../db';
import type { ItemKind } from '../types';
import { type ZipWriteEntry, writeZip } from '../zip-write';
import { CSV_BOM, toCsvRow } from './csv';
import { accountTimeline, importLedger } from './db';
import { DAY_METRICS, POST_METRICS } from './types';

/** The export's schema and its version: renaming or removing a column, or changing its meaning, makes a new one. */
export const EXPORT_SCHEMA = 'xomoni-vault-export@1';

/** A column's type, as `schema.json` names it. */
export type ColumnType = 'string' | 'integer' | 'datetime' | 'date';

/** One column of a part: its stable name, its type, and what it holds. */
export interface ExportColumn {
  name: string;
  type: ColumnType;
  description: string;
}

/** The dates a part is read for (epoch ms, inclusive); null on a side for all of time. */
export interface ExportRange {
  from: number | null;
  to: number | null;
}

/** One cell of a part's row: text, a whole number, or nothing. */
export type ExportCell = string | number | null;

/**
 * One part of the export: its id (the files' name), what the person reads, whether it holds other people's words (then
 * left out unless asked for, ADR-0044, decision 5), its columns, and how its rows are read for an account and a range.
 */
export interface ExportPart {
  id: string;
  label: string;
  others: boolean;
  columns: readonly ExportColumn[];
  rows(accountId: string, range: ExportRange): Promise<ExportCell[][]>;
}

const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : null);
const within = (at: number, range: ExportRange) =>
  (range.from === null || at >= range.from) && (range.to === null || at <= range.to);
/** Epoch ms of a `YYYY-MM-DD` day, for the range. */
const dayAt = (day: string) => Date.parse(`${day}T12:00:00Z`);
/** camelCase as the export's snake_case column names. */
const snake = (name: string) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** The account's items of `kinds` created within `range`, through the `[accountId+kind+createdAt]` index. */
async function itemsOf(accountId: string, kinds: readonly ItemKind[], range: ExportRange) {
  const lists = await Promise.all(
    kinds.map((kind) =>
      db.items
        .where('[accountId+kind+createdAt]')
        .between([accountId, kind, range.from ?? -Infinity], [accountId, kind, range.to ?? Infinity], true, true)
        .toArray(),
    ),
  );
  return lists.flat().sort((a, b) => a.createdAt - b.createdAt);
}

const postLink = (id: string, handle?: string) => `https://x.com/${handle || 'i/web'}/status/${id}`;

/**
 * The core's parts, in the export's order: the person's posts, replies and reposts; their likes; X's analytics of each
 * day and of each post; the account's timeline; the import ledger; and, only when asked for, the replies others wrote
 * to the person (ADR-0030). Features that add data to the vault add their part here, with its columns.
 */
export const EXPORT_PARTS: readonly ExportPart[] = [
  {
    id: 'posts',
    label: 'Your posts, replies and reposts',
    others: false,
    columns: [
      { name: 'id', type: 'string', description: 'The post’s id on X.' },
      { name: 'kind', type: 'string', description: 'post, reply or repost.' },
      { name: 'created_at', type: 'datetime', description: 'When it was posted.' },
      { name: 'text', type: 'string', description: 'Its text; for a repost, the text X shows with RT.' },
      { name: 'reply_to', type: 'string', description: 'For a reply, the handle it answers.' },
      { name: 'likes', type: 'integer', description: 'Likes, as last seen.' },
      { name: 'reposts', type: 'integer', description: 'Reposts, as last seen.' },
      { name: 'replies', type: 'integer', description: 'Replies, as last seen.' },
      { name: 'views', type: 'integer', description: 'Views, as last seen, when X showed them.' },
      { name: 'status', type: 'string', description: 'present, deleted (by Xomoni) or gone (no longer on X).' },
      { name: 'link', type: 'string', description: 'Where it is on x.com.' },
    ],
    async rows(accountId, range) {
      return (await itemsOf(accountId, ['post', 'reply', 'repost'], range)).map((i) => [
        i.id,
        i.kind,
        iso(i.createdAt),
        i.text,
        i.replyTo ?? null,
        i.likes,
        i.reposts,
        i.replies,
        i.views ?? null,
        i.status,
        postLink(i.id, i.kind === 'repost' ? i.author : undefined),
      ]);
    },
  },
  {
    id: 'likes',
    label: 'Your likes',
    others: false,
    columns: [
      { name: 'id', type: 'string', description: 'The liked post’s id on X.' },
      { name: 'created_at', type: 'datetime', description: 'When the liked post was posted, from its id.' },
      { name: 'liked_at', type: 'datetime', description: 'When you liked it, when Xomoni knows.' },
      { name: 'author', type: 'string', description: 'Who posted it, when Xomoni knows.' },
      { name: 'status', type: 'string', description: 'present, deleted (unliked by Xomoni) or gone.' },
      { name: 'link', type: 'string', description: 'Where it is on x.com.' },
    ],
    async rows(accountId, range) {
      // The liked post's text is its author's words: it stays out (ADR-0044, decision 5).
      return (await itemsOf(accountId, ['like'], range)).map((i) => [
        i.id,
        iso(i.createdAt),
        iso(i.likedAt),
        i.author || null,
        i.status,
        postLink(i.id),
      ]);
    },
  },
  {
    id: 'analytics-days',
    label: 'X’s analytics of each day',
    others: false,
    columns: [
      { name: 'day', type: 'date', description: 'The day, as X’s export names it.' },
      { name: 'as_of', type: 'datetime', description: 'When the numbers were imported.' },
      ...DAY_METRICS.map((m) => ({ name: snake(m), type: 'integer' as const, description: `${m} that day, from X.` })),
    ],
    async rows(accountId, range) {
      const days = await db.analyticsDays.where('[accountId+day]').between([accountId, ''], [accountId, '￿']).toArray();
      return days
        .filter((d) => within(dayAt(d.day), range))
        .map((d) => [d.day, iso(d.asOf), ...DAY_METRICS.map((m) => d[m] ?? null)]);
    },
  },
  {
    id: 'analytics-posts',
    label: 'X’s analytics of each post',
    others: false,
    columns: [
      { name: 'post_id', type: 'string', description: 'The post’s id on X.' },
      { name: 'created_at', type: 'datetime', description: 'When it was posted.' },
      { name: 'as_of', type: 'datetime', description: 'When the newest numbers were imported.' },
      ...POST_METRICS.map((m) => ({ name: snake(m), type: 'integer' as const, description: `${m}, from X.` })),
      { name: 'text', type: 'string', description: 'Its text, when Xomoni’s copy doesn’t hold the post.' },
    ],
    async rows(accountId, range) {
      const posts = await db.analyticsPosts
        .where('[accountId+createdAt]')
        .between([accountId, range.from ?? -Infinity], [accountId, range.to ?? Infinity], true, true)
        .toArray();
      return posts.map((p) => [
        p.postId,
        iso(p.createdAt),
        iso(p.asOf),
        ...POST_METRICS.map((m) => p[m] ?? null),
        p.text ?? null,
      ]);
    },
  },
  {
    id: 'timeline',
    label: 'Your account’s timeline',
    others: false,
    columns: [
      { name: 'at', type: 'datetime', description: 'When it happened.' },
      {
        name: 'kind',
        type: 'string',
        description: 'note, premium_on, premium_off, archive_requested, archive_imported, x_label or risk.',
      },
      {
        name: 'source',
        type: 'string',
        description: 'Who said it: person, xomoni, profile, archive, analytics or under-the-hood.',
      },
      { name: 'words', type: 'string', description: 'Xomoni’s words, or your note.' },
    ],
    async rows(accountId, range) {
      const entries = await accountTimeline(accountId, {
        ...(range.from !== null && { from: range.from }),
        ...(range.to !== null && { to: range.to }),
        limit: Infinity,
      });
      return entries.reverse().map((e) => [iso(e.at), e.kind, e.source, e.words]);
    },
  },
  {
    id: 'imports',
    label: 'The imports of X’s files',
    others: false,
    columns: [
      { name: 'imported_at', type: 'datetime', description: 'When the file was imported.' },
      {
        name: 'source',
        type: 'string',
        description: 'Which of X’s files: x-archive, x-analytics-posts, x-analytics-days, …',
      },
      { name: 'file_name', type: 'string', description: 'The file’s name.' },
      { name: 'bytes', type: 'integer', description: 'Its size.' },
      { name: 'covers_from', type: 'datetime', description: 'The first moment it covers, when it says.' },
      {
        name: 'covers_to',
        type: 'datetime',
        description: 'The last moment it covers; for X’s archive, when X made it.',
      },
      { name: 'rows_read', type: 'integer', description: 'Rows read.' },
      { name: 'rows_merged', type: 'integer', description: 'Rows merged into the vault.' },
      { name: 'rows_skipped', type: 'integer', description: 'Rows left out, out of shape.' },
      {
        name: 'problems',
        type: 'string',
        description: 'What went wrong or was left out, as codes, separated by spaces.',
      },
    ],
    async rows(accountId, range) {
      return (await importLedger(accountId))
        .filter((r) => within(r.importedAt, range))
        .reverse()
        .map((r) => [
          iso(r.importedAt),
          r.source,
          r.fileName,
          r.bytes,
          iso(r.coverFrom),
          iso(r.coverTo),
          r.counts.read,
          r.counts.merged,
          r.counts.skipped,
          r.problems.join(' '),
        ]);
    },
  },
  {
    id: 'replies-to-you',
    label: 'Replies others wrote to you',
    others: true,
    columns: [
      { name: 'id', type: 'string', description: 'The reply’s id on X.' },
      { name: 'author', type: 'string', description: 'Who wrote it.' },
      { name: 'created_at', type: 'datetime', description: 'When it was posted.' },
      { name: 'to_id', type: 'string', description: 'Your post it answers.' },
      { name: 'text', type: 'string', description: 'Its text, at most 1,000 characters (ADR-0030).' },
    ],
    async rows(accountId, range) {
      const replies = await db.incoming
        .where('[accountId+createdAt]')
        .between([accountId, range.from ?? -Infinity], [accountId, range.to ?? Infinity], true, true)
        .toArray();
      return replies.map((r) => [r.id, r.author, iso(r.createdAt), r.toId, r.text]);
    },
  },
];

/** What the export holds: which parts, in which formats, for which dates. */
export interface ExportChoice {
  /** The parts' ids; a part with others' words only when named here. */
  parts: readonly string[];
  csv: boolean;
  json: boolean;
  range: ExportRange;
}

/** The parts a choice takes, in the export's order: the core's own unless named, others' only when named. */
export function chosenParts(choice: Pick<ExportChoice, 'parts'>, parts: readonly ExportPart[] = EXPORT_PARTS) {
  return parts.filter((part) => choice.parts.includes(part.id));
}

/** The parts the export takes by default: every part but those holding others' words (ADR-0044, decision 5). */
export const DEFAULT_PARTS: readonly string[] = EXPORT_PARTS.filter((p) => !p.others).map((p) => p.id);

/** One part's rows as a CSV for people: a byte order mark, the header, CRLF rows, no cell a spreadsheet would run. */
export function partCsv(part: Pick<ExportPart, 'columns'>, rows: readonly ExportCell[][]): string {
  return CSV_BOM + toCsvRow(part.columns.map((c) => c.name)) + rows.map((row) => toCsvRow(row)).join('');
}

/** One part's rows as JSON: a list of objects named by the columns. */
export function partJson(part: Pick<ExportPart, 'columns'>, rows: readonly ExportCell[][]): string {
  return JSON.stringify(
    rows.map((row) => Object.fromEntries(part.columns.map((c, i) => [c.name, row[i] ?? null]))),
    null,
    2,
  );
}

/** What the export knows about itself, for `README.txt`, `schema.json` and `index.html`. */
export interface ExportInfo {
  handle: string;
  exportedAt: number;
  appVersion: string;
  range: ExportRange;
  parts: { part: ExportPart; rows: ExportCell[][]; files: string[] }[];
}

/** `schema.json`: the schema's version, and every file with its columns and their types. */
export function exportSchema(info: ExportInfo): string {
  return JSON.stringify(
    {
      schema: EXPORT_SCHEMA,
      exportedAt: new Date(info.exportedAt).toISOString(),
      app: `Xomoni ${info.appVersion}`,
      range: { from: iso(info.range.from), to: iso(info.range.to) },
      parts: info.parts.map(({ part, rows, files }) => ({
        id: part.id,
        label: part.label,
        othersWords: part.others,
        rows: rows.length,
        files,
        columns: part.columns,
      })),
    },
    null,
    2,
  );
}

/** `README.txt`: what each file is, its columns, the date and the version, and that no Xomoni is needed to read it. */
export function exportReadme(info: ExportInfo): string {
  const lines = [
    `Your vault from Xomoni, for @${info.handle}`,
    '',
    `Exported ${new Date(info.exportedAt).toISOString()} by Xomoni ${info.appVersion}, in the format ${EXPORT_SCHEMA}.`,
    info.range.from || info.range.to
      ? `Dates: ${iso(info.range.from) ?? 'the start'} to ${iso(info.range.to) ?? 'now'}.`
      : 'Dates: all of them.',
    '',
    'You don’t need Xomoni to read any of this. Open the CSV files in a spreadsheet, the JSON files in any tool, and',
    'index.html in a browser. The files hold your own data from X: keep them private.',
    "A cell that starts with = + - or @ has a ' in front, so a spreadsheet shows it as text instead of running it.",
    '',
  ];
  for (const { part, rows, files } of info.parts) {
    lines.push(`${part.label} (${rows.length.toLocaleString('en')} rows): ${files.join(', ')}`);
    if (part.others) lines.push('  It holds other people’s words: you chose to include it.');
    for (const column of part.columns) lines.push(`  ${column.name} (${column.type}): ${column.description}`);
    lines.push('');
  }
  lines.push('schema.json lists every file with its columns and their types.');
  return `${lines.join('\r\n')}\r\n`;
}

/** The most rows of a part the page shows; every row is in its CSV and JSON. */
export const HTML_ROWS = 1_000;

/** `index.html`: each part as a table, every text escaped, no script, under `ARCHIVE_CSP`. */
export function exportIndexHtml(info: ExportInfo): string {
  const cell = (value: ExportCell) => (value === null ? '' : escapeHtml(String(value)));
  const sections = info.parts.map(({ part, rows, files }) => {
    const shown = rows.slice(0, HTML_ROWS);
    const more =
      rows.length > shown.length
        ? `<p>The first ${HTML_ROWS.toLocaleString('en')} of ${rows.length.toLocaleString('en')} rows; every row is in ${escapeHtml(files.join(' and '))}.</p>`
        : '';
    return `<section><h2>${escapeHtml(part.label)}</h2><p>${rows.length.toLocaleString('en')} rows.</p>${more}<table><thead><tr>${part.columns
      .map((c) => `<th scope="col">${escapeHtml(c.name)}</th>`)
      .join('')}</tr></thead><tbody>${shown
      .map((row) => `<tr>${row.map((value) => `<td>${cell(value)}</td>`).join('')}</tr>`)
      .join('')}</tbody></table></section>`;
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${ARCHIVE_CSP}"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Your vault from Xomoni, @${escapeHtml(info.handle)}</title><style>body{font:14px/1.5 system-ui,sans-serif;margin:2rem;color:#1b1b1b;background:#fff}table{border-collapse:collapse;display:block;overflow-x:auto}th,td{border:1px solid #ccc;padding:4px 8px;text-align:left;vertical-align:top;white-space:pre-wrap}@media (prefers-color-scheme:dark){body{background:#121212;color:#eee}th,td{border-color:#444}}</style></head><body><h1>Your vault from Xomoni, @${escapeHtml(info.handle)}</h1><p>Exported ${escapeHtml(new Date(info.exportedAt).toISOString())}, format ${EXPORT_SCHEMA}. No Xomoni is needed to read it.</p>${sections.join('')}</body></html>`;
}

/** What `vaultExport` made: the ZIP, and how many rows of each part it holds. */
export interface VaultExport {
  zip: Blob;
  rows: Record<string, number>;
}

/**
 * Makes the vault's open export for `account`: every chosen part read for the dates, as CSV, JSON or both, with
 * `README.txt`, `schema.json` and `index.html`, in one ZIP. With `signal` aborted, it stops and throws an `AbortError`:
 * no ZIP is made, so nothing is downloaded. Reads only; nothing is sent anywhere.
 */
export async function vaultExport(
  account: { id: string; handle: string },
  choice: ExportChoice,
  options: { appVersion: string; now?: number; signal?: AbortSignal; onProgress?: (message: string) => void } = {
    appVersion: '0.0.0',
  },
): Promise<VaultExport> {
  const exportedAt = options.now ?? Date.now();
  const parts: ExportInfo['parts'] = [];
  for (const part of chosenParts(choice)) {
    if (options.signal?.aborted) throw new DOMException('The export was cancelled.', 'AbortError');
    options.onProgress?.(`Reading ${part.label}…`);
    const files = [...(choice.csv ? [`${part.id}.csv`] : []), ...(choice.json ? [`${part.id}.json`] : [])];
    parts.push({ part, rows: await part.rows(account.id, choice.range), files });
  }
  const info: ExportInfo = {
    handle: account.handle,
    exportedAt,
    appVersion: options.appVersion,
    range: choice.range,
    parts,
  };
  function* entries(): Generator<ZipWriteEntry> {
    yield { path: 'README.txt', data: exportReadme(info) };
    yield { path: 'schema.json', data: exportSchema(info) };
    yield { path: 'index.html', data: exportIndexHtml(info) };
    for (const { part, rows } of parts) {
      if (choice.csv) yield { path: `${part.id}.csv`, data: partCsv(part, rows) };
      if (choice.json) yield { path: `${part.id}.json`, data: partJson(part, rows) };
    }
  }
  options.onProgress?.('Writing the ZIP…');
  const zip = await writeZip(entries(), {
    modified: new Date(exportedAt),
    ...(options.signal && { signal: options.signal }),
  });
  return { zip, rows: Object.fromEntries(parts.map(({ part, rows }) => [part.id, rows.length])) };
}
