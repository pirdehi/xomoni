import {
  archiveLikeDrafts,
  archiveTweetDrafts,
  classifyArchiveFile,
  parseArchiveAccount,
  parseYtd,
} from '../shared/archive';
import { addLog, upsertItems } from '../shared/db';
import type { Account, ItemDraft } from '../shared/types';

const CHUNK = 2000;

/** How many archive rows `importArchive` merged into the inventory. */
export interface ImportResult {
  /** Posts, replies and reposts from `tweets.js` (and its parts). */
  tweets: number;
  /** Likes from `like.js` (and its parts). */
  likes: number;
}

/**
 * Imports `account.js`, `tweets.js` and `like.js` (including `-partN` splits)
 * from an unzipped X archive. The archive must belong to the connected account.
 */
export async function importArchive(
  files: File[],
  account: Account,
  onProgress: (msg: string) => void,
): Promise<ImportResult> {
  const picked = files
    .map((file) => ({ file, kind: classifyArchiveFile(file.webkitRelativePath || file.name) }))
    .filter((f): f is { file: File; kind: NonNullable<typeof f.kind> } => f.kind != null);

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
