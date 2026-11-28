// `data/manifest.js` of X's archive (#424, ADR-0043): `window.__THAR_CONFIG = { … }`, which says when X made the
// archive, whether it is only part of the account's data, its size, and how many of each kind of data it holds. Read
// tolerantly: X changes the file without notice, so a field Xomoni doesn't know is ignored, and one in the wrong shape
// is read as unknown. Pure; safe for the content script.
import { isHandle, isXId } from '../ids';
import { asArray, asNumber, asObject, asString, at } from '../json';

/** What Xomoni reads from the manifest. Anything the file doesn't say, or says in a shape Xomoni doesn't know, is null. */
export interface ArchiveManifest {
  /** When X made the archive (epoch ms). */
  generationDate: number | null;
  /** Whether X says the archive holds only part of the account's data. */
  isPartialArchive: boolean | null;
  /** The archive's size as X counts it, in bytes. */
  sizeBytes: number | null;
  /** How many of each kind of data the archive holds, by X's name for it (`tweets`, `like`, `follower`, …). */
  counts: Record<string, number>;
  /** The account X made it for, as the manifest names it. */
  accountId: string | null;
  userName: string | null;
}

/** The largest manifest Xomoni reads: X's is a few tens of kilobytes. */
export const MAX_MANIFEST_BYTES = 1024 * 1024;

/** A name X gives a kind of data: letters, digits, `_` and `-`, so a name can never carry markup into a page. */
const TYPE_NAME = /^[A-Za-z0-9_-]{1,60}$/;

/** A whole number of 0 or more, from a number or X's numeric text, or null. */
function count(value: unknown): number | null {
  const n = asNumber(value);
  return n !== undefined && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/**
 * Reads the text of `data/manifest.js` (`window.__THAR_CONFIG = { … }`, with or without a closing `;`), or null when it
 * isn't one: no `=`, JSON that doesn't parse, or not an object. A kind of data counts the files X lists for it, summed;
 * an unknown field is ignored.
 */
export function parseThar(text: string): ArchiveManifest | null {
  const start = text.indexOf('=');
  if (start < 0 || !/__THAR_CONFIG\s*$/.test(text.slice(0, start))) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      text
        .slice(start + 1)
        .trim()
        .replace(/;\s*$/, ''),
    );
  } catch {
    return null;
  }
  const config = asObject(parsed);
  if (!config) return null;
  const info = asObject(config.archiveInfo);
  const generated = Date.parse(asString(info?.generationDate) ?? '');
  const partial = info?.isPartialArchive;
  const counts: Record<string, number> = {};
  for (const [type, value] of Object.entries(asObject(config.dataTypes) ?? {})) {
    if (!TYPE_NAME.test(type)) continue;
    let total: number | null = null;
    for (const file of asArray(asObject(value)?.files)) {
      const n = count(asObject(file)?.count);
      if (n !== null) total = (total ?? 0) + n;
    }
    if (total !== null) counts[type] = total;
  }
  const accountId = asString(at(config, 'userInfo', 'accountId'));
  const userName = asString(at(config, 'userInfo', 'userName'));
  return {
    generationDate: Number.isFinite(generated) && generated > 0 ? generated : null,
    isPartialArchive:
      typeof partial === 'boolean' ? partial : partial === 'true' ? true : partial === 'false' ? false : null,
    sizeBytes: count(info?.sizeBytes),
    counts,
    accountId: accountId && isXId(accountId) ? accountId : null,
    userName: userName && isHandle(userName) ? userName : null,
  };
}
