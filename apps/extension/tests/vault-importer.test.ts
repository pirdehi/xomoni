// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveImported, db } from '../src/shared/db';
import { ARCHIVE_PARSER } from '../src/shared/vault/archive-parser';
import { accountTimeline, importLedger } from '../src/shared/vault/db';
import {
  MAX_HASHED_BYTES,
  UNKNOWN_FILE,
  type VaultBatch,
  type VaultFile,
  type VaultParser,
  diskFile,
  fingerprint,
  isSafeZipPath,
  openFiles,
  planImport,
  registerParser,
  registeredParsers,
  runImport,
  zipFingerprint,
} from '../src/shared/vault/importer';
import { importArchive } from '../src/ui/importArchive';
import { listZip } from '../src/shared/zip';
import {
  ARCHIVE_OWNER,
  GENERATED_AT,
  OTHER_OWNER,
  archiveSpecs,
  buildArchive,
  syntheticLikes,
  syntheticTweets,
} from './support/archive';
import { watchNetwork } from './support/cleanup-pages';
import { account, resetDb } from './support/fixtures';
import { buildZip, zipFile } from './support/zip';

// The vault's importer (#424, CV.1.5, ADR-0043): which parser takes which file, every size checked before anything is
// read, whose files they are, the fingerprint that knows a file read before, the ledger, cancelling, and X's archive
// rebuilt on it with today's behavior.

const ME = { id: ARCHIVE_OWNER.id, handle: ARCHIVE_OWNER.handle };
const OWNER = account({ id: ARCHIVE_OWNER.id, handle: ARCHIVE_OWNER.handle });
const NOW = Date.UTC(2026, 10, 20, 12);

/** A loose text file, as the person drops it. */
const textFile = (name: string, text: string) => diskFile(new File([text], name, { lastModified: NOW }));

/**
 * A parser of made-up `.note` files for these tests: each line is a row, written in batches of `batch`, into an array
 * the test reads. Every call is recorded.
 */
function noteParser(over: Partial<VaultParser> & { batch?: number; written?: string[] } = {}) {
  const written = over.written ?? [];
  const batch = over.batch ?? 2;
  const parser: VaultParser = {
    source: 'x-under-the-hood',
    label: 'notes',
    version: 3,
    matches: (files) => files.filter((f) => f.name.endsWith('.note')),
    maxBytes: () => 1_000,
    async *read(files, ctx): AsyncGenerator<VaultBatch> {
      for (const file of files) {
        const lines = (await file.text()).split('\n').filter(Boolean);
        ctx.count('lines', lines.length);
        ctx.cover(Date.UTC(2026, 0, 1), Date.UTC(2026, 9, 1));
        for (let i = 0; i < lines.length; i += batch) {
          const rows = lines.slice(i, i + batch);
          yield {
            read: rows.length,
            write: () => {
              written.push(...rows);
              ctx.progress(`wrote ${String(written.length)}`);
              return Promise.resolve(rows.length);
            },
          };
        }
      }
    },
    ...over,
  };
  return { parser, written };
}

beforeEach(resetDb);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('opening what the person dropped', () => {
  it('lists a ZIP’s files without reading them, each knowing its ZIP, and takes other files as they are', async () => {
    const zip = await buildArchive();
    const note = new File(['a'], 'my.note');
    const files = await openFiles([zip, note]);
    expect(files.map((f) => f.path)).toEqual([...archiveSpecs().map((s) => s.path), 'my.note']);
    const fromZip = files.filter((f) => f.zip);
    expect(fromZip).toHaveLength(6);
    expect(new Set(fromZip.map((f) => f.zip?.fingerprint)).size).toBe(1);
    expect(fromZip[0]?.zip).toMatchObject({ name: zip.name, size: zip.size });
    expect(files.at(-1)?.name).toBe('my.note');
    expect(files.at(-1)?.zip).toBeUndefined();
    expect(new TextDecoder().decode(await files.at(-1)!.bytes())).toBe('a');
  });

  it('never opens a ZIP entry whose path climbs out of the ZIP', async () => {
    for (const bad of [
      '../data/tweets.js',
      '/data/tweets.js',
      'data/../../tweets.js',
      'C:\\data\\tweets.js',
      'a\\..\\b',
    ])
      expect(isSafeZipPath(bad), bad).toBe(false);
    expect(isSafeZipPath('data/tweets.js')).toBe(true);
    expect(isSafeZipPath('data/..hidden/tweets.js')).toBe(true);
    const zip = await zipFile([
      ...archiveSpecs(),
      { path: '../data/like.js', data: 'window.YTD.like.part0 = [{"like":{"tweetId":"9000000000000000999"}}]' },
    ]);
    const files = await openFiles([zip]);
    expect(files.map((f) => f.path)).not.toContain('../data/like.js');
    const result = await importArchive([zip], OWNER, () => undefined);
    expect(result.likes).toBe(2);
    expect(await db.items.get(`${ME.id}:like:9000000000000000999`)).toBeUndefined();
  });
});

