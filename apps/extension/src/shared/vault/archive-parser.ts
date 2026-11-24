// X's archive on the vault's importer (#424, ADR-0043): `account.js` says whose it is, `tweets.js` and `like.js`
// (with their `-partN` splits) go into the inventory as before, and `data/manifest.js` says when X made it, which the
// import ledger and the account's timeline keep. The words a person reads, the limits and the order of the checks are
// the archive import's own from before the importer (#151, #184, #390): nothing about it changed but the ledger.
import { archiveLikeDrafts, archiveTweetDrafts, classifyArchiveFile, parseArchiveAccount, parseYtd } from '../archive';
import { addLog, markArchiveImported, upsertItems } from '../db';
import { isXId } from '../ids';
import type { ItemDraft } from '../types';
import { MAX_MANIFEST_BYTES, parseThar } from './archive-manifest';
import { addAccountEvent } from './db';
import { type OwnerVerdict, type VaultBatch, type VaultFile, type VaultParser, registerParser } from './importer';

/**
 * Drafts merged into the inventory at a time. Every chunk is a write the open pages' live queries answer by counting
 * the inventory again, so with a heavy X user's 200,000 items, chunks of 2,000 made the import spend minutes
 * recounting (#390). Each chunk is still its own transaction: an import cut short keeps what it saved.
 */
export const ARCHIVE_IMPORT_CHUNK = 20_000;

/**
 * The largest archive file Xomoni reads (#151). Each file is read whole, and a big account's `tweets.js` is a few
 * hundred megabytes at most; a larger file would only exhaust the dashboard's memory.
 */
export const MAX_ARCHIVE_FILE_BYTES = 512 * 1024 * 1024;

/** The largest `account.js` Xomoni reads; X's is a few kilobytes. */
export const MAX_ACCOUNT_FILE_BYTES = 1024 * 1024;

/** What the person dropped or chose that can't be an X archive. */
export const NOT_AN_ARCHIVE =
  'No tweets.js or like.js found. Choose the ZIP file X sent you (twitter-….zip), or the “data” folder inside it.';

const megabytes = (bytes: number) => `${Math.ceil(bytes / (1024 * 1024)).toLocaleString()} MB`;

/** Whether `path` is the archive's manifest, `data/manifest.js`. */
const isManifest = (path: string) => (path.split('/').pop() ?? path).toLowerCase() === 'manifest.js';

/** The archive's files Xomoni reads, in the order they came, with what each is. */
function archiveParts(files: readonly VaultFile[]) {
  return files.flatMap((file) => {
    const kind = classifyArchiveFile(file.path);
    return kind ? [{ file, kind }] : [];
  });
}

/** The day X made the archive, as the timeline says it: `2026-11-08`. */
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * X's archive (`x-archive`): it takes `account.js`, `tweets.js`, `like.js` and their splits, and `manifest.js`, found by
 * their path in the ZIP or the folder; photos, messages and the rest are never read. Every file is at most 512 MB
 * (`account.js` and the manifest 1 MB). It belongs to the account its `account.js` names, read before anything else.
 */
