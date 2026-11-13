// Finding X's archive in Downloads by itself (#187, #196). Chrome never lets an extension read Downloads itself, only a
// folder inside it, so X's archive is saved in Downloads/Xomoni (see `background/archive-downloads.ts`). Xomoni makes
// that folder, and the person lets Xomoni read it once, through the browser's own folder picker (File System Access,
// read-only). Xomoni then looks there for a ZIP named like X's archive and imports it, so nobody has to find the file
// and drop it. Only files named like X's archive are ever opened; nothing leaves this computer (ADR-0004).

import { kvGet, kvSet, setArchiveFolderChosen } from '../shared/db';
import type { Account } from '../shared/types';
import { ARCHIVE_FILE, ARCHIVE_FOLDER, FOLDER_NOTE, FOLDER_NOTE_URL } from '../shared/x-archive';
import { type ImportResult, importArchive } from './importArchive';

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
  /**
   * Stores the handle as it is (handles survive IndexedDB's structured clone), and whether there is one, which tells
   * the service worker to save X's archive in the Xomoni folder.
   */
  set: async (folder) => {
    await kvSet(FOLDER_KEY, folder);
    await setArchiveFolderChosen(!!folder);
  },
};

/**
 * Asks the person for a folder, read-only, the picker opening in Downloads. Returns the folder; `null` when they closed
 * the picker, or Chrome refused the folder they chose; `undefined` when this browser has no such picker.
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

/** The part of `chrome.downloads` that makes the folder; a stand-in in tests. */
export interface DownloadsApi {
  download(options: { url: string; filename: string; conflictAction: 'overwrite'; saveAs: false }): Promise<number>;
  search(query: { id: number }): Promise<readonly { state?: string }[]>;
  erase(query: { id: number }): Promise<unknown>;
}

const chromeDownloads: DownloadsApi = {
  download: (options) => chrome.downloads.download(options),
  search: (query) => chrome.downloads.search(query),
  erase: (query) => chrome.downloads.erase(query),
};

/**
 * Makes Downloads/Xomoni, if it isn't there yet, by saving a short note in it (`FOLDER_NOTE`, from its fixed address,
 * which the service worker places in the folder), so the person can open it in the picker. The note is left out of
 * Chrome's list of downloads. Returns whether the note was saved within `waitMs`.
 */
export async function makeArchiveFolder(api: DownloadsApi = chromeDownloads, waitMs = 3000): Promise<boolean> {
  const id = await api.download({
    url: FOLDER_NOTE_URL,
    filename: `${ARCHIVE_FOLDER}/${FOLDER_NOTE}`,
    conflictAction: 'overwrite',
    saveAs: false,
  });
  for (let waited = 0; waited <= waitMs; waited += 100) {
    const [item] = await api.search({ id });
    if (item?.state === 'complete') {
      await api.erase({ id });
      return true;
    }
    if (item?.state === 'interrupted') return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/** Whether a chosen folder is the Xomoni folder, where Chrome saves X's archive (#196). */
export const isArchiveFolder = (folder: Pick<FolderHandle, 'name'>) => folder.name === ARCHIVE_FOLDER;

/** What the card says when no folder came back: Chrome refuses Downloads itself, so that is the likely reason. */
export const FOLDER_NOT_CHOSEN =
  'No folder chosen. Chrome doesn’t let extensions read Downloads itself: in the window that opens, open the Xomoni folder inside Downloads, then press Select.';

/** What the card says when the person chose another folder than the Xomoni one. */
export const wrongFolder = (name: string) =>
  `“${name}” isn’t the Xomoni folder. Chrome saves X’s archive in Downloads › Xomoni: open that folder in the picker, then press Select.`;

/**
 * What choosing the folder came to: the Xomoni folder, kept; or why not, with null when this browser has no picker.
 */
export type FolderPick = { folder: FolderHandle; problem?: undefined } | { folder?: undefined; problem: string | null };

/**
 * Makes Downloads/Xomoni, then asks the person for it in the browser's picker, opened in Downloads, and keeps it.
 * Any other folder is refused with the reason, since X's archive never lands there.
 */
export async function pickArchiveFolder(
  store: FolderStore,
  host: FolderPickerHost = window as unknown as FolderPickerHost,
  makeFolder: () => Promise<boolean> = makeArchiveFolder,
): Promise<FolderPick> {
  if (typeof host.showDirectoryPicker !== 'function') return { problem: null };
  await makeFolder().catch(() => false);
  const chosen = await chooseFolder(host);
  if (chosen === undefined) return { problem: null };
  if (chosen === null) return { problem: FOLDER_NOT_CHOSEN };
  if (!isArchiveFolder(chosen)) return { problem: wrongFolder(chosen.name) };
  await store.set(chosen);
  return { folder: chosen };
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
