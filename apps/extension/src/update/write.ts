// Writing a checked release into Xomoni's folder (#305, ADR-0033), all of it or none of it. Before the first write,
// every file the release replaces is read into a backup, which is also kept in IndexedDB (the journal), so an update
// cut short (the tab closed, the computer slept) can still be undone next time. New files go first, the ones that
// replace old files next, and `manifest.json` last, so the folder says the new version only once everything else is
// there. If a write fails, every file written so far is put back (or removed, if it was new). Only after all of it
// succeeded are the old version's leftovers in `assets/` removed, the one folder only Xomoni's build writes.
import { kvGet, kvSet } from '../shared/db';
import type { OwnFolder } from './own-folder';
import { UpdateFailure } from './problems';
import type { ReleaseFile } from './release-zip';
import { safePath } from './release-zip';

/** One file before the update: its bytes, or null when the release adds it. */
export interface Backup {
  readonly path: string;
  readonly old: Uint8Array | null;
}

/** An update under way: from which version, to which, since when (epoch ms), and the files it replaces. */
export interface UpdateJournal {
  readonly from: string;
  readonly to: string;
  readonly at: number;
  readonly backups: readonly Backup[];
}

/** Where the journal is kept while an update writes: IndexedDB in the dashboard, memory in tests. */
export interface JournalStore {
  /** The update that didn't finish, or null. */
  get(): Promise<UpdateJournal | null>;
  /** Keeps the journal; null forgets it, once the folder is whole again. */
  set(journal: UpdateJournal | null): Promise<void>;
}

const JOURNAL_KEY = 'updateJournal';

/** The journal in the `kv` table; IndexedDB keeps the backups' bytes as they are. */
export const kvJournal: JournalStore = {
  /** The update that didn't finish, or null. */
  get: () => kvGet<UpdateJournal | null>(JOURNAL_KEY, null),
  /** Keeps the journal, bytes and all; null forgets it. */
  set: (journal) => kvSet(JOURNAL_KEY, journal),
};

/** The folder only Xomoni's build writes, whose leftovers an update may remove. */
const OWNED_FOLDER = 'assets';

/** The parts of `path` after a check that it stays inside the folder; anything else throws before any I/O. */
function partsOf(path: string): { dirs: string[]; name: string } {
  if (!safePath(path)) throw new UpdateFailure('bad-package', `unsafe path ${JSON.stringify(path)}`);
  const dirs = path.split('/');
  const name = dirs.pop() ?? '';
  return { dirs, name };
}

/** Whether `err` is the browser saying a file or folder isn't there. */
const notFound = (err: unknown) => err instanceof DOMException && err.name === 'NotFoundError';

/** The folder at `dirs` under `root`, or null when it isn't there. */
async function folderAt(root: OwnFolder, dirs: readonly string[]): Promise<OwnFolder | null> {
  let folder = root;
  for (const dir of dirs) {
    try {
      folder = await folder.getDirectoryHandle(dir);
    } catch (err) {
      if (notFound(err)) return null;
      throw err;
    }
  }
  return folder;
}

/** The folder at `dirs` under `root`, made with any folder above it that is missing. */
async function makeFolders(root: OwnFolder, dirs: readonly string[]): Promise<OwnFolder> {
  let folder = root;
  for (const dir of dirs) folder = await folder.getDirectoryHandle(dir, { create: true });
  return folder;
}

