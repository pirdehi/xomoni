// The vault's one importer (ADR-0043, #424): every file of X's that Xomoni reads goes through it. A parser for each
// kind of file registers here (`registerParser`), a table-driven strategy (ADR-0015). `planImport` finds which parser
// takes which files, checks every size before anything is read, asks each parser whose files they are, and knows a
// file read before by its fingerprint; the person confirms the plan; `runImport` reads and merges it batch by batch,
// and writes one row of the import ledger per file. Nothing here sends anything anywhere (ADR-0004) or acts on X.
import { isXId } from '../ids';
import { type ZipEntry, listZip, looksLikeZip, readZipEntry } from '../zip';
import { findImport, recordImport } from './db';
import { type ImportCounts, MAX_FILE_NAME, MAX_PROBLEMS, type VaultImport, type VaultSource } from './types';

/** The ZIP a file came in: its name, size and fingerprint, the same for every file in it. */
export interface VaultZip {
  readonly name: string;
  readonly size: number;
  readonly fingerprint: string;
}

/**
 * One file the person dropped or chose, or one entry of a ZIP they did, before any of it is read. `size` is what the
 * file or the ZIP's directory says, checked against the parser's limit before `text()` or `bytes()` is ever called.
 */
export interface VaultFile {
  /** Its name, for example `tweets.js`. */
  readonly name: string;
  /** Its path in the archive or the folder, for example `data/tweets.js`; how a parser recognizes it. */
  readonly path: string;
  /** Its size in bytes. */
  readonly size: number;
  /** Reads it as UTF-8 text. */
  text(): Promise<string>;
  /** Reads its bytes. */
  bytes(): Promise<Uint8Array>;
  /**
   * Reads its first `bytes` bytes as text, to recognize it by its first line (a CSV's header) without reading all of
   * it. A parser peeks only at a file within its size limit.
   */
  head(bytes: number): Promise<string>;
  /** The ZIP it came in, when it did. */
  readonly zip?: VaultZip;
  /** When it was last changed (epoch ms), for a file on the computer. */
  readonly modified?: number;
}

/** The most bytes a text file's fingerprint reads; larger files are known by their name, size and time. */
export const MAX_HASHED_BYTES = 50 * 1024 * 1024;

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

const sha256 = async (data: Uint8Array<ArrayBuffer>) => hex(await crypto.subtle.digest('SHA-256', data));

/**
 * A ZIP's fingerprint, `zip:` and the SHA-256 of every entry's path, size and CRC from its central directory: read
 * without reading the entries, so a ZIP of gigabytes is known at once. Two ZIPs with the same files have the same one.
 */
export async function zipFingerprint(entries: readonly Pick<ZipEntry, 'path' | 'size' | 'crc32'>[]): Promise<string> {
  const lines = entries.map((e) => `${e.path}\t${String(e.size)}\t${String(e.crc32)}`).sort();
  return `zip:${await sha256(new TextEncoder().encode(lines.join('\n')))}`;
}

/**
 * The fingerprint of the files a parser takes (ADR-0043, decision 4), which never leaves the computer:
 * - files of one ZIP: the ZIP's (`zipFingerprint`);
 * - one file up to `MAX_HASHED_BYTES`: `sha256:` of its bytes, with Web Crypto;
 * - anything else (an unzipped folder, a larger file): `sha256:` of each file's path, size and time.
 */
export async function fingerprint(files: readonly VaultFile[]): Promise<string> {
  const [first] = files;
  if (first?.zip && files.every((f) => f.zip?.fingerprint === first.zip?.fingerprint)) return first.zip.fingerprint;
  if (files.length === 1 && first && first.size <= MAX_HASHED_BYTES) {
    return `sha256:${await sha256(new Uint8Array(await first.bytes()))}`;
  }
  const lines = files.map((f) => `${f.path}\t${String(f.size)}\t${String(f.modified ?? 0)}`).sort();
  return `sha256:${await sha256(new TextEncoder().encode(lines.join('\n')))}`;
}

