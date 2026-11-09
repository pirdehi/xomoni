// Finding X's archive in the Downloads folder by itself (#187). The person lets Xomoni read that folder once, through
// the browser's own folder picker (File System Access: read-only, no extension permission). Xomoni then looks there
// for a ZIP named like X's archive and imports it, so nobody has to find the file and drop it. Only files named like
// X's archive are ever opened; nothing leaves this computer (ADR-0004).

import { kvGet, kvSet } from '../shared/db';
import type { Account } from '../shared/types';
import { type ImportResult, importArchive } from './importArchive';

/** How X names its archive: `twitter-2026-11-08-<hash>.zip`, or `x-…` should X rename it. */
export const ARCHIVE_FILE = /^(?:twitter|x)-\d{4}-\d{2}-\d{2}-[\w-]+\.zip$/i;

/** The parts of a folder handle Xomoni uses; `FileSystemDirectoryHandle` in the browser, a stand-in in tests. */
export interface FolderHandle {
  readonly name: string;
  values(): AsyncIterable<{ readonly kind: string; readonly name: string }>;
  queryPermission?(descriptor: { mode: 'read' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'read' }): Promise<PermissionState>;
}

/** A file in the folder, as `values()` gives it: `FileSystemFileHandle` in the browser. */
interface FileEntry {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
}

/** The File System Access folder picker, which TypeScript's DOM library doesn't describe yet. */
type DirectoryPicker = (options: { id?: string; startIn?: 'downloads'; mode?: 'read' }) => Promise<FolderHandle>;

/** Where the picker lives: `window` in the dashboard, a stand-in in tests. */
export interface FolderPickerHost {
  showDirectoryPicker?: DirectoryPicker;
}

/** Where the chosen folder's handle is kept between visits; IndexedDB in the dashboard, memory in tests. */
export interface FolderStore {
  /** The folder chosen before, or null. */
  get(): Promise<FolderHandle | null>;
  /** Keeps the chosen folder; null forgets it. */
  set(folder: FolderHandle | null): Promise<void>;
}

const FOLDER_KEY = 'downloadsFolder';

/** The folder handle kept in IndexedDB, which stores such handles as they are. */
export const kvFolderStore: FolderStore = {
  /** Reads the handle back; the browser keeps it, with its permission, between visits. */
  get: () => kvGet<FolderHandle | null>(FOLDER_KEY, null),
  /** Stores the handle as it is (handles survive IndexedDB's structured clone). */
  set: (folder) => kvSet(FOLDER_KEY, folder),
};

/**
 * Asks the person for their Downloads folder, read-only, the picker opening there. Returns the folder; `null` when
 * they closed the picker; `undefined` when this browser has no such picker.
 */
export async function chooseFolder(
  host: FolderPickerHost = window as unknown as FolderPickerHost,
): Promise<FolderHandle | null | undefined> {
  const picker = host.showDirectoryPicker;
  if (typeof picker !== 'function') return undefined;
  try {
    return await picker.call(host, { id: 'downloads', startIn: 'downloads', mode: 'read' });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    return undefined;
  }
}

/**
 * Whether Xomoni may read the folder now. Without asking, only a permission already granted counts; asking needs a
 * click by the person (the browser shows its own prompt).
 */
export async function canRead(folder: FolderHandle, ask: boolean): Promise<boolean> {
  const descriptor = { mode: 'read' } as const;
  if (!folder.queryPermission) return true;
  if ((await folder.queryPermission(descriptor)) === 'granted') return true;
  if (!ask || !folder.requestPermission) return false;
  return (await folder.requestPermission(descriptor)) === 'granted';
}

/** What identifies one archive file, so the same one is never imported twice. */
export const fileKey = (file: Pick<File, 'name' | 'size' | 'lastModified'>) =>
  `${file.name}|${file.size}|${file.lastModified}`;

const isFile = (entry: { kind: string }): entry is FileEntry => entry.kind === 'file';

/**
 * The newest file in the folder named like X's archive and not in `seen`, or null. A download still in progress has
 * another name (`.crdownload`), so it is never picked half-written.
 */
export async function newestArchive(folder: FolderHandle, seen: ReadonlySet<string>): Promise<File | null> {
  let newest: File | null = null;
  for await (const entry of folder.values()) {
    if (!isFile(entry) || !ARCHIVE_FILE.test(entry.name)) continue;
    const file = await entry.getFile();
    if (seen.has(fileKey(file))) continue;
    if (!newest || file.lastModified > newest.lastModified) newest = file;
  }
  return newest;
}

const seenKey = (accountId: string) => `archiveFilesSeen:${accountId}`;

/** The archive files already imported, or tried, for this account. */
export async function seenArchives(accountId: string): Promise<Set<string>> {
  return new Set(await kvGet<string[]>(seenKey(accountId), []));
}

/** Remembers an archive file as imported or tried, keeping the last 20. */
export async function markArchiveSeen(accountId: string, file: Pick<File, 'name' | 'size' | 'lastModified'>) {
  const list = [...(await seenArchives(accountId)), fileKey(file)];
  await kvSet(seenKey(accountId), [...new Set(list)].slice(-20));
}

/** What one look in the folder did: imported an archive, failed to (and why), or found nothing new (null). */
export type FolderImport =
  { file: File; result: ImportResult; error?: undefined } | { file: File; error: string; result?: undefined } | null;

/**
 * Imports the newest archive in the folder not seen yet for this account, if any. The file is remembered before it
 * is read, so one that fails is not tried again and again.
 */
export async function importNewestArchive(
  account: Account,
  folder: FolderHandle,
  onProgress: (message: string) => void,
): Promise<FolderImport> {
  const file = await newestArchive(folder, await seenArchives(account.id));
  if (!file) return null;
  await markArchiveSeen(account.id, file);
  try {
    return { file, result: await importArchive([file], account, onProgress) };
  } catch (err) {
    return { file, error: err instanceof Error ? err.message : String(err) };
  }
}