export const ARCHIVE_PARSER: VaultParser = {
  source: 'x-archive',
  label: 'X’s archive',
  version: 1,
  /** The archive's data files Xomoni reads and its manifest, found by their path. */
  matches: (files) => files.filter((file) => classifyArchiveFile(file.path) !== null || isManifest(file.path)),
  /** 1 MB for `account.js` and the manifest, 512 MB for the rest. */
  maxBytes: (file) =>
    classifyArchiveFile(file.path) === 'account'
      ? MAX_ACCOUNT_FILE_BYTES
      : isManifest(file.path)
        ? MAX_MANIFEST_BYTES
        : MAX_ARCHIVE_FILE_BYTES,
  /** The words the archive import always said for a file too large. */
  tooBig: (file, limit) =>
    `${file.name} is ${megabytes(file.size)}, larger than Xomoni reads (${megabytes(limit)}). Check that this is your own X archive. Nothing was imported.`,

  async owner(files, account): Promise<OwnerVerdict> {
    const parts = archiveParts(files);
    if (!parts.some((p) => p.kind !== 'account')) return { ok: false, reason: NOT_AN_ARCHIVE };
    const accountFile = parts.find((p) => p.kind === 'account');
    if (!accountFile) {
      return {
        ok: false,
        reason: `account.js is missing. Include it so Xomoni can check the archive belongs to @${account.handle}.`,
      };
    }
    const owner = parseArchiveAccount(parseYtd(await accountFile.file.text()));
    if (!owner) return { ok: false, reason: 'Could not read account.js from the archive.' };
    if (owner.accountId !== account.id) {
      return {
        ok: false,
        reason: `This archive belongs to @${owner.handle || owner.accountId}, not @${account.handle}. Nothing was imported.`,
      };
    }
    return { ok: true };
  },

  async *read(files, ctx): AsyncGenerator<VaultBatch> {
    const manifest = files.find((file) => isManifest(file.path));
    if (manifest) {
      const read = parseThar(await manifest.text());
      if (read?.generationDate) ctx.cover(null, read.generationDate);
      else ctx.problem('manifest-unreadable');
    }
    for (const { file, kind } of archiveParts(files)) {
      if (kind === 'account') continue;
      if (ctx.signal?.aborted) return;
      ctx.progress(`Reading ${file.name}…`);
      const rows = parseYtd(await file.text());
      const drafts: ItemDraft[] =
        kind === 'tweets' ? archiveTweetDrafts(rows, ctx.account.id, ctx.account.handle) : archiveLikeDrafts(rows);
      if (kind === 'tweets') {
        const times = drafts.map((d) => d.createdAt).filter((t) => t > 0);
        if (times.length) ctx.cover(Math.min(...times.slice(0, 100_000)), null);
      }
      ctx.count(kind, drafts.length);
      // Saying so before the first chunk: it takes a while at 20,000 rows.
      ctx.progress(`Saving ${file.name}: 0 / ${drafts.length.toLocaleString()}`);
      for (let i = 0; i < drafts.length; i += ARCHIVE_IMPORT_CHUNK) {
        const chunk = drafts.slice(i, i + ARCHIVE_IMPORT_CHUNK);
        const done = Math.min(i + ARCHIVE_IMPORT_CHUNK, drafts.length);
        yield {
          read: chunk.length,
          write: async () => {
            await upsertItems(ctx.account.id, chunk, 'archive');
            ctx.progress(`Saving ${file.name}: ${done.toLocaleString()} / ${drafts.length.toLocaleString()}`);
            return chunk.length;
          },
        };
      }
    }
  },

  async finish(result, ctx) {
    const tweets = result.counts.parts?.tweets ?? 0;
    const likes = result.counts.parts?.likes ?? 0;
    await markArchiveImported(ctx.account.id);
    await addLog({
      accountId: ctx.account.id,
      jobId: null,
      level: 'success',
      action: 'system',
      targetId: null,
      outcome: null,
      message: `Imported archive: ${tweets.toLocaleString()} posts/replies/reposts and ${likes.toLocaleString()} likes`,
    });
    if (!result.ledger || !isXId(ctx.account.id)) return;
    const made = result.ledger.coverTo;
    await addAccountEvent(
      {
        accountId: ctx.account.id,
        kind: 'archive_imported',
        at: ctx.now,
        source: 'archive',
        words: `Imported X’s archive${made ? ` made on ${dayOf(made)}` : ''}: ${tweets.toLocaleString('en')} posts, replies and reposts, and ${likes.toLocaleString('en')} likes.`,
        ref: result.ledger.id,
      },
      ctx.now,
    );
  },
};

registerParser(ARCHIVE_PARSER);