/** Whether a file the person chose is a ZIP, by its name or by its first bytes. */
const isZip = async (file: File) => file.name.toLowerCase().endsWith('.zip') || (await looksLikeZip(file));

/**
 * Whether a ZIP entry's path stays inside the ZIP: not absolute, no drive letter, and no `..` step, with `\\` read as
 * `/`. Xomoni never writes an entry anywhere, but a path that climbs out is a crafted ZIP, and its entry is never read.
 */
export function isSafeZipPath(path: string): boolean {
  if (/^([/\\]|[A-Za-z]:)/.test(path)) return false;
  return !path.split(/[/\\]/).some((step) => step === '..');
}

/**
 * The entries of `zip` as files, read in place: only its directory now, and an entry only when it is read. An entry
 * whose path climbs out of the ZIP (`isSafeZipPath`) is left out.
 */
async function zipFiles(zip: File): Promise<VaultFile[]> {
  const entries = await listZip(zip);
  const info: VaultZip = { name: zip.name, size: zip.size, fingerprint: await zipFingerprint(entries) };
  const utf8 = new TextDecoder('utf-8');
  return entries
    .filter((entry) => isSafeZipPath(entry.path))
    .map((entry) => ({
      name: entry.path.split('/').pop() ?? entry.path,
      path: entry.path,
      size: entry.size,
      text: async () => utf8.decode(await readZipEntry(zip, entry)),
      bytes: () => readZipEntry(zip, entry),
      // An entry is inflated whole to be read at all; parsers peek only at entries within their limit.
      head: async (n: number) => utf8.decode((await readZipEntry(zip, entry)).subarray(0, n)),
      zip: info,
    }));
}

/** A file on the computer as a vault file, found by its path in the folder the person chose, or its name. */
export function diskFile(file: File): VaultFile {
  return {
    name: file.name,
    path: file.webkitRelativePath || file.name,
    size: file.size,
    text: () => file.text(),
    bytes: async () => new Uint8Array(await file.arrayBuffer()),
    head: (n: number) => file.slice(0, n).text(),
    modified: file.lastModified,
  };
}

/**
 * What the person dropped or chose, as vault files: each ZIP's entries (only its directory is read; a ZIP that isn't
 * one throws `ZipError`), and every other file as it is.
 */
export async function openFiles(chosen: readonly File[]): Promise<VaultFile[]> {
  const out: VaultFile[] = [];
  for (const file of chosen) {
    if (await isZip(file)) out.push(...(await zipFiles(file)));
    else out.push(diskFile(file));
  }
  return out;
}

/** Whose files these are, as a parser sees it before reading them all (ADR-0043, decision 5). */
export type OwnerVerdict =
  | { readonly ok: true }
  /** Not the account's: nothing is imported, and the person reads why. */
  | { readonly ok: false; readonly reason: string }
  /** The files can't tell: the person confirms they are theirs (a days CSV, #425). */
  | { readonly ok: 'confirm'; readonly question: string };

/** What a parser gets while it reads: the account, the time, a way to cancel, and where to say what it found. */
export interface ParseContext {
  readonly account: { readonly id: string; readonly handle: string };
  readonly now: number;
  readonly signal?: AbortSignal;
  /** Tells the person how far the import is, in words. */
  progress(message: string): void;
  /** Widens the period the files cover (epoch ms); null leaves a side as it is. */
  cover(from: number | null, to: number | null): void;
  /** Notes a problem for the ledger, as a short code: `unknown-field:<name>`, `skipped-row:<line>`. */
  problem(code: string): void;
  /** Adds to the count of one part of the files, such as `tweets`. */
  count(part: string, rows: number): void;
}

/** One batch a parser read: how many rows, how many it skipped, and how to merge them. */
export interface VaultBatch {
  /** Rows read in it. */
  readonly read: number;
  /** Rows it left out, out of shape. */
  readonly skipped?: number;
  /** Merges the batch into the database, in a transaction of its own, and answers how many rows it merged. */
  write(): Promise<number>;
}