describe('fingerprints, which never leave the computer', () => {
  it('know a ZIP by the paths, sizes and CRCs of its directory, in any order', async () => {
    const zip = await buildArchive();
    const entries = await listZip(zip);
    const print = await zipFingerprint(entries);
    expect(print).toMatch(/^zip:[0-9a-f]{64}$/);
    expect(await zipFingerprint([...entries].reverse())).toBe(print);
    expect(await zipFingerprint(entries.map((e, i) => (i === 2 ? { ...e, crc32: e.crc32 ^ 1 } : e)))).not.toBe(print);
    // The same archive made again is the same; another archive is not.
    expect((await openFiles([await buildArchive({ name: 'renamed.zip' })]))[0]?.zip?.fingerprint).toBe(print);
    expect((await openFiles([await buildArchive({ likes: syntheticLikes(3) })]))[0]?.zip?.fingerprint).not.toBe(print);
  });

  it('know one text file by the SHA-256 of its bytes, and a folder by its files’ paths, sizes and times', async () => {
    const a = textFile('a.note', 'one\ntwo');
    expect(await fingerprint([a])).toBe(
      'sha256:' +
        Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('one\ntwo'))), (b) =>
          b.toString(16).padStart(2, '0'),
        ).join(''),
    );
    expect(await fingerprint([textFile('b.note', 'one\ntwo')])).toBe(await fingerprint([a]));
    const folder = [textFile('x.note', '1'), textFile('y.note', '2')];
    expect(await fingerprint(folder)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await fingerprint([...folder].reverse())).toBe(await fingerprint(folder));
  });

  it('never read a file larger than 50 MB to know it', async () => {
    const big: VaultFile = { ...textFile('big.note', ''), size: MAX_HASHED_BYTES + 1 };
    const bytes = vi.spyOn(big, 'bytes');
    expect(await fingerprint([big])).toMatch(/^sha256:/);
    expect(bytes).not.toHaveBeenCalled();
  });
});

describe('the registry of parsers', () => {
  it('has X’s archive registered, and a later parser for a source takes the earlier one’s place', () => {
    expect(registeredParsers()).toContain(ARCHIVE_PARSER);
    const { parser } = noteParser();
    registerParser(parser);
    registerParser({ ...parser, version: 4 });
    expect(
      registeredParsers()
        .filter((p) => p.source === 'x-under-the-hood')
        .map((p) => p.version),
    ).toEqual([4]);
    expect(registeredParsers()[0]).toBe(ARCHIVE_PARSER);
  });
});

