import { describe, expect, it } from 'vitest';
import {
  MAX_ZIP_DIRECTORY_BYTES,
  MAX_ZIP_ENTRY_BYTES,
  ZipError,
  crc32,
  listZip,
  looksLikeZip,
  readZipEntry,
} from '../src/shared/zip';
import { type ZipSpec, buildZip } from './support/zip';

const blob = (bytes: Uint8Array<ArrayBuffer>) => new Blob([bytes]);
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const DAMAGED = 'This ZIP file is damaged or incomplete. Download it again from X.';

/** Reads every file of a ZIP into `{ path: text }`. */
async function readAll(bytes: Uint8Array<ArrayBuffer>) {
  const zip = blob(bytes);
  const out: Record<string, string> = {};
  for (const entry of await listZip(zip)) out[entry.path] = text(await readZipEntry(zip, entry));
  return out;
}

/** The one entry of a one-file ZIP, read. */
async function readOnly(spec: ZipSpec) {
  const zip = blob(await buildZip([spec]));
  const [entry] = await listZip(zip);
  if (!entry) throw new Error('no entry');
  return readZipEntry(zip, entry);
}

describe('the ZIP reader (#184)', () => {
  it('lists files without folders and reads stored and deflated ones, with UTF-8 names', async () => {
    const zip = await buildZip([
      { path: 'data/', data: '', method: 0 },
      { path: 'data/tweets.js', data: 'window.YTD.tweets.part0 = []'.repeat(50) },
      { path: 'data/account.js', data: 'stored as is', method: 0 },
      { path: 'data/پست.js', data: 'نام فارسی' },
    ]);

    expect((await listZip(blob(zip))).map((e) => e.path)).toEqual(['data/tweets.js', 'data/account.js', 'data/پست.js']);
    expect(await readAll(zip)).toEqual({
      'data/tweets.js': 'window.YTD.tweets.part0 = []'.repeat(50),
      'data/account.js': 'stored as is',
      'data/پست.js': 'نام فارسی',
    });
  });

  it('finds the directory behind a comment', async () => {
    expect(
      await readAll(await buildZip([{ path: 'a.txt', data: 'hello' }], { comment: 'PK\u0005\u0006 not the end' })),
    ).toEqual({
      'a.txt': 'hello',
    });
  });

  it('reads ZIP64, as large archives are written', async () => {
    const zip = await buildZip(
      [
        { path: 'data/like.js', data: 'likes' },
        { path: 'data/tweets.js', data: 'tweets' },
      ],
      { zip64: true },
    );
    const entries = await listZip(blob(zip));
    expect(entries.map((e) => [e.path, e.size])).toEqual([
      ['data/like.js', 5],
      ['data/tweets.js', 6],
    ]);
    expect(await readAll(zip)).toEqual({ 'data/like.js': 'likes', 'data/tweets.js': 'tweets' });
  });

  it.each([
    ['an empty file', new Uint8Array()],
    ['a short file', new Uint8Array([0x50, 0x4b])],
    ['a file that is not a ZIP', new TextEncoder().encode('window.YTD.tweets.part0 = []'.repeat(10))],
  ])('says %s is not a ZIP', async (_, bytes) => {
    await expect(listZip(blob(bytes))).rejects.toThrow(new ZipError('This is not a ZIP file.'));
  });

  it('refuses an encrypted entry and an unknown compression method', async () => {
    await expect(readOnly({ path: 'secret.js', data: 'x', encrypted: true })).rejects.toThrow(
      "secret.js is encrypted, and Xomoni can't read it.",
    );
    await expect(readOnly({ path: 'bz.js', data: 'x', method: 12, rawData: new Uint8Array(4) })).rejects.toThrow(
      "bz.js is compressed in a way Xomoni can't read.",
    );
  });

  it('stops inflating once the bytes outgrow the size the ZIP declared (a ZIP bomb)', async () => {
    await expect(readOnly({ path: 'bomb.js', data: 'a'.repeat(100_000), declaredSize: 10 })).rejects.toThrow(
      'bomb.js is larger than the ZIP says. Nothing was imported.',
    );
  });

  it('refuses an entry declared larger than it reads, before reading it', async () => {
    await expect(
      readOnly({ path: 'huge.js', data: 'x', declaredSize: MAX_ZIP_ENTRY_BYTES + 1, rawData: new Uint8Array(1) }),
    ).rejects.toThrow('huge.js is too large to read.');
  });

  it.each<[string, ZipSpec]>([
    ['shorter than declared', { path: 'a.js', data: 'abc', declaredSize: 10 }],
    ['stored with a size that differs from its data', { path: 'a.js', data: 'abc', method: 0, declaredSize: 4 }],
    ['with a wrong CRC', { path: 'a.js', data: 'abc', crc: 1234 }],
    ['with broken deflate data', { path: 'a.js', data: 'abc', rawData: new Uint8Array([0xff, 0xff, 0xff, 0xff]) }],
  ])('calls an entry %s damaged', async (_, spec) => {
    await expect(readOnly(spec)).rejects.toThrow(new ZipError(DAMAGED));
  });

  it('calls a ZIP damaged when its records point outside the file or lie about their count', async () => {
    const good = await buildZip([{ path: 'a.js', data: 'abc' }]);
    const eocd = good.length - 22;

    const farDirectory = good.slice();
    new DataView(farDirectory.buffer).setUint32(eocd + 16, good.length + 100, true);
    await expect(listZip(blob(farDirectory))).rejects.toThrow(DAMAGED);

    const moreEntries = good.slice();
    new DataView(moreEntries.buffer).setUint16(eocd + 10, 2, true);
    await expect(listZip(blob(moreEntries))).rejects.toThrow(DAMAGED);

    const badLocal = good.slice();
    new DataView(badLocal.buffer).setUint32(0, 0, true);
    const [entry] = await listZip(blob(badLocal));
    if (!entry) throw new Error('no entry');
    await expect(readZipEntry(blob(badLocal), entry)).rejects.toThrow(DAMAGED);

    const noLocator = good.slice();
    new DataView(noLocator.buffer).setUint16(eocd + 10, 0xffff, true);
    await expect(listZip(blob(noLocator))).rejects.toThrow(DAMAGED);
  });

  it('refuses a directory far larger than an X archive has', async () => {
    const good = await buildZip([{ path: 'a.js', data: 'abc' }]);
    const view = new DataView(good.buffer);
    view.setUint32(good.length - 22 + 12, MAX_ZIP_DIRECTORY_BYTES + 1, true);
    await expect(listZip(blob(good))).rejects.toThrow('This ZIP lists too many files to be an X archive.');
  });

  it('tells a ZIP by its first bytes', async () => {
    expect(await looksLikeZip(blob(await buildZip([{ path: 'a', data: 'b' }])))).toBe(true);
    expect(await looksLikeZip(new Blob(['window.YTD']))).toBe(false);
    expect(await looksLikeZip(new Blob(['PK']))).toBe(false);
  });

  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});