/** What `runImport` did with one part of a plan. */
export interface PartResult {
  readonly part: PlannedPart;
  /** The ledger's row; null for an account Xomoni didn't learn from X, whose id the ledger can't take. */
  readonly ledger: VaultImport | null;
  readonly counts: ImportCounts;
  /** The same files were imported before: nothing was read or written but the ledger's row. */
  readonly duplicate: boolean;
  /** The person cancelled it: what was merged before stays (merges are idempotent). */
  readonly cancelled: boolean;
}

/** A kind of X's files the vault reads: a strategy registered with `registerParser`. */
export interface VaultParser {
  readonly source: VaultSource;
  /** What the person reads for it, such as `X's archive`. */
  readonly label: string;
  /** Its version, raised when what it reads changes; the ledger keeps `<source>@<version>`. */
  readonly version: number;
  /**
   * The files it takes from what was dropped or chosen; none when they aren't its kind. It may peek at a file's start
   * (`head`), but only at one within `maxBytes`.
   */
  matches(files: readonly VaultFile[]): VaultFile[] | Promise<VaultFile[]>;
  /** Each file it takes is a part of its own, with its own fingerprint and ledger row (a CSV); all together otherwise. */
  readonly onePerFile?: boolean;
  /** The largest `file` it reads, in bytes, checked before anything is read. */
  maxBytes(file: VaultFile): number;
  /** What the person reads when `file` is over `limit`; a generic sentence when left out. */
  tooBig?(file: VaultFile, limit: number): string;
  /**
   * Whose files they are; every file is taken as the account's when left out. Reads as little as it can. `fingerprint`
   * is the files', so an answer the person gave for these very files can be remembered.
   */
  owner?(files: readonly VaultFile[], account: ParseContext['account'], fingerprint: string): Promise<OwnerVerdict>;
  /** Reads the files and yields batches to merge; checks `ctx.signal` between batches. */
  read(files: readonly VaultFile[], ctx: ParseContext): AsyncIterable<VaultBatch>;
  /** After the ledger's row is written, for what else an import does (the archive's marker, the activity log). */
  finish?(result: PartResult, ctx: ParseContext): Promise<void>;
}

const registry = new Map<VaultSource, VaultParser>();

/**
 * Registers a parser, in place of any earlier one for its source. Parsers are asked in the order they were registered:
 * a file belongs to the first that takes it.
 */
export function registerParser(parser: VaultParser): void {
  registry.set(parser.source, parser);
}

/** The registered parsers, in their order. */
export function registeredParsers(): VaultParser[] {
  return [...registry.values()];
}

/** One part of a plan: the files one parser takes, checked and ready for the person to confirm. */
export interface PlannedPart {
  readonly parser: VaultParser;
  readonly files: readonly VaultFile[];
  /** The name the ledger keeps: the ZIP's, the file's, or the folder's. */
  readonly fileName: string;
  /** Their size in bytes: the ZIP's, or the files' together. */
  readonly bytes: number;
  readonly fingerprint: string;
  /** The earlier import of the same files: a duplicate writes nothing but its ledger row. */
  readonly duplicateOf: VaultImport | null;
  /** What the person must confirm first, when the files can't say whose they are; null when they did. */
  readonly confirm: string | null;
}

/** Files refused before anything was read, and why, in the person's words. */
export interface PlanRefusal {
  readonly fileName: string;
  readonly reason: string;
  /** The parser that refused them (too large, or another account's); none for a file no parser knows. */
  readonly source?: VaultSource;
}

/** What `planImport` found, for the person to confirm before anything is written. */
export interface ImportPlan {
  readonly account: ParseContext['account'];
  readonly parts: readonly PlannedPart[];
  readonly refused: readonly PlanRefusal[];
  /** Files no parser took that came in a ZIP or a folder with others, such as an archive's photos: never read. */
  readonly ignored: readonly VaultFile[];
}

/** A file no parser knows, dropped on its own. */
export const UNKNOWN_FILE = 'Xomoni doesn’t know this file. Nothing was imported from it.';

const megabytes = (bytes: number) => `${Math.ceil(bytes / (1024 * 1024)).toLocaleString()} MB`;

