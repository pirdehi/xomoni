// A ZIP reader for X's archive (#184). It reads the central directory at the end of the file and only the entries
// asked for, through `Blob.slice`, so an archive of several gigabytes opens in moments and its photos and videos are
// never read. Deflate is undone by the browser's own `DecompressionStream`. Every size and offset in the file is
// checked against the file itself before it is used, and a damaged or hostile ZIP is refused with `ZipError`.

/** One file inside a ZIP, as its central directory describes it. */
export interface ZipEntry {
  /** Path inside the ZIP, `/`-separated, for example `data/tweets.js`. */
  readonly path: string;
  /** Size once inflated, as declared; reading checks the real size against it. */
  readonly size: number;
  /** Size as stored in the ZIP. */
  readonly compressedSize: number;
  /** 0 when stored as is, 8 for deflate; any other method can't be read. */
  readonly method: number;
  /** CRC-32 of the inflated bytes, checked after reading. */
  readonly crc32: number;
  /** Whether the entry is encrypted; such entries can't be read. */
  readonly encrypted: boolean;
  /** Where the entry's local header starts in the ZIP. */
  readonly offset: number;
}

/** Why a ZIP or one of its entries can't be read; the message says so in words a person understands. */
export class ZipError extends Error {
  override name = 'ZipError';
}

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;
const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;

/**
 * The largest central directory read. An X archive with a hundred thousand photos needs about 10 MB; a larger one
 * is not X's archive, and reading it would only exhaust memory.
 */
export const MAX_ZIP_DIRECTORY_BYTES = 64 * 1024 * 1024;

/** The largest entry inflated; an X archive's largest file is a few hundred megabytes. */
export const MAX_ZIP_ENTRY_BYTES = 1024 * 1024 * 1024;

const DAMAGED = 'This ZIP file is damaged or incomplete. Download it again from X.';

async function bytes(blob: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await blob.slice(start, end).arrayBuffer());
}

function u64(view: DataView, at: number): number {
  const value = view.getBigUint64(at, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipError(DAMAGED);
  return Number(value);
}

/** Where the central directory is, and how many entries it holds, from the end records. */
async function findDirectory(zip: Blob): Promise<{ offset: number; size: number; count: number }> {
  if (zip.size < EOCD_SIZE) throw new ZipError('This is not a ZIP file.');
  const tailStart = Math.max(0, zip.size - EOCD_SIZE - MAX_COMMENT);
  const tail = await bytes(zip, tailStart, zip.size);
  let at = -1;
  // The end record is the last one whose comment runs exactly to the end of the file.
  for (let i = tail.byteLength - EOCD_SIZE; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD && i + EOCD_SIZE + tail.getUint16(i + 20, true) === tail.byteLength) {
      at = i;
      break;
    }
  }
  if (at < 0) throw new ZipError('This is not a ZIP file.');
  let count = tail.getUint16(at + 10, true);
  let size = tail.getUint32(at + 12, true);
  let offset = tail.getUint32(at + 16, true);
  const eocdAt = tailStart + at;
  let directoryEnd = eocdAt;

  if (count === U16_MAX || size === U32_MAX || offset === U32_MAX) {
    if (eocdAt < 20) throw new ZipError(DAMAGED);
    const locator = await bytes(zip, eocdAt - 20, eocdAt);
    if (locator.getUint32(0, true) !== ZIP64_LOCATOR) throw new ZipError(DAMAGED);
    const recordAt = u64(locator, 8);
    if (recordAt + 56 > eocdAt - 20) throw new ZipError(DAMAGED);
    const record = await bytes(zip, recordAt, recordAt + 56);
    if (record.getUint32(0, true) !== ZIP64_EOCD) throw new ZipError(DAMAGED);
    count = u64(record, 32);
    size = u64(record, 40);
    offset = u64(record, 48);
    directoryEnd = recordAt;
  }
  if (size > MAX_ZIP_DIRECTORY_BYTES) throw new ZipError('This ZIP lists too many files to be an X archive.');
  if (offset + size > directoryEnd) throw new ZipError(DAMAGED);
  return { offset, size, count };
}

/** Reads the ZIP64 extra field of a central directory record, for the values that overflowed 32 bits. */
function zip64Values(
  view: DataView,
  start: number,
  length: number,
  want: { size: boolean; compressedSize: boolean; offset: boolean },
) {
  const found: { size?: number; compressedSize?: number; offset?: number } = {};
  let at = start;
  while (at + 4 <= start + length) {
    const id = view.getUint16(at, true);
    const fieldLength = view.getUint16(at + 2, true);
    const body = at + 4;
    if (body + fieldLength > start + length) throw new ZipError(DAMAGED);
    if (id === 0x0001) {
      let cursor = body;
      const take = () => {
        if (cursor + 8 > body + fieldLength) throw new ZipError(DAMAGED);
        const value = u64(view, cursor);
        cursor += 8;
        return value;
      };
      if (want.size) found.size = take();
      if (want.compressedSize) found.compressedSize = take();
      if (want.offset) found.offset = take();
      return found;
    }
    at = body + fieldLength;
  }
  throw new ZipError(DAMAGED);
}

