// Xomoni's own folder (#305, ADR-0033): the folder a zip install was loaded from in Chrome, which the person lets
// Xomoni change once, through the browser's folder picker (File System Access, read and write). Chrome 122 and later
// can keep that permission ("Allow on every visit"); earlier, or when the person allowed it only this time, Chrome asks
// again on the next click. Xomoni checks that the folder holds this very Xomoni (its `manifest.json` names this
// extension at this version) before it keeps the folder and again before every update.

import { kvGet, kvSet } from '../shared/db';
import { asObject, asString } from '../shared/json';

/** A file in the folder: the parts of `FileSystemFileHandle` Xomoni uses. */
export interface OwnFile {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<Blob>;
  createWritable(): Promise<OwnWritable>;
}

/**
 * Writing one file: `FileSystemWritableFileStream`. Chrome writes into a copy beside the file and puts it in place
 * only on `close()`, so a write that fails leaves the old file whole.
 */
export interface OwnWritable {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

/** The read and write permission Xomoni asks for. */
export const READ_WRITE = { mode: 'readwrite' } as const;

/** A folder: the parts of `FileSystemDirectoryHandle` Xomoni uses; a stand-in in tests. */
export interface OwnFolder {
  readonly kind: 'directory';
  readonly name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<OwnFolder>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OwnFile>;
  removeEntry(name: string): Promise<void>;
  values(): AsyncIterable<OwnFolder | OwnFile>;
  queryPermission?(descriptor: typeof READ_WRITE): Promise<PermissionState>;
  requestPermission?(descriptor: typeof READ_WRITE): Promise<PermissionState>;
}

/** The File System Access folder picker, which TypeScript's DOM library doesn't describe yet. */
type DirectoryPicker = (options: { id?: string; mode?: 'readwrite' }) => Promise<OwnFolder>;

/** Where the picker and the click's activation live: `window` in the dashboard, a stand-in in tests. */
export interface PickerHost {
  showDirectoryPicker?: DirectoryPicker;
  /** Whether the click still lets the page open a picker or a prompt (User Activation API). */
  navigator?: { userActivation?: { isActive: boolean } };
}

/** Where the chosen folder's handle is kept between visits: IndexedDB in the dashboard, memory in tests. */
export interface OwnFolderStore {
  /** The folder chosen before, or null. */
  get(): Promise<OwnFolder | null>;
  /** Keeps the chosen folder; null forgets it. */
  set(folder: OwnFolder | null): Promise<void>;
}

const FOLDER_KEY = 'ownFolder';

/** The handle kept in IndexedDB, which stores handles as they are, with their permission, between visits. */
export const kvOwnFolderStore: OwnFolderStore = {
  /** Reads the handle back, or null when no folder was chosen. */
  get: () => kvGet<OwnFolder | null>(FOLDER_KEY, null),
  /** Stores the handle as it is (handles survive IndexedDB's structured clone); null forgets it. */
  set: (folder) => kvSet(FOLDER_KEY, folder),
};

/** What identifies this Xomoni in a folder: the name and version of the running extension. */
export interface RunningXomoni {
  readonly name: string;
  readonly version: string;
}

/** The running extension's name and version, from Chrome. */
export function runningXomoni(): RunningXomoni {
  const { name, version } = chrome.runtime.getManifest();
  return { name, version };
}

/** A `manifest.json` larger than this isn't Xomoni's (it is about 2 KB). */
const MAX_MANIFEST_BYTES = 256 * 1024;

/** The folder's `manifest.json` as an object, or null when there is none or it can't be read as one. */
export async function readFolderManifest(folder: OwnFolder): Promise<Record<string, unknown> | null> {
  try {
    const file = await (await folder.getFileHandle('manifest.json')).getFile();
    if (file.size > MAX_MANIFEST_BYTES) return null;
    return asObject(JSON.parse(await file.text())) ?? null;
  } catch {
    return null;
  }
}

/** What a look at a folder found: this Xomoni (with its manifest), or why not. */
export type FolderCheck =
  | { ok: true; manifest: Record<string, unknown> }
  | { ok: false; why: 'not-xomoni' }
  | { ok: false; why: 'other-version'; version: string };

/**
 * Whether `folder` holds the running Xomoni: a `manifest.json` with this extension's name and exactly its version.
 * Another version is a copy Chrome doesn't run (or one changed since), so it is refused too.
 */
export async function checkOwnFolder(folder: OwnFolder, running: RunningXomoni): Promise<FolderCheck> {
  const manifest = await readFolderManifest(folder);
  if (!manifest || asString(manifest.name) !== running.name) return { ok: false, why: 'not-xomoni' };
  const version = asString(manifest.version) ?? '';
  if (version !== running.version) return { ok: false, why: 'other-version', version };
  return { ok: true, manifest };
}

/** What the dashboard says when the folder chosen isn't this Xomoni's. */
export function folderProblemText(name: string, check: Exclude<FolderCheck, { ok: true }>, current: string): string {
  const where =
    'Choose the folder you loaded Xomoni from: chrome://extensions shows it in Xomoni’s Details, under Source.';
  return check.why === 'not-xomoni'
    ? `“${name}” isn’t Xomoni’s folder: it has no Xomoni manifest.json. ${where}`
    : `“${name}” holds Xomoni ${check.version || 'of another version'}, but this one is ${current}. ${where}`;
}

/** What choosing the folder came to: this Xomoni's folder, kept; or why not (null: closed, or no picker here). */
export type OwnFolderPick = { folder: OwnFolder; problem?: undefined } | { folder?: undefined; problem: string | null };

/**
 * Opens the browser's folder picker for read and write, checks that the folder chosen holds this Xomoni
 * (`checkOwnFolder`) and keeps it. Closing the picker gives `{problem: null}`; a folder Chrome refuses (a system
 * folder) or the wrong one says why, and keeps nothing.
 */
export async function pickOwnFolder(
  store: OwnFolderStore,
  running: RunningXomoni,
  host: PickerHost = window,
): Promise<OwnFolderPick> {
  const picker = host.showDirectoryPicker;
  if (typeof picker !== 'function') return { problem: null };
  let folder: OwnFolder;
  try {
    folder = await picker.call(host, { id: 'xomoni-folder', mode: 'readwrite' });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return { problem: null };
    return { problem: 'Chrome didn’t let Xomoni use that folder. Choose the folder you loaded Xomoni from.' };
  }
  const check = await checkOwnFolder(folder, running);
  if (!check.ok) return { problem: folderProblemText(folder.name, check, running.version) };
  await store.set(folder);
  return { folder };
}

/** Whether Xomoni may write to the folder now: `granted`, `denied`, or a fresh click is needed to ask. */
export type FolderAccess = 'granted' | 'denied' | 'needs-click';

/**
 * Whether Xomoni may write to its folder. Without `ask`, only a permission already granted counts. With it, Chrome
 * shows its own prompt, which needs the click to still be active; after another prompt in the same click (the
 * download permission) it may not be, and the answer is `needs-click`.
 */
export async function folderAccess(folder: OwnFolder, ask: boolean, host: PickerHost = window): Promise<FolderAccess> {
  if (!folder.queryPermission) return 'granted';
  const state = await folder.queryPermission(READ_WRITE);
  if (state === 'granted') return 'granted';
  if (!ask || !folder.requestPermission || host.navigator?.userActivation?.isActive === false) return 'needs-click';
  try {
    return (await folder.requestPermission(READ_WRITE)) === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'needs-click';
  }
}
