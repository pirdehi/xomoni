// CSV as people and X write it (#425, RFC 4180): quoted cells with `""` for a quote, line breaks inside quotes, a
// byte order mark, CRLF or LF, and a comma, a semicolon or a tab between cells, guessed from the header. Pure; safe for
// the content script.

/** The most rows `parseCsv` reads unless told otherwise: far more than X's analytics export holds. */
export const MAX_CSV_ROWS = 500_000;

/** A separator between cells. */
export type CsvDelimiter = ',' | ';' | '\t';

/** One record, with the line of the file it starts on (the header is line 1). */
export interface CsvRow {
  line: number;
  cells: string[];
}

/** A CSV read: its separator, its header, its rows, and what couldn't be read. */
export interface CsvTable {
  delimiter: CsvDelimiter;
  headers: string[];
  rows: CsvRow[];
  /** More rows than `maxRows` followed, and were left unread. */
  truncated: boolean;
  /** Records that couldn't be read, by the line they start on: `unclosed-quote`. */
  problems: { line: number; problem: string }[];
}

/**
 * The separator a header line uses: whichever of `,`, `;` and a tab appears most outside quotes, `,` when none does.
 */
export function guessDelimiter(header: string): CsvDelimiter {
  const counts: Record<CsvDelimiter, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const char of header) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === ',' || char === ';' || char === '\t')) counts[char]++;
  }
  return (Object.entries(counts) as [CsvDelimiter, number][]).reduce<[CsvDelimiter, number]>(
    (best, next) => (next[1] > best[1] ? next : best),
    [',', 0],
  )[0];
}

/**
 * Reads `text` as a CSV with a header line. A byte order mark is dropped, CRLF and LF both end a record, blank lines are
 * skipped, and a quote that never closes drops the record it opens (`unclosed-quote` in `problems`). Reads at most
 * `maxRows` records after the header.
 */
export function parseCsv(text: string, options: { maxRows?: number } = {}): CsvTable {
  const maxRows = options.maxRows ?? MAX_CSV_ROWS;
  const body = text.startsWith('﻿') ? text.slice(1) : text;
  const firstBreak = body.search(/\r?\n/);
  const delimiter = guessDelimiter(firstBreak < 0 ? body : body.slice(0, firstBreak));
  const records: CsvRow[] = [];
  const problems: CsvTable['problems'] = [];
  let truncated = false;

  let line = 1;
  let start = 1;
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let wasQuoted = false;
  const endCell = () => {
    cells.push(cell);
    cell = '';
    wasQuoted = false;
  };
  const endRecord = () => {
    const blank = cells.length === 0 && cell === '' && !wasQuoted;
    endCell();
    if (!blank) records.push({ line: start, cells });
    cells = [];
  };

  for (let i = 0; i < body.length; i++) {
    const char = body.charAt(i);
    if (quoted) {
      if (char === '"') {
        if (body[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (char === '\n') line++;
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === '') {
      quoted = true;
      wasQuoted = true;
    } else if (char === delimiter) endCell();
    else if (char === '\r' && body[i + 1] === '\n') continue;
    else if (char === '\n' || char === '\r') {
      endRecord();
      line++;
      start = line;
      if (records.length > maxRows) {
        truncated = true;
        break;
      }
    } else cell += char;
  }
  if (quoted) problems.push({ line: start, problem: 'unclosed-quote' });
  else if (!truncated && (cell !== '' || cells.length || wasQuoted)) endRecord();

  const [header, ...rows] = records;
  if (rows.length > maxRows) {
    rows.length = maxRows;
    truncated = true;
  }
  return { delimiter, headers: header?.cells ?? [], rows, truncated, problems };
}

/** The byte order mark a CSV for people starts with, so a spreadsheet reads it as UTF-8 (ADR-0044, decision 3). */
export const CSV_BOM = '﻿';

/** The first characters that make a spreadsheet run a cell as a formula: `=`, `+`, `-`, `@`, a tab, a carriage return. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One CSV record, RFC 4180, as a spreadsheet can't run it (ADR-0044, decision 3): a cell starting like a formula gets a
 * `'` in front, a cell with a comma, a quote or a line break is quoted with its quotes doubled, and the record ends with
 * CRLF. Numbers are written as they are; null and undefined are empty cells.
 */
export function toCsvRow(cells: readonly (string | number | null | undefined)[]): string {
  return `${cells
    .map((cell) => {
      if (cell === null || cell === undefined) return '';
      if (typeof cell === 'number') return String(cell);
      const safe = FORMULA_START.test(cell) ? `'${cell}` : cell;
      return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    })
    .join(',')}\r\n`;
}