describe('planning an import, before anything is read or written', () => {
  it('gives each file to the first parser that takes it, several parsers at once', async () => {
    const notes = noteParser();
    const files = [...(await openFiles([await buildArchive()])), textFile('a.note', 'x')];
    const plan = await planImport(files, ME, [ARCHIVE_PARSER, notes.parser]);
    expect(plan.parts.map((p) => [p.parser.source, p.files.map((f) => f.name)])).toEqual([
      ['x-archive', ['account.js', 'tweets.js', 'like.js', 'manifest.js']],
      ['x-under-the-hood', ['a.note']],
    ]);
    expect(plan.parts[0]).toMatchObject({
      fileName: expect.stringMatching(/\.zip$/),
      duplicateOf: null,
      confirm: null,
    });
    // The archive's photo and its page are never read.
    expect(plan.ignored.map((f) => f.name)).toEqual(['Your archive.html', '9000000000000000100-photo.jpg']);
    expect(plan.refused).toEqual([]);
  });

  it('lets a parser peek at a file’s first line, and make a part of each file, each with its own fingerprint', async () => {
    const peeked: string[] = [];
    const owners: string[] = [];
    const csv = noteParser({
      onePerFile: true,
      matches: async (files) => {
        const mine: VaultFile[] = [];
        for (const file of files) {
          const head = await file.head(5);
          peeked.push(head);
          if (head.startsWith('Post')) mine.push(file);
        }
        return mine;
      },
      owner: (_files, _account, print) => {
        owners.push(print);
        return Promise.resolve({ ok: true } as const);
      },
    });
    const files = [
      textFile('a.csv', 'Post id,Impressions\n1,2'),
      textFile('b.csv', 'Post id\n3'),
      textFile('c.csv', 'Date'),
    ];
    const plan = await planImport(files, ME, [csv.parser]);
    expect(peeked).toEqual(['Post ', 'Post ', 'Date']);
    expect(plan.parts.map((p) => p.fileName)).toEqual(['a.csv', 'b.csv']);
    expect(new Set(plan.parts.map((p) => p.fingerprint)).size).toBe(2);
    expect(owners).toEqual(plan.parts.map((p) => p.fingerprint));
    expect(plan.refused).toEqual([{ fileName: 'c.csv', reason: UNKNOWN_FILE }]);
    // A ZIP's entry can be peeked at too.
    const [entry] = await openFiles([await zipFile([{ path: 'x.csv', data: 'Post id,Likes' }])]);
    expect(await entry?.head(7)).toBe('Post id');
  });

  it('refuses a file no parser knows, and a ZIP holding nothing Xomoni reads, with the reason', async () => {
    const photos = await zipFile([{ path: 'holiday.jpg', data: 'x' }], 'photos.zip');
    const files = [...(await openFiles([photos])), textFile('bank.csv', 'Date,Amount')];
    const plan = await planImport(files, ME, [ARCHIVE_PARSER]);
    expect(plan.parts).toEqual([]);
    expect(plan.refused).toEqual([
      { fileName: 'photos.zip', reason: UNKNOWN_FILE },
      { fileName: 'bank.csv', reason: UNKNOWN_FILE },
    ]);
  });

  it('checks every size before reading anything, a ZIP’s by what its directory declares', async () => {
    const notes = noteParser();
    const big = textFile('big.note', 'x'.repeat(1_001));
    const read = [vi.spyOn(big, 'text'), vi.spyOn(big, 'bytes')];
    const plan = await planImport([big], ME, [notes.parser]);
    expect(plan.parts).toEqual([]);
    expect(plan.refused).toEqual([
      {
        fileName: 'big.note',
        reason: 'big.note is 1 MB, larger than Xomoni reads for notes (1 MB). Nothing was imported.',
        source: 'x-under-the-hood',
      },
    ]);
    for (const spy of read) expect(spy).not.toHaveBeenCalled();

    // A ZIP that lies about an entry's size is refused by what it declares, before inflating anything.
    const lying = await zipFile([
      ...archiveSpecs().filter((s) => s.path !== 'data/tweets.js'),
      { path: 'data/tweets.js', data: 'x', declaredSize: 512 * 1024 * 1024 + 1, rawData: new Uint8Array([0xff]) },
    ]);
    const lied = await planImport(await openFiles([lying]), ME, [ARCHIVE_PARSER]);
    expect(lied.refused[0]?.reason).toBe(
      'tweets.js is 513 MB, larger than Xomoni reads (512 MB). Check that this is your own X archive. Nothing was imported.',
    );
  });

  it('refuses another account’s files before writing anything, and asks the person when files can’t tell', async () => {
    const other = await planImport(await openFiles([await buildArchive({ account: OTHER_OWNER })]), ME, [
      ARCHIVE_PARSER,
    ]);
    expect(other.parts).toEqual([]);
    expect(other.refused).toEqual([
      expect.objectContaining({
        reason: `This archive belongs to @${OTHER_OWNER.handle}, not @${ME.handle}. Nothing was imported.`,
        source: 'x-archive',
      }),
    ]);
    const asking = noteParser({
      owner: () => Promise.resolve({ ok: 'confirm', question: 'Is this note yours?' } as const),
    });
    const plan = await planImport([textFile('a.note', 'x')], ME, [asking.parser]);
    expect(plan.parts[0]?.confirm).toBe('Is this note yours?');
    expect(await db.vaultImports.count()).toBe(0);
  });
});

