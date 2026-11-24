import { describe, expect, it, vi } from 'vitest';
import { writeZip } from '../src/shared/zip-write';
import { crc32, listZip, readZipEntry } from '../src/shared/zip';

// The ZIP writer (#426, CV.4.1, ADR-0044): what it writes, Xomoni's own reader reads back, and so does a reader written
// here from the ZIP format alone, inflating with the platform's zlib; ZIP64 past 65,535 entries; cancelling.

const utf8 = new TextEncoder();
const text = new TextDecoder();

/** Inflates raw deflate with the platform's own zlib (`DecompressionStream`). */
async function inflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Reads a ZIP from its local headers, front to back, as the format describes them: an independent check of what
 * `writeZip` writes, apart from Xomoni's reader, which reads the central directory.
 */
async function readFromTheFront(zip: Blob): Promise<{ path: string; method: number; data: Uint8Array }[]> {
  const bytes = new Uint8Array(await zip.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const out: { path: string; method: number; data: Uint8Array }[] = [];
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const method = view.getUint16(at + 8, true);
    const crc = view.getUint32(at + 14, true);
    const stored = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const extraLength = view.getUint16(at + 28, true);
    const path = text.decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const start = at + 30 + nameLength + extraLength;
    const raw = bytes.slice(start, start + stored);
    const data = method === 8 ? await inflate(raw) : raw;
    expect(crc32(data), path).toBe(crc);
    out.push({ path, method, data });
    at = start + stored;
  }
  expect(view.getUint32(at, true)).toBe(0x02014b50);
  return out;
}

describe('writeZip', () => {
  const entries = [
    { path: 'README.txt', data: 'Read me first.\r\n'.repeat(50) },
    { path: 'données/ünïcödé 名前.csv', data: 'a,b\r\n1,2\r\n' },
    { path: 'empty.json', data: '' },
    { path: 'noise.bin', data: crypto.getRandomValues(new Uint8Array(300)) },
  ];

  it('writes a ZIP Xomoni’s own reader reads back, every entry whole', async () => {
    const zip = await writeZip(entries);
    expect(zip.type).toBe('application/zip');
    const listed = await listZip(zip);
    expect(listed.map((e) => e.path)).toEqual(entries.map((e) => e.path));
    for (const [i, entry] of listed.entries()) {
      const want = entries[i]!.data;
      const got = await readZipEntry(zip, entry);
      expect(got).toEqual(typeof want === 'string' ? utf8.encode(want) : want);
    }
  });

  it('is read the same from the front with the platform’s zlib, deflating only where that is smaller', async () => {
    const read = await readFromTheFront(await writeZip(entries));
    expect(read.map((r) => r.path)).toEqual(entries.map((e) => e.path));
    expect(text.decode(read[0]!.data)).toBe(entries[0]!.data);
    // Repeated text shrinks; an empty file, a short one and random bytes are stored as they are.
    expect(read.map((r) => r.method)).toEqual([8, 0, 0, 0]);
    const stored = await readFromTheFront(await writeZip(entries, { compress: false }));
    expect(stored.every((r) => r.method === 0)).toBe(true);
  });

  it('names entries in UTF-8, and stamps them with the time given', async () => {
    const zip = await writeZip([{ path: 'é.txt', data: 'x' }], { modified: new Date(2026, 10, 24, 13, 45, 30) });
    const view = new DataView(await zip.arrayBuffer());
    expect(view.getUint16(6, true) & 0x0800).toBe(0x0800);
    expect(view.getUint16(10, true)).toBe((13 << 11) | (45 << 5) | 15);
    expect(view.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (11 << 5) | 24);
  });

  it('writes the ZIP64 records past 65,535 entries, which Xomoni’s reader follows', async () => {
    const many = Array.from({ length: 65_540 }, (_, i) => ({ path: `f/${String(i)}`, data: 'x' }));
    const zip = await writeZip(many, { compress: false });
    const tail = new DataView(await zip.slice(zip.size - 22).arrayBuffer());
    expect(tail.getUint16(10, true)).toBe(0xffff);
    expect(tail.getUint32(16, true)).toBe(0xffffffff);
    const listed = await listZip(zip);
    expect(listed).toHaveLength(65_540);
    expect(text.decode(await readZipEntry(zip, listed.at(-1)!))).toBe('x');
  }, 60_000);

  it('writes the ZIP64 records on request for a small ZIP too', async () => {
    const zip = await writeZip(entries, { zip64: true });
    expect((await listZip(zip)).map((e) => e.path)).toEqual(entries.map((e) => e.path));
  });

  it('takes entries one at a time from an async source, and says how many it wrote', async () => {
    async function* source() {
      for (const entry of entries) yield entry;
    }
    const onEntry = vi.fn((_written: number) => undefined);
    await writeZip(source(), { onEntry });
    expect(onEntry.mock.calls.map(([n]) => n)).toEqual([1, 2, 3, 4]);
  });

  it('makes no ZIP when cancelled, between entries', async () => {
    const controller = new AbortController();
    const err = await writeZip(entries, {
      signal: controller.signal,
      onEntry: (n) => {
        if (n === 2) controller.abort();
      },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe('AbortError');
    controller.abort();
    await expect(writeZip([], { signal: controller.signal })).rejects.toThrow('cancelled');
  });

  it('writes an empty ZIP that reads as no entries', async () => {
    expect(await listZip(await writeZip([]))).toEqual([]);
  });
});