/** The sentence for a file over its parser's limit, when the parser has none of its own. */
const tooBigFor = (parser: VaultParser, file: VaultFile, limit: number) =>
  parser.tooBig?.(file, limit) ??
  `${file.name} is ${megabytes(file.size)}, larger than Xomoni reads for ${parser.label} (${megabytes(limit)}). Nothing was imported.`;

/** Where files came from: one ZIP, or the files chosen outside any ZIP. */
function groups(files: readonly VaultFile[]): VaultFile[][] {
  const byZip = new Map<string, VaultFile[]>();
  const loose: VaultFile[] = [];
  for (const file of files) {
    if (!file.zip) loose.push(file);
    else byZip.set(file.zip.fingerprint, [...(byZip.get(file.zip.fingerprint) ?? []), file]);
  }
  return [...byZip.values(), ...(loose.length ? [loose] : [])];
}

/** The ledger's name for files: the ZIP's, a single file's, or the folder's. */
function nameOf(files: readonly VaultFile[]): string {
  const [first] = files;
  const name = first?.zip?.name ?? (files.length === 1 ? first?.name : first?.path.split('/')[0]) ?? '';
  return name.slice(0, MAX_FILE_NAME);
}

/**
 * Plans an import of `files` for `account`, reading as little as it can and writing nothing:
 * 1. each ZIP's files, and the files outside any ZIP, go to the first parser that takes them;
 * 2. every size is checked against its parser's limit before anything is read (ADR-0043, decision 3);
 * 3. each part's fingerprint is taken (decision 4) and each parser says whose files they are (decision 5): another
 *    account's are refused, and files that can't tell need the person's word;
 * 4. the fingerprint is looked up in the ledger, so the same files again are a duplicate.
 * A parser that takes `onePerFile` makes a part of each file.
 * A file no parser takes is refused with `UNKNOWN_FILE` when it came on its own, and ignored when it came with others.
 * `parsers` are the registered ones unless given.
 */
export async function planImport(
  files: readonly VaultFile[],
  account: ParseContext['account'],
  parsers: readonly VaultParser[] = registeredParsers(),
): Promise<ImportPlan> {
  const parts: PlannedPart[] = [];
  const refused: PlanRefusal[] = [];
  const ignored: VaultFile[] = [];
  for (const group of groups(files)) {
    let left = [...group];
    const taken: [VaultParser, VaultFile[]][] = [];
    for (const parser of parsers) {
      const mine = await parser.matches(left);
      if (!mine.length) continue;
      taken.push([parser, mine]);
      left = left.filter((file) => !mine.includes(file));
    }
    // Files a ZIP or a folder holds beside the ones read, such as photos, are never read. A file chosen on its own that
    // no parser takes is refused, and so is a ZIP that holds nothing Xomoni reads.
    if (group[0]?.zip) {
      if (taken.length) ignored.push(...left);
      else refused.push({ fileName: nameOf(group), reason: UNKNOWN_FILE });
    } else {
      for (const file of left) {
        if (file.path.includes('/')) ignored.push(file);
        else refused.push({ fileName: file.name, reason: UNKNOWN_FILE });
      }
    }
    const each = taken.flatMap(([parser, mine]): [VaultParser, VaultFile[]][] =>
      parser.onePerFile ? mine.map((file) => [parser, [file]]) : [[parser, mine]],
    );
    for (const [parser, mine] of each) {
      const over = mine.find((file) => file.size > parser.maxBytes(file));
      if (over) {
        refused.push({
          fileName: nameOf(mine),
          reason: tooBigFor(parser, over, parser.maxBytes(over)),
          source: parser.source,
        });
        continue;
      }
      const print = await fingerprint(mine);
      const verdict = parser.owner ? await parser.owner(mine, account, print) : ({ ok: true } as const);
      if (verdict.ok === false) {
        refused.push({ fileName: nameOf(mine), reason: verdict.reason, source: parser.source });
        continue;
      }
      parts.push({
        parser,
        files: mine,
        fileName: nameOf(mine),
        bytes: mine[0]?.zip?.size ?? mine.reduce((sum, file) => sum + file.size, 0),
        fingerprint: print,
        duplicateOf: (await findImport(account.id, print)) ?? null,
        confirm: verdict.ok === 'confirm' ? verdict.question : null,
      });
    }
  }
  return { account, parts, refused, ignored };
}