/**
 * Lists the files in a ZIP from its central directory, without reading any of them. Folders are left out.
 * Throws `ZipError` when the file is not a ZIP or its directory doesn't fit inside it.
 */
export async function listZip(zip: Blob): Promise<ZipEntry[]> {
  const { offset, size, count } = await findDirectory(zip);
  const view = await bytes(zip, offset, offset + size);
  const names = new TextDecoder('utf-8');
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > view.byteLength || view.getUint32(at, true) !== CENTRAL) throw new ZipError(DAMAGED);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc32 = view.getUint32(at + 16, true);
    let compressedSize = view.getUint32(at + 20, true);
    let entrySize = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    let localOffset = view.getUint32(at + 42, true);
    const next = at + 46 + nameLength + extraLength + commentLength;
    if (next > view.byteLength) throw new ZipError(DAMAGED);
    const path = names.decode(new Uint8Array(view.buffer, view.byteOffset + at + 46, nameLength));

    const want = {
      size: entrySize === U32_MAX,
      compressedSize: compressedSize === U32_MAX,
      offset: localOffset === U32_MAX,
    };
    if (want.size || want.compressedSize || want.offset) {
      const wide = zip64Values(view, at + 46 + nameLength, extraLength, want);
      entrySize = wide.size ?? entrySize;
      compressedSize = wide.compressedSize ?? compressedSize;
      localOffset = wide.offset ?? localOffset;
    }
    if (localOffset + compressedSize > offset) throw new ZipError(DAMAGED);
    if (!path.endsWith('/')) {
      entries.push({
        path,
        size: entrySize,
        compressedSize,
        method,
        crc32,
        encrypted: (flags & 1) === 1,
        offset: localOffset,
      });
    }
    at = next;
  }
  return entries;
}

let crcTable: Uint32Array | undefined;

/** CRC-32 (IEEE), as ZIP uses it. */
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
  }
  const table = crcTable;
  let crc = 0xffffffff;
  for (const byte of data) crc = (table[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Reads one entry's bytes, inflated. Refuses an encrypted entry or an unknown method, and stops as soon as the
 * inflated bytes outgrow the declared size, so a ZIP bomb is never inflated whole. The CRC is checked at the end.
 */
export async function readZipEntry(zip: Blob, entry: ZipEntry): Promise<Uint8Array> {
  if (entry.encrypted) throw new ZipError(`${entry.path} is encrypted, and Xomoni can't read it.`);
  if (entry.method !== 0 && entry.method !== 8) {
    throw new ZipError(`${entry.path} is compressed in a way Xomoni can't read.`);
  }
  if (entry.size > MAX_ZIP_ENTRY_BYTES) throw new ZipError(`${entry.path} is too large to read.`);
  if (entry.offset + 30 > zip.size) throw new ZipError(DAMAGED);
  const local = await bytes(zip, entry.offset, entry.offset + 30);
  if (local.getUint32(0, true) !== LOCAL) throw new ZipError(DAMAGED);
  const start = entry.offset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
  const end = start + entry.compressedSize;
  if (end > zip.size) throw new ZipError(DAMAGED);
  const stored = zip.slice(start, end);

  let out: Uint8Array;
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.size) throw new ZipError(DAMAGED);
    out = new Uint8Array(await stored.arrayBuffer());
  } else {
    out = new Uint8Array(entry.size);
    let filled = 0;
    const reader = stored.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (filled + value.byteLength > entry.size) {
          throw new ZipError(`${entry.path} is larger than the ZIP says. Nothing was imported.`);
        }
        out.set(value, filled);
        filled += value.byteLength;
      }
    } catch (err) {
      await reader.cancel().catch(() => undefined);
      if (err instanceof ZipError) throw err;
      throw new ZipError(DAMAGED);
    }
    if (filled !== entry.size) throw new ZipError(DAMAGED);
  }
  if (crc32(out) !== entry.crc32) throw new ZipError(DAMAGED);
  return out;
}

/** Whether a file starts like a ZIP (`PK\x03\x04`), whatever its name says. */
export async function looksLikeZip(file: Blob): Promise<boolean> {
  if (file.size < 4) return false;
  return (await bytes(file, 0, 4)).getUint32(0, true) === LOCAL;
}
