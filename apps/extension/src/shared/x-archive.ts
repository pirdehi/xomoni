// X's archive, asked for by the archive job (#186, ADR-0022): where X's page is, what Xomoni remembers about a
// request, and when the dashboard looks again by itself while X makes the archive. No database here, so the content
// script can use the page's address too.
import { DAY, HOUR } from './time';

/** X's own page for asking for the archive and downloading it. X asks for the password there; Xomoni never sees it. */
export const ARCHIVE_PAGE_URL = 'https://x.com/settings/download_your_data';

/** The path of `ARCHIVE_PAGE_URL`, which the content script checks before it reads or presses anything. */
export const ARCHIVE_PATH = '/settings/download_your_data';

/** How X names its archive: `twitter-2026-11-08-<hash>.zip`, or `x-…` should X rename it. */
export const ARCHIVE_FILE = /^(?:twitter|x)-\d{4}-\d{2}-\d{2}-[\w-]+\.zip$/i;

/**
 * The folder inside Downloads where Chrome saves X's archive for Xomoni (#196). Chrome lets an extension read a
 * folder inside Downloads, never Downloads itself, so the archive can't stay at the top of Downloads.
 */
export const ARCHIVE_FOLDER = 'Xomoni';

/** The note Xomoni saves in the Xomoni folder, which is what makes the folder. */
export const FOLDER_NOTE = 'About this folder.txt';

const NOTE_TEXT = `Xomoni saves X’s archive here (a ZIP named twitter-….zip) and imports it into its Library by itself.
It reads only files named like X’s archive in this folder, and nothing leaves this computer.
You can delete this note. Keep the folder while Xomoni gets your archive.
`;

/**
 * The note's fixed address. The service worker knows the note by it: once Xomoni listens to where downloads go, Chrome
 * forgets the name `downloads.download` gave a file, so the worker names the note itself.
 */
export const FOLDER_NOTE_URL = `data:text/plain;charset=utf-8,${encodeURIComponent(NOTE_TEXT)}`;

/** How long after *Download archive* the dashboard keeps looking for the ZIP, and Chrome keeps saving it for Xomoni. */
export const IMPORT_WINDOW_MS = 12 * HOUR;

/**
 * What the job does on X's archive page. `get`: the person asked for the archive, so it presses *Request archive*
 * when X offers it, or *Download archive* when one is ready. `look`: the dashboard's own look while X makes it, which
 * downloads a ready archive but never asks X for a new one.
 */
export type ArchiveMode = 'get' | 'look';

/** An archive asked for on X, kept per account (in the `kv` table) until Xomoni pressed Download. */
export interface ArchiveRequest {
  /** When X's page first showed the archive being made after Xomoni or the person asked (epoch ms). */
  requestedAt: number;
  /** When the job last looked at X's page (epoch ms). */
  checkedAt: number;
  /** When the job pressed X's *Download archive* (epoch ms), or null while X is still making it. */
  downloadedAt: number | null;
}

/** X takes a day or more to make the archive, so the first look is a day after asking. */
export const FIRST_LOOK_AFTER_MS = DAY;

/** Then one look every six hours, each a single page load. */
export const LOOK_EVERY_MS = 6 * HOUR;

/** After two weeks without an archive, Xomoni stops looking, and the Library asks the person to ask X again. */
export const STOP_LOOKING_AFTER_MS = 14 * DAY;

/**
 * When the dashboard should next look at X's page for the archive (epoch ms), or null when there is nothing to look
 * for: no request, already downloaded, or asked for more than `STOP_LOOKING_AFTER_MS` ago.
 */
export function nextArchiveLook(request: ArchiveRequest | null, now: number): number | null {
  if (!request || request.downloadedAt != null) return null;
  if (now - request.requestedAt > STOP_LOOKING_AFTER_MS) return null;
  return Math.max(request.requestedAt + FIRST_LOOK_AFTER_MS, request.checkedAt + LOOK_EVERY_MS);
}

/** Whether Xomoni gave up looking for an archive X never made (`STOP_LOOKING_AFTER_MS`). */
export function archiveOverdue(request: ArchiveRequest | null, now: number): boolean {
  return !!request && request.downloadedAt == null && now - request.requestedAt > STOP_LOOKING_AFTER_MS;
}

/**
 * Whether Xomoni is waiting for X's archive to land in Downloads: an archive asked for and not yet downloaded, or
 * downloaded less than `IMPORT_WINDOW_MS` ago, for any account, or the Xomoni folder chosen for the import.
 */
export function expectsArchive(requests: readonly ArchiveRequest[], folderChosen: boolean, now: number): boolean {
  if (folderChosen) return true;
  return requests.some((r) => r.downloadedAt == null || now - r.downloadedAt <= IMPORT_WINDOW_MS);
}

/**
 * Where Chrome should save a download, relative to Downloads (#196): `Xomoni/<name>` for a file named like X's
 * archive while Xomoni expects one, or null to leave it where Chrome would put it. Only the file's name is looked at.
 */
export function archiveDownloadPath(filename: string, expecting: boolean): string | null {
  const name = filename.split(/[\\/]/).pop() ?? '';
  return expecting && ARCHIVE_FILE.test(name) ? `${ARCHIVE_FOLDER}/${name}` : null;
}