/** What `runImport` takes besides the plan. */
export interface RunOptions {
  /** Tells the person how far the import is. */
  onProgress?: (message: string) => void;
  /** Cancels between batches: what was merged stays, and the ledger says `cancelled`. */
  signal?: AbortSignal;
  /** The import's moment (epoch ms); now when left out. */
  now?: number;
}

/** Codes kept in a ledger row: at most `MAX_PROBLEMS`, each cut to 200 characters. */
const keptProblems = (problems: readonly string[]) =>
  [...new Set(problems)].slice(0, MAX_PROBLEMS).map((p) => p.slice(0, 200));

/**
 * Imports a confirmed plan, part by part: reads each part's files with its parser and merges batch by batch, each
 * batch in a transaction of its own, then writes the part's ledger row (ADR-0043, decision 4) and lets the parser
 * finish. A duplicate writes only its ledger row (`problems: ['duplicate']`). Cancelling with `signal` stops between
 * batches: what was merged stays, and the row says `cancelled`. A failure writes the row with `failed` and throws, as
 * the parser threw. An account Xomoni didn't learn from X (only a test's made-up one) keeps no ledger row.
 */
export async function runImport(plan: ImportPlan, options: RunOptions = {}): Promise<PartResult[]> {
  const now = options.now ?? Date.now();
  const results: PartResult[] = [];
  const keepsLedger = isXId(plan.account.id);
  for (const part of plan.parts) {
    const problems: string[] = [];
    const parts: Record<string, number> = {};
    const counts: ImportCounts = { read: 0, merged: 0, skipped: 0 };
    let [from, to] = [null as number | null, null as number | null];
    const ctx: ParseContext = {
      account: plan.account,
      now,
      ...(options.signal && { signal: options.signal }),
      progress: (message) => options.onProgress?.(message),
      cover: (start, end) => {
        if (start !== null) from = from === null ? start : Math.min(from, start);
        if (end !== null) to = to === null ? end : Math.max(to, end);
      },
      problem: (code) => problems.push(code),
      count: (name, rows) => {
        parts[name] = (parts[name] ?? 0) + rows;
      },
    };
    const ledger = async (extra: readonly string[]) => {
      if (!keepsLedger) return null;
      const cover = from !== null && to !== null && from > to ? [to, to] : [from, to];
      return recordImport(
        {
          accountId: plan.account.id,
          source: part.parser.source,
          fileName: part.fileName,
          bytes: part.bytes,
          fingerprint: part.fingerprint,
          importedAt: now,
          coverFrom: cover[0] ?? null,
          coverTo: cover[1] ?? null,
          counts: Object.keys(parts).length ? { ...counts, parts } : counts,
          parser: `${part.parser.source}@${String(part.parser.version)}`,
          problems: keptProblems([...extra, ...problems]),
        },
        now,
      );
    };
    if (part.duplicateOf) {
      const result = {
        part,
        ledger: await ledger(['duplicate']),
        counts: { read: 0, merged: 0, skipped: 0 },
        duplicate: true,
        cancelled: false,
      };
      results.push(result);
      continue;
    }
    let cancelled = false;
    try {
      for await (const batch of part.parser.read(part.files, ctx)) {
        if (options.signal?.aborted) {
          cancelled = true;
          break;
        }
        counts.read += batch.read;
        counts.skipped += batch.skipped ?? 0;
        counts.merged += await batch.write();
      }
    } catch (err) {
      await ledger(['failed']);
      throw err;
    }
    const result: PartResult = {
      part,
      ledger: await ledger(cancelled ? ['cancelled'] : []),
      counts: { ...counts, ...(Object.keys(parts).length && { parts }) },
      duplicate: false,
      cancelled,
    };
    if (!cancelled) await part.parser.finish?.(result, ctx);
    results.push(result);
  }
  return results;
}
