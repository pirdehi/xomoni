// Reading a downloaded release (#305, ADR-0033), after its signature checked out: every file of the zip, each path
// checked before anything is written (no `..`, no absolute path, no backslash, nothing a file system could read another
// way), within size limits, and the manifest checked against the release asked for. The zip is read in memory with
// the same reader as X's archive (`shared/zip.ts`), which refuses damaged entries, ZIP bombs and bad CRCs.
import { asArray, asObject, asString } from '../shared/json';
import { type ZipEntry, listZip, readZipEntry } from '../shared/zip';
import { UpdateFailure } from './problems';

/** The most files a release may hold; Xomoni's has a few dozen. */
export const MAX_RELEASE_FILES = 1000;

/** The most a release may weigh unzipped, in bytes; Xomoni's is about 2 MB. */
export const MAX_RELEASE_UNZIPPED = 64 * 1024 * 1024;

const MAX_PATH = 200;
const MAX_DEPTH = 6;
const MAX_SEGMENT = 100;
/** Letters, digits, `.`, `_` and `-`, starting with a letter or digit: what Vite and the icons script write. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** Names Windows keeps for devices, with or without an extension. */
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/** One file of a release: where it goes in Xomoni's folder, `/`-separated, and its bytes. */
export interface ReleaseFile {
  readonly path: string;
  readonly data: Uint8Array;
}

/** A release read and checked: its version, its manifest's `key` (null without one), its manifest and its files. */
export interface ReleasePackage {
  readonly version: string;
  readonly key: string | null;
  /** The release's `manifest.json`, parsed, for what it asks of Chrome (`manifest-access.ts`, `minimumChrome`). */
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly files: readonly ReleaseFile[];
}

/**
 * The major Chrome version a manifest's `minimum_chrome_version` asks for (`"137"` or `"137.0.7151"`), or null when it
 * asks for none. A value that can't be read asks for every version there is, so it never passes by mistake.
 */
export function minimumChrome(manifest: Readonly<Record<string, unknown>>): number | null {
  const value = manifest.minimum_chrome_version;
  if (value === undefined) return null;
  const major = typeof value === 'string' ? /^(\d{1,4})(\.\d+){0,3}$/.exec(value)?.[1] : undefined;
  return major === undefined ? Number.POSITIVE_INFINITY : Number(major);
}

/**
 * Whether `path`, from a zip, may be written inside Xomoni's folder: relative, `/`-separated, at most six levels and
 * 200 characters, each part letters, digits, `.`, `_` and `-` that starts with a letter or digit (so never `.`, `..`
 * or a hidden name), doesn't end with a dot and isn't a Windows device name. `_locales` is allowed as the first part,
 * the one folder Chrome lets an extension start with `_`. Anything else is refused, not cleaned up.
 */
export function safePath(path: string): boolean {
  if (!path || path.length > MAX_PATH) return false;
  const parts = path.split('/');
  if (parts.length > MAX_DEPTH) return false;
  return parts.every(
    (part, i) =>
      (i === 0 && part === '_locales' && parts.length > 1) ||
      (part.length <= MAX_SEGMENT && SEGMENT.test(part) && !part.endsWith('.') && !RESERVED.test(part)),
  );
}

/** Refuses the package, saying why for the log. */
function refuse(detail: string): never {
  throw new UpdateFailure('bad-package', detail);
}

/** Refuses two paths a case-insensitive file system would mix up, and a file that is also a folder of another. */
function checkLayout(paths: readonly string[]) {
  const files = new Set<string>();
  for (const path of paths) {
    const lower = path.toLowerCase();
    if (files.has(lower)) refuse(`two files at ${path}`);
    files.add(lower);
  }
  for (const path of paths) {
    const parts = path.toLowerCase().split('/');
    for (let i = 1; i < parts.length; i++) {
      if (files.has(parts.slice(0, i).join('/'))) refuse(`${path} is inside a file`);
    }
  }
}

/** The scripts a manifest names, which must ship in the package for Chrome to load it. */
function namedScripts(manifest: Record<string, unknown>): string[] {
  const worker = asString(asObject(manifest.background)?.service_worker);
  const content = asArray(manifest.content_scripts).flatMap((script) => asArray(asObject(script)?.js));
  return [worker, ...content].filter((path): path is string => typeof path === 'string');
}

/**
 * Reads and checks the release zip for `version`: every path safe (`safePath`) and distinct, at most
 * `MAX_RELEASE_FILES` files and `MAX_RELEASE_UNZIPPED` bytes, each entry's size and CRC as the zip says, a
 * `manifest.json` at the top for Manifest V3 and exactly `version`, and the scripts it names inside. Throws
 * `UpdateFailure` (`bad-package`, or `wrong-version` for another version) before anything is written.
 */
export async function readRelease(zip: Blob, version: string): Promise<ReleasePackage> {
  let entries: ZipEntry[];
  try {
    entries = await listZip(zip);
  } catch (err) {
    refuse(err instanceof Error ? err.message : String(err));
  }
  if (!entries.length || entries.length > MAX_RELEASE_FILES) refuse(`${entries.length} files`);
  for (const entry of entries) if (!safePath(entry.path)) refuse(`unsafe path ${JSON.stringify(entry.path)}`);
  checkLayout(entries.map((entry) => entry.path));
  const declared = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (declared > MAX_RELEASE_UNZIPPED) refuse(`${declared} bytes unzipped`);

  const files: ReleaseFile[] = [];
  for (const entry of entries) {
    try {
      files.push({ path: entry.path, data: await readZipEntry(zip, entry) });
    } catch (err) {
      refuse(err instanceof Error ? err.message : String(err));
    }
  }

  const manifestFile = files.find((file) => file.path === 'manifest.json');
  if (!manifestFile) refuse('no manifest.json at the top');
  let manifest: Record<string, unknown> | undefined;
  try {
    manifest = asObject(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestFile.data)));
  } catch {
    manifest = undefined;
  }
  if (!manifest) refuse('manifest.json is not a JSON object');
  if (manifest.manifest_version !== 3) refuse('not Manifest V3');
  const found = asString(manifest.version);
  if (found !== version) throw new UpdateFailure('wrong-version', `the zip says ${String(found)}`);
  const paths = new Set(files.map((file) => file.path));
  for (const script of namedScripts(manifest)) if (!paths.has(script)) refuse(`${script} is missing`);
  return { version, key: typeof manifest.key === 'string' ? manifest.key : null, manifest, files };
}