/** The bytes of the file at `path`, or null when there is none. */
export async function readFileAt(root: OwnFolder, path: string): Promise<Uint8Array | null> {
  const { dirs, name } = partsOf(path);
  const folder = await folderAt(root, dirs);
  if (!folder) return null;
  try {
    const file = await (await folder.getFileHandle(name)).getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch (err) {
    if (notFound(err)) return null;
    throw err;
  }
}

/** Writes `data` to the file at `path`, making its folders; a failed write is aborted, leaving the old file. */
export async function writeFileAt(root: OwnFolder, path: string, data: Uint8Array): Promise<void> {
  const { dirs, name } = partsOf(path);
  const folder = await makeFolders(root, dirs);
  const writable = await (await folder.getFileHandle(name, { create: true })).createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (err) {
    await writable.abort().catch(() => undefined);
    throw err;
  }
}

/** Removes the file at `path`, if it is there. */
async function removeFileAt(root: OwnFolder, path: string): Promise<void> {
  const { dirs, name } = partsOf(path);
  const folder = await folderAt(root, dirs);
  if (!folder) return;
  try {
    await folder.removeEntry(name);
  } catch (err) {
    if (!notFound(err)) throw err;
  }
}

/** Puts each backup back: the old bytes, or no file for one the release added. True when every one went back. */
async function putBack(root: OwnFolder, backups: readonly Backup[]): Promise<boolean> {
  let all = true;
  // Last written first, so `manifest.json` goes back before the files it names.
  for (const backup of [...backups].reverse()) {
    try {
      if (backup.old) await writeFileAt(root, backup.path, backup.old);
      else await removeFileAt(root, backup.path);
    } catch {
      all = false;
    }
  }
  return all;
}

/** The order files are written in: new ones, then the ones that replace old files, then `manifest.json`. */
export function writeOrder<T extends Backup>(backups: readonly T[]): T[] {
  const rank = (b: Backup) => (b.path === 'manifest.json' ? 2 : b.old ? 1 : 0);
  return [...backups].sort((a, b) => rank(a) - rank(b));
}

/** What a finished write did: how many files it wrote, and how many of the old version's leftovers it removed. */
export interface WriteResult {
  written: number;
  removed: number;
}

/**
 * Writes `files` into `root`, the update from `from` to `to`, all or nothing (see the top of this file). Throws
 * `UpdateFailure`: `write-failed` once everything written was put back (the journal is forgotten), or
 * `rollback-failed` when some of it couldn't be (the journal stays, for `restoreJournal`). Nothing is written when
 * the backup can't be read.
 */
export async function writeRelease(
  root: OwnFolder,
  files: readonly ReleaseFile[],
  update: { from: string; to: string; at: number },
  journal: JournalStore = kvJournal,
): Promise<WriteResult> {
  const planned: (Backup & { data: Uint8Array })[] = [];
  try {
    for (const file of files) planned.push({ ...file, old: await readFileAt(root, file.path) });
    await journal.set({ ...update, backups: planned.map(({ path, old }) => ({ path, old })) });
  } catch (err) {
    throw new UpdateFailure('write-failed', `couldn’t keep a backup of the old files: ${String(err)}`);
  }

  const order = writeOrder(planned);
  let done = 0;
  try {
    for (const file of order) {
      await writeFileAt(root, file.path, file.data);
      done++;
    }
  } catch (err) {
    // The one that failed too: Chrome leaves it whole, but a file system that doesn't is put right as well.
    const restored = await putBack(root, order.slice(0, done + 1));
    if (restored) await journal.set(null);
    throw new UpdateFailure(restored ? 'write-failed' : 'rollback-failed', String(err));
  }
  await journal.set(null);
  return { written: done, removed: await removeLeftovers(root, new Set(files.map((file) => file.path))) };
}

/** Removes the files in `assets/` the new version doesn't have; best effort, since leftovers harm nothing. */
async function removeLeftovers(root: OwnFolder, keep: ReadonlySet<string>): Promise<number> {
  let removed = 0;
  try {
    const folder = await folderAt(root, [OWNED_FOLDER]);
    if (!folder) return 0;
    const stale: string[] = [];
    for await (const entry of folder.values()) {
      if (entry.kind === 'file' && !keep.has(`${OWNED_FOLDER}/${entry.name}`)) stale.push(entry.name);
    }
    for (const name of stale) {
      await folder.removeEntry(name);
      removed++;
    }
  } catch {
    // A leftover that stays is only a few unused kilobytes.
  }
  return removed;
}

/**
 * Undoes an update that didn't finish (`journal` kept from a write cut short): every file it replaced gets its old
 * bytes back, and every file it added is removed. Forgets the journal once all of it is back; true then.
 */
export async function restoreJournal(root: OwnFolder, journal: JournalStore = kvJournal): Promise<boolean> {
  const pending = await journal.get();
  if (!pending) return true;
  const restored = await putBack(root, writeOrder(pending.backups));
  if (restored) await journal.set(null);
  return restored;
}