describe('running an import', () => {
  it('reads and merges batch by batch, then writes one ledger row with what it did', async () => {
    const notes = noteParser({ batch: 2 });
    const plan = await planImport([textFile('a.note', 'one\ntwo\nthree')], ME, [notes.parser]);
    const progress = vi.fn();
    const [result] = await runImport(plan, { onProgress: progress, now: NOW });

    expect(notes.written).toEqual(['one', 'two', 'three']);
    expect(progress.mock.calls).toEqual([['wrote 2'], ['wrote 3']]);
    expect(result).toMatchObject({ duplicate: false, cancelled: false, counts: { read: 3, merged: 3, skipped: 0 } });
    expect(result?.ledger).toEqual({
      id: expect.stringMatching(new RegExp(`^${ME.id}:x-under-the-hood:${String(NOW)}:[0-9a-z]{8}$`)),
      accountId: ME.id,
      source: 'x-under-the-hood',
      fileName: 'a.note',
      bytes: 13,
      fingerprint: plan.parts[0]?.fingerprint,
      importedAt: NOW,
      coverFrom: Date.UTC(2026, 0, 1),
      coverTo: Date.UTC(2026, 9, 1),
      counts: { read: 3, merged: 3, skipped: 0, parts: { lines: 3 } },
      parser: 'x-under-the-hood@3',
      problems: [],
    });
    expect(await importLedger(ME.id)).toEqual([result?.ledger]);
  });

  it('knows the same file again: the ledger says duplicate, and nothing is read or written', async () => {
    const notes = noteParser();
    await runImport(await planImport([textFile('a.note', 'one')], ME, [notes.parser]), { now: NOW - 1 });
    const again = await planImport([textFile('copy.note', 'one')], ME, [notes.parser]);
    expect(again.parts[0]?.duplicateOf?.fileName).toBe('a.note');
    const read = vi.spyOn(notes.parser, 'read');
    const [result] = await runImport(again, { now: NOW });
    expect(read).not.toHaveBeenCalled();
    expect(notes.written).toEqual(['one']);
    expect(result).toMatchObject({ duplicate: true, counts: { read: 0, merged: 0, skipped: 0 } });
    expect(result?.ledger?.problems).toEqual(['duplicate']);
    expect((await importLedger(ME.id)).map((r) => r.problems)).toEqual([['duplicate'], []]);
  });

  it('stops between batches when cancelled: what was merged stays, and the ledger says cancelled', async () => {
    const controller = new AbortController();
    const notes = noteParser({ batch: 1 });
    const finish = vi.fn(() => Promise.resolve());
    notes.parser.finish = finish;
    const plan = await planImport([textFile('a.note', 'one\ntwo\nthree')], ME, [notes.parser]);
    const [result] = await runImport(plan, {
      signal: controller.signal,
      onProgress: (msg) => {
        if (msg === 'wrote 1') controller.abort();
      },
    });
    expect(notes.written).toEqual(['one']);
    expect(result).toMatchObject({ cancelled: true, counts: { read: 1, merged: 1 } });
    expect(result?.ledger?.problems).toEqual(['cancelled']);
    expect(finish).not.toHaveBeenCalled();
    // A cancelled import isn't the file read: importing it again is no duplicate.
    expect(
      (await planImport([textFile('a.note', 'one\ntwo\nthree')], ME, [notes.parser])).parts[0]?.duplicateOf,
    ).toBeNull();
  });

  it('writes the ledger row of a failed import and throws as the parser did; that file can be imported again', async () => {
    const failing = noteParser();
    failing.parser.read = async function* () {
      yield* [];
      throw new Error('This file is damaged.');
    };
    const plan = await planImport([textFile('a.note', 'one')], ME, [failing.parser]);
    await expect(runImport(plan, { now: NOW })).rejects.toThrow('This file is damaged.');
    expect((await importLedger(ME.id)).map((r) => r.problems)).toEqual([['failed']]);
    expect((await planImport([textFile('a.note', 'one')], ME, [failing.parser])).parts[0]?.duplicateOf).toBeNull();
  });

  it('keeps no ledger for an account Xomoni didn’t learn from X, and imports all the same', async () => {
    const notes = noteParser();
    const plan = await planImport([textFile('a.note', 'one')], { id: 'acct-me', handle: 'me' }, [notes.parser]);
    const [result] = await runImport(plan);
    expect(result?.ledger).toBeNull();
    expect(notes.written).toEqual(['one']);
    expect(await db.vaultImports.count()).toBe(0);
  });

  it('sends nothing off this computer', async () => {
    const network = watchNetwork();
    const notes = noteParser();
    await runImport(await planImport([textFile('a.note', 'one')], ME, [notes.parser]));
    await importArchive([await buildArchive()], OWNER, () => undefined);
    expect(network.calls()).toBe(0);
  });
});

