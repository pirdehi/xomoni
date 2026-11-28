// A ZIP writer for files people keep (#426, ADR-0044): entry by entry, compressed with the browser's own
// `CompressionStream('deflate-raw')` (or stored, when that is no smaller), each entry's CRC from `zip.ts`, names in
// UTF-8, and ZIP64 records past 65,535 entries or 4 GB, as `zip.ts` reads them. The result is a `Blob` made of the
// parts, never one copy of the whole in memory. Cancelling stops between entries and writes nothing.
import { crc32 } from './zip';

/** One file to put in a ZIP: its path inside it, and its bytes or its text (written as UTF-8). */
export interface ZipWriteEntry {
  path: string;
  data: Uint8Array<ArrayBuffer> | string;
}

/** What `writeZip` takes besides its entries. */
export interface ZipWriteOptions {
  /** Deflate each entry when that makes it smaller (the default), or store every entry as it is. */
  compress?: boolean;
  /** Stops between entries: `writeZip` then throws an `AbortError` and makes no ZIP. */
  signal?: AbortSignal;
  /** The time every entry carries; now when left out. */
  modified?: Date;
  /** Write the ZIP64 end records even for a small ZIP, as a test of them. */
  zip64?: boolean;
  /** Called after each entry with how many were written. */
  onEntry?: (written: number) => void;
}

const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;

/** A little-endian record of `size` bytes, filled by `fill`. */
function record(size: number, fill: (view: DataView) => void): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  fill(new DataView(bytes.buffer));
  return bytes;
}

/** Writes a number up to 2⁵³ as 64 bits, little-endian. */
const u64 = (view: DataView, at: number, value: number) => view.setBigUint64(at, BigInt(value), true);

/** Raw deflate with the browser's own `CompressionStream`. */
async function deflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A date and time as ZIP's MS-DOS fields: time first, then date, in local time from 1980 on. */
function dosTime(date: Date): [number, number] {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return [time, day];
}

/** Throws the `AbortError` a cancelled write ends with. */
function stopIfCancelled(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new DOMException('The ZIP was cancelled before it was written.', 'AbortError');
}

/**
 * Writes `entries` as one ZIP, in their order, and returns it as a `Blob` (`application/zip`). Each entry is deflated
 * when that makes it smaller, and stored otherwise; names are UTF-8. Past 65,535 entries, or 4 GB of data or offsets,
 * the ZIP64 records carry the counts, sizes and offsets. With `signal` aborted, it stops before the next entry and
 * throws an `AbortError`: no ZIP is made.
 */
export async function writeZip(
  entries: AsyncIterable<ZipWriteEntry> | Iterable<ZipWriteEntry>,
  options: ZipWriteOptions = {},
): Promise<Blob> {
  const utf8 = new TextEncoder();
  const [time, date] = dosTime(options.modified ?? new Date());
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  let count = 0;
  for await (const entry of entries) {
    stopIfCancelled(options.signal);
    const data = typeof entry.data === 'string' ? utf8.encode(entry.data) : entry.data;
    const name = utf8.encode(entry.path);
    const crc = crc32(data);
    const deflated = options.compress === false || !data.length ? null : await deflateRaw(data);
    const [stored, method] = deflated && deflated.length < data.length ? [deflated, 8] : [data, 0];
    const big = data.length >= U32_MAX || stored.length >= U32_MAX || offset >= U32_MAX;
    // Sizes past 4 GB live in a ZIP64 extra field: in the local header both sizes, in the directory what overflowed.
    const localExtra = big
      ? record(20, (v) => {
          v.setUint16(0, 0x0001, true);
          v.setUint16(2, 16, true);
          u64(v, 4, data.length);
          u64(v, 12, stored.length);
        })
      : new Uint8Array(0);
    const local = record(30, (v) => {
      v.setUint32(0, 0x04034b50, true);
      v.setUint16(4, big ? 45 : 20, true);
      v.setUint16(6, 0x0800, true);
      v.setUint16(8, method, true);
      v.setUint16(10, time, true);
      v.setUint16(12, date, true);
      v.setUint32(14, crc, true);
      v.setUint32(18, big ? U32_MAX : stored.length, true);
      v.setUint32(22, big ? U32_MAX : data.length, true);
      v.setUint16(26, name.length, true);
      v.setUint16(28, localExtra.length, true);
    });
    parts.push(local, name, localExtra, stored);

    const wide = [data.length >= U32_MAX, stored.length >= U32_MAX, offset >= U32_MAX];
    const wideValues = [data.length, stored.length, offset].filter((_, i) => wide[i]);
    const centralExtra = wideValues.length
      ? record(4 + 8 * wideValues.length, (v) => {
          v.setUint16(0, 0x0001, true);
          v.setUint16(2, 8 * wideValues.length, true);
          wideValues.forEach((value, i) => u64(v, 4 + 8 * i, value));
        })
      : new Uint8Array(0);
    central.push(
      record(46, (v) => {
        v.setUint32(0, 0x02014b50, true);
        v.setUint16(4, 45, true);
        v.setUint16(6, wideValues.length ? 45 : 20, true);
        v.setUint16(8, 0x0800, true);
        v.setUint16(10, method, true);
        v.setUint16(12, time, true);
        v.setUint16(14, date, true);
        v.setUint32(16, crc, true);
        v.setUint32(20, wide[1] ? U32_MAX : stored.length, true);
        v.setUint32(24, wide[0] ? U32_MAX : data.length, true);
        v.setUint16(28, name.length, true);
        v.setUint16(30, centralExtra.length, true);
        v.setUint32(42, wide[2] ? U32_MAX : offset, true);
      }),
      name,
      centralExtra,
    );
    offset += local.length + name.length + localExtra.length + stored.length;
    count++;
    options.onEntry?.(count);
  }
  stopIfCancelled(options.signal);

  const directorySize = central.reduce((sum, part) => sum + part.length, 0);
  const zip64 = options.zip64 === true || count > U16_MAX || offset >= U32_MAX || directorySize >= U32_MAX;
  const ends: Uint8Array<ArrayBuffer>[] = [];
  if (zip64) {
    const recordAt = offset + directorySize;
    ends.push(
      record(56, (v) => {
        v.setUint32(0, 0x06064b50, true);
        u64(v, 4, 44);
        v.setUint16(12, 45, true);
        v.setUint16(14, 45, true);
        u64(v, 24, count);
        u64(v, 32, count);
        u64(v, 40, directorySize);
        u64(v, 48, offset);
      }),
      record(20, (v) => {
        v.setUint32(0, 0x07064b50, true);
        u64(v, 8, recordAt);
        v.setUint32(16, 1, true);
      }),
    );
  }
  ends.push(
    record(22, (v) => {
      v.setUint32(0, 0x06054b50, true);
      v.setUint16(8, zip64 ? U16_MAX : count, true);
      v.setUint16(10, zip64 ? U16_MAX : count, true);
      v.setUint32(12, zip64 ? U32_MAX : directorySize, true);
      v.setUint32(16, zip64 ? U32_MAX : offset, true);
    }),
  );
  return new Blob([...parts, ...central, ...ends], { type: 'application/zip' });
}
