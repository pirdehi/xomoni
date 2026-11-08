import { crc32 } from '../../src/shared/zip';

/** One file to put in a test ZIP, with knobs to make it lie or break. */
export interface ZipSpec {
  path: string;
  data: string | Uint8Array<ArrayBuffer>;
  /** 0 stored, 8 deflate (default), or any other number to test an unknown method. */
  method?: number;
  encrypted?: boolean;
  /** The inflated size the ZIP claims, when it should lie. */
  declaredSize?: number;
  /** The CRC the ZIP claims, when it should be wrong. */
  crc?: number;
  /** Bytes stored in place of the compressed data. */
  rawData?: Uint8Array<ArrayBuffer>;
}

/** A growable little-endian byte writer. */
class Bytes {
  private parts: number[] = [];
  get length() {
    return this.parts.length;
  }
  u16(v: number) {
    this.parts.push(v & 0xff, (v >>> 8) & 0xff);
  }
  u32(v: number) {
    for (let i = 0; i < 4; i++) this.parts.push((v >>> (8 * i)) & 0xff);
  }
  u64(v: number) {
    const big = BigInt(v);
    for (let i = 0n; i < 8n; i++) this.parts.push(Number((big >> (8n * i)) & 0xffn));
  }
  raw(data: Uint8Array) {
    for (const b of data) this.parts.push(b);
  }
  done() {
    return Uint8Array.from(this.parts);
  }
}

const utf8 = (s: string) => new TextEncoder().encode(s);

/** Raw deflate, with the browser's own `CompressionStream`, as X's ZIP is written. */
async function deflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Builds a ZIP in memory, the way X's archive is laid out: local headers and data, then the central directory and
 * its end record, optionally ZIP64 (sizes and offsets moved to the extra field) and with a trailing comment.
 */
export async function buildZip(
  files: ZipSpec[],
  options: { comment?: string; zip64?: boolean } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Bytes();
  const central = new Bytes();
  for (const spec of files) {
    const data = typeof spec.data === 'string' ? utf8(spec.data) : spec.data;
    const method = spec.method ?? 8;
    const stored = spec.rawData ?? (method === 8 ? await deflateRaw(data) : data);
    const name = utf8(spec.path);
    const crc = spec.crc ?? crc32(data);
    const size = spec.declaredSize ?? data.length;
    const flags = (spec.encrypted ? 1 : 0) | 0x800;
    const offset = out.length;

    out.u32(0x04034b50);
    out.u16(20);
    out.u16(flags);
    out.u16(method);
    out.u32(0);
    out.u32(crc);
    out.u32(stored.length);
    out.u32(size);
    out.u16(name.length);
    out.u16(0);
    out.raw(name);
    out.raw(stored);

    central.u32(0x02014b50);
    central.u16(45);
    central.u16(20);
    central.u16(flags);
    central.u16(method);
    central.u32(0);
    central.u32(crc);
    central.u32(options.zip64 ? 0xffffffff : stored.length);
    central.u32(options.zip64 ? 0xffffffff : size);
    central.u16(name.length);
    central.u16(options.zip64 ? 28 : 0);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u32(0);
    central.u32(options.zip64 ? 0xffffffff : offset);
    central.raw(name);
    if (options.zip64) {
      central.u16(0x0001);
      central.u16(24);
      central.u64(size);
      central.u64(stored.length);
      central.u64(offset);
    }
  }
  const directoryAt = out.length;
  const directory = central.done();
  out.raw(directory);

  if (options.zip64) {
    const recordAt = out.length;
    out.u32(0x06064b50);
    out.u64(44);
    out.u16(45);
    out.u16(45);
    out.u32(0);
    out.u32(0);
    out.u64(files.length);
    out.u64(files.length);
    out.u64(directory.length);
    out.u64(directoryAt);
    out.u32(0x07064b50);
    out.u32(0);
    out.u64(recordAt);
    out.u32(1);
  }
  const comment = utf8(options.comment ?? '');
  out.u32(0x06054b50);
  out.u16(0);
  out.u16(0);
  out.u16(options.zip64 ? 0xffff : files.length);
  out.u16(options.zip64 ? 0xffff : files.length);
  out.u32(options.zip64 ? 0xffffffff : directory.length);
  out.u32(options.zip64 ? 0xffffffff : directoryAt);
  out.u16(comment.length);
  out.raw(comment);
  return out.done();
}

/** A test ZIP as a `File`, as the person would drop or choose it. */
export async function zipFile(
  files: ZipSpec[],
  name = 'twitter-2026-11-08-abc.zip',
  options?: { zip64?: boolean },
): Promise<File> {
  return new File([await buildZip(files, options)], name, { type: 'application/zip' });
}
