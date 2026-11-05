import {
  archiveLikeDrafts,
  archiveTweetDrafts,
  classifyArchiveFile,
  parseArchiveAccount,
  parseYtd,
} from '../shared/archive';
import { addLog, markArchiveImported, upsertItems } from '../shared/db';
import type { Account, ItemDraft } from '../shared/types';

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

/**
 * Imports `account.js`, `tweets.js` and `like.js` (including `-partN` splits)
 * from an unzipped X archive. The archive must belong to the connected account, and no file may be larger than
 * `MAX_ARCHIVE_FILE_BYTES` (`account.js`: `MAX_ACCOUNT_FILE_BYTES`).
 */
export async function importArchive(
  files: File[],
  account: Account,
  onProgress: (msg: string) => void,
): Promise<ImportResult> {
  const picked = files
    .map((file) => ({ file, kind: classifyArchiveFile(file.webkitRelativePath || file.name) }))
    .filter((f): f is { file: File; kind: NonNullable<typeof f.kind> } => f.kind != null);

  // Every size is checked before anything is read, so a file too large imports nothing at all.
  for (const { file, kind } of picked) {
    const limit = kind === 'account' ? MAX_ACCOUNT_FILE_BYTES : MAX_ARCHIVE_FILE_BYTES;
    if (file.size > limit) {
      throw new Error(
        `${file.name} is ${megabytes(file.size)}, larger than Xomoni reads (${megabytes(limit)}). Check that you chose the “data” folder of your own X archive. Nothing was imported.`,
      );
    }
  }
  const accountFile = picked.find((f) => f.kind === 'account');
  if (!picked.some((f) => f.kind !== 'account')) {
    throw new Error('No tweets.js or like.js found. Choose the “data” folder inside your unzipped X archive.');
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
