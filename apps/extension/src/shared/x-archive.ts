// X's archive, asked for by the archive job (#186, ADR-0022): where X's page is, what Xomoni remembers about a
// request, and when the dashboard looks again by itself while X makes the archive. No database here, so the content
// script can use the page's address too.
import { DAY, HOUR } from './time';

/** X's own page for asking for the archive and downloading it. X asks for the password there; Xomoni never sees it. */
export const ARCHIVE_PAGE_URL = 'https://x.com/settings/download_your_data';

/** The path of `ARCHIVE_PAGE_URL`, which the content script checks before it reads or presses anything. */
export const ARCHIVE_PATH = '/settings/download_your_data';

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
