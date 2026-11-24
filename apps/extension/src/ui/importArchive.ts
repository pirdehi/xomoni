import {
  ARCHIVE_IMPORT_CHUNK as CHUNK,
  ARCHIVE_PARSER,
  MAX_ACCOUNT_FILE_BYTES as ACCOUNT_LIMIT,
  MAX_ARCHIVE_FILE_BYTES as FILE_LIMIT,
  NOT_AN_ARCHIVE,
} from '../shared/vault/archive-parser';
import { type VaultFile, diskFile, openFiles, planImport, runImport } from '../shared/vault/importer';
import type { Account } from '../shared/types';
import { looksLikeZip } from '../shared/zip';

// X's archive in the Library (#184), on the vault's importer (#424, ADR-0043): the same files, limits, words and order
// of checks as before, and now a row in the import ledger, the date X made the archive, and a duplicate recognized.

/**
 * Drafts merged into the inventory at a time (#390): 20,000, each chunk its own transaction, so an import cut short
 * keeps what it saved (`shared/vault/archive-parser.ts`).
 */
export const ARCHIVE_IMPORT_CHUNK = CHUNK;

/** The largest archive file Xomoni reads (#151): 512 MB (`shared/vault/archive-parser.ts`). */
export const MAX_ARCHIVE_FILE_BYTES = FILE_LIMIT;

/** The largest `account.js` Xomoni reads: 1 MB; X's is a few kilobytes. */
export const MAX_ACCOUNT_FILE_BYTES = ACCOUNT_LIMIT;

/** How many archive rows `importArchive` merged into the inventory. */
export interface ImportResult {
  /** Posts, replies and reposts from `tweets.js` (and its parts). */
  tweets: number;
  /** Likes from `like.js` (and its parts). */
  likes: number;
  /**
   * The same archive was imported before (its fingerprint is in the ledger): nothing was read or written again, and
   * the counts are the earlier import's.
   */
  duplicate?: true;
}

/** One data file of an X archive, inside the ZIP X sends or in its unzipped folder, before it is read. */
export type ArchiveFile = VaultFile;

/**
 * The archive files in what the person dropped or chose (#184): the ZIP X sends, read in place without unzipping
 * (only its directory and the entries Xomoni imports are read; photos and videos never are), or the files of an
 * unzipped archive, as before. A ZIP must come on its own.
 */
export async function archiveFiles(chosen: readonly File[]): Promise<ArchiveFile[]> {
  const [only] = chosen;
  if (chosen.length === 1 && only && (only.name.toLowerCase().endsWith('.zip') || (await looksLikeZip(only)))) {
    return openFiles([only]);
  }
  if (chosen.some((file) => file.name.toLowerCase().endsWith('.zip'))) {
    throw new Error('Choose the ZIP file on its own, without other files.');
  }
  return chosen.map(diskFile);
}

/**
 * Imports `account.js`, `tweets.js` and `like.js` (including `-partN` splits) from an X archive: the ZIP X sends, or
 * the files of the unzipped archive (`archiveFiles`). The archive must belong to the connected account, and no file
 * may be larger than `MAX_ARCHIVE_FILE_BYTES` (`account.js`: `MAX_ACCOUNT_FILE_BYTES`); otherwise nothing is
 * imported. It runs on the vault's importer with X's archive's parser alone, which writes one row of the import ledger
 * with the date X made the archive (`data/manifest.js`) and adds it to the account's timeline; the same archive again
 * is a duplicate, and writes nothing but its ledger row.
 */
export async function importArchive(
  chosen: readonly File[],
  account: Account,
  onProgress: (msg: string) => void,
): Promise<ImportResult> {
  const files = await archiveFiles(chosen);
  const plan = await planImport(files, account, [ARCHIVE_PARSER]);
  // The archive's own refusals (too large, another account's, no account.js) say what is wrong; anything else in the
  // folder is not the archive's, and never read.
  const refusal = plan.refused.find((r) => r.source === ARCHIVE_PARSER.source);
  if (refusal) throw new Error(refusal.reason);
  const [part] = plan.parts;
  if (!part) throw new Error(NOT_AN_ARCHIVE);
  const [result] = await runImport({ ...plan, parts: [part] }, { onProgress });
  if (part.duplicateOf) {
    const earlier = part.duplicateOf.counts.parts;
    return { tweets: earlier?.tweets ?? 0, likes: earlier?.likes ?? 0, duplicate: true };
  }
  return { tweets: result?.counts.parts?.tweets ?? 0, likes: result?.counts.parts?.likes ?? 0 };
}
