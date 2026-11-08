import {
  archiveLikeDrafts,
  archiveTweetDrafts,
  classifyArchiveFile,
  parseArchiveAccount,
  parseYtd,
} from '../shared/archive';
import { addLog, markArchiveImported, upsertItems } from '../shared/db';
import type { Account, ItemDraft } from '../shared/types';
import { listZip, looksLikeZip, readZipEntry } from '../shared/zip';

const CHUNK = 2000;

/**
 * The largest archive file Xomoni reads (#151). Each file is read whole, and a big account's `tweets.js` is a few
 * hundred megabytes at most; a larger file would only exhaust the dashboard's memory.
 */
export const MAX_ARCHIVE_FILE_BYTES = 512 * 1024 * 1024;

/** The largest `account.js` Xomoni reads; X's is a few kilobytes. */
export const MAX_ACCOUNT_FILE_BYTES = 1024 * 1024;

const megabytes = (bytes: number) => `${Math.ceil(bytes / (1024 * 1024)).toLocaleString()} MB`;

/** How many archive rows `importArchive` merged into the inventory. */
export interface ImportResult {
  /** Posts, replies and reposts from `tweets.js` (and its parts). */
  tweets: number;
  /** Likes from `like.js` (and its parts). */
  likes: number;
}

/** One data file of an X archive, inside the ZIP X sends or in its unzipped folder. */
export interface ArchiveFile {
  /** Its name, for example `tweets.js`. */
  readonly name: string;
  /** Its path in the archive, for example `data/tweets.js`; how it is recognised. */
  readonly path: string;
  /** Its size in bytes once read; checked against the limits before anything is read. */
  readonly size: number;
  /** Reads it as text. */
  text(): Promise<string>;
}

/** What the person dropped or chose that can't be an X archive. */
const NOT_AN_ARCHIVE =
  'No tweets.js or like.js found. Choose the ZIP file X sent you (twitter-….zip), or the “data” folder inside it.';

/**
 * The archive files in what the person dropped or chose (#184): the ZIP X sends, read in place without unzipping
 * (only its directory and the entries Xomoni imports are read; photos and videos never are), or the files of an
 * unzipped archive, as before. A ZIP must come on its own.
 */
export async function archiveFiles(chosen: readonly File[]): Promise<ArchiveFile[]> {
  const [only] = chosen;
  if (chosen.length === 1 && only && (only.name.toLowerCase().endsWith('.zip') || (await looksLikeZip(only)))) {
    const zip = only;
    const utf8 = new TextDecoder('utf-8');
    return (await listZip(zip)).map((entry) => ({
      name: entry.path.split('/').pop() ?? entry.path,
      path: entry.path,
      size: entry.size,
      text: async () => utf8.decode(await readZipEntry(zip, entry)),
    }));
  }
  if (chosen.some((file) => file.name.toLowerCase().endsWith('.zip'))) {
    throw new Error('Choose the ZIP file on its own, without other files.');
  }
  return chosen.map((file) => ({
    name: file.name,
    path: file.webkitRelativePath || file.name,
    size: file.size,
    text: () => file.text(),
  }));
}

/**
 * Imports `account.js`, `tweets.js` and `like.js` (including `-partN` splits) from an X archive: the ZIP X sends, or
 * the files of the unzipped archive (`archiveFiles`). The archive must belong to the connected account, and no file
 * may be larger than `MAX_ARCHIVE_FILE_BYTES` (`account.js`: `MAX_ACCOUNT_FILE_BYTES`); otherwise nothing is
 * imported.
 */
export async function importArchive(
  chosen: readonly File[],
  account: Account,
  onProgress: (msg: string) => void,
): Promise<ImportResult> {
  const picked = (await archiveFiles(chosen))
    .map((file) => ({ file, kind: classifyArchiveFile(file.path) }))
    .filter((f): f is { file: ArchiveFile; kind: NonNullable<typeof f.kind> } => f.kind != null);

  // Every size is checked before anything is read, so a file too large imports nothing at all.
  for (const { file, kind } of picked) {
    const limit = kind === 'account' ? MAX_ACCOUNT_FILE_BYTES : MAX_ARCHIVE_FILE_BYTES;
    if (file.size > limit) {
      throw new Error(
        `${file.name} is ${megabytes(file.size)}, larger than Xomoni reads (${megabytes(limit)}). Check that this is your own X archive. Nothing was imported.`,
      );
    }
  }
  const accountFile = picked.find((f) => f.kind === 'account');
  if (!picked.some((f) => f.kind !== 'account')) {
    throw new Error(NOT_AN_ARCHIVE);
  }
  if (!accountFile) {
    throw new Error(
      'account.js is missing. Include it so Xomoni can check the archive belongs to @' + account.handle + '.',
    );
  }
  const owner = parseArchiveAccount(parseYtd(await accountFile.file.text()));
  if (!owner) throw new Error('Could not read account.js from the archive.');
  if (owner.accountId !== account.id) {
    throw new Error(
      `This archive belongs to @${owner.handle || owner.accountId}, not @${account.handle}. Nothing was imported.`,
    );
  }

  const result: ImportResult = { tweets: 0, likes: 0 };
  for (const { file, kind } of picked) {
    if (kind === 'account') continue;
    onProgress(`Reading ${file.name}…`);
    const rows = parseYtd(await file.text());
    const drafts: ItemDraft[] =
      kind === 'tweets' ? archiveTweetDrafts(rows, account.id, account.handle) : archiveLikeDrafts(rows);
    for (let i = 0; i < drafts.length; i += CHUNK) {
      await upsertItems(account.id, drafts.slice(i, i + CHUNK), 'archive');
      onProgress(
        `Saving ${file.name}: ${Math.min(i + CHUNK, drafts.length).toLocaleString()} / ${drafts.length.toLocaleString()}`,
      );
    }
    if (kind === 'tweets') result.tweets += drafts.length;
    else result.likes += drafts.length;
  }
  await markArchiveImported(account.id);
  await addLog({
    accountId: account.id,
    jobId: null,
    level: 'success',
    action: 'system',
    targetId: null,
    outcome: null,
    message: `Imported archive: ${result.tweets.toLocaleString()} posts/replies/reposts and ${result.likes.toLocaleString()} likes`,
  });
  return result;
}