describe('X’s archive on the importer, as before', () => {
  it('imports as before, and keeps the date X made the archive in the ledger and the timeline', async () => {
    const zip = await buildArchive({ tweets: syntheticTweets(12), likes: syntheticLikes(4) });
    const progress = vi.fn();
    expect(await importArchive([zip], OWNER, progress)).toEqual({ tweets: 12, likes: 4 });
    expect(await db.items.where('accountId').equals(ME.id).count()).toBe(16);
    expect(await archiveImported(ME.id)).toBe(true);
    expect((await db.logs.toArray()).map((l) => l.message)).toEqual([
      'Imported archive: 12 posts/replies/reposts and 4 likes',
    ]);
    expect(progress).toHaveBeenCalledWith('Saving tweets.js: 12 / 12');

    const [row] = await importLedger(ME.id);
    expect(row).toMatchObject({
      source: 'x-archive',
      fileName: zip.name,
      bytes: zip.size,
      fingerprint: expect.stringMatching(/^zip:[0-9a-f]{64}$/),
      coverTo: GENERATED_AT,
      counts: { read: 16, merged: 16, skipped: 0, parts: { tweets: 12, likes: 4 } },
      parser: 'x-archive@1',
      problems: [],
    });
    expect(row?.coverFrom).toBe(Date.UTC(2026, 10, 1) - 11 * 86_400_000);
    const [event] = await accountTimeline(ME.id);
    expect(event).toMatchObject({
      kind: 'archive_imported',
      source: 'archive',
      ref: row?.id,
      words: 'Imported X’s archive made on 2026-11-08: 12 posts, replies and reposts, and 4 likes.',
    });
  });

  it('knows the same ZIP again: the ledger says duplicate, and nothing else is written', async () => {
    const zip = await buildArchive();
    await importArchive([zip], OWNER, () => undefined);
    const before = {
      items: await db.items.count(),
      logs: await db.logs.count(),
      events: await db.accountEvents.count(),
    };
    const progress = vi.fn();

    expect(await importArchive([zip], OWNER, progress)).toEqual({ tweets: 3, likes: 2, duplicate: true });
    expect(progress).not.toHaveBeenCalled();
    expect({
      items: await db.items.count(),
      logs: await db.logs.count(),
      events: await db.accountEvents.count(),
    }).toEqual(before);
    expect((await importLedger(ME.id)).map((r) => r.problems)).toEqual([['duplicate'], []]);
  });

  it('notes a manifest it can’t read, and keeps no date without one', async () => {
    await importArchive([await buildArchive({ manifest: false, extra: [] })], OWNER, () => undefined);
    const broken = await zipFile([
      ...archiveSpecs({ manifest: false, likes: syntheticLikes(1) }),
      { path: 'data/manifest.js', data: 'window.__THAR_CONFIG = {' },
    ]);
    await importArchive([broken], OWNER, () => undefined);
    const [newer, older] = await importLedger(ME.id);
    expect(older).toMatchObject({ coverTo: null, problems: [] });
    expect(newer).toMatchObject({ coverTo: null, problems: ['manifest-unreadable'] });
    expect((await accountTimeline(ME.id)).map((e) => e.words)).toContain(
      'Imported X’s archive: 3 posts, replies and reposts, and 1 likes.',
    );
  });

  it('refuses another account’s archive with today’s words, and writes nothing, not even a ledger row', async () => {
    await expect(importArchive([await buildArchive({ account: OTHER_OWNER })], OWNER, () => undefined)).rejects.toThrow(
      `This archive belongs to @${OTHER_OWNER.handle}, not @${ME.handle}. Nothing was imported.`,
    );
    expect(await db.items.count()).toBe(0);
    expect(await db.vaultImports.count()).toBe(0);
    expect(await db.accountEvents.count()).toBe(0);
  });

  it('writes a failed row when the ZIP turns out damaged while it is read, and imports nothing', async () => {
    const damaged = await zipFile(
      archiveSpecs().map((s) => (s.path === 'data/tweets.js' ? { ...s, crc: 1 } : s)),
      'twitter-damaged.zip',
    );
    await expect(importArchive([damaged], OWNER, () => undefined)).rejects.toThrow(
      'This ZIP file is damaged or incomplete. Download it again from X.',
    );
    expect(await db.items.count()).toBe(0);
    expect((await importLedger(ME.id)).map((r) => r.problems)).toEqual([['failed']]);
  });

  it('imports a ZIP64 archive built the way X builds a large one', async () => {
    const bytes = await buildZip(archiveSpecs({ tweets: syntheticTweets(5) }), { zip64: true });
    const zip = new File([bytes], 'twitter-big.zip');
    expect(await importArchive([zip], OWNER, () => undefined)).toEqual({ tweets: 5, likes: 2 });
  });
});
