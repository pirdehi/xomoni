import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { UPDATE_KEYS, kvGet, kvSet, wipeLocalData } from '../src/shared/db';
import { UpdateFailure } from '../src/update/problems';
import type { ReleaseFile } from '../src/update/release-zip';
import {
  type JournalStore,
  type Shipped,
  type ShippedStore,
  type UpdateJournal,
  kvJournal,
  kvShipped,
  readFileAt,
  restoreJournal,
  writeFileAt,
  writeOrder,
  writeRelease,
} from '../src/update/write';
import { resetDb } from './support/fixtures';
import { memoryFolder, textOf } from './support/own-folder';

const utf8 = (text: string) => new TextEncoder().encode(text);

/** The folder of Xomoni 0.4.0 as Load unpacked left it, with files of the person's own beside it. */
const oldVersion = () => ({
  'manifest.json': '{"version":"0.4.0"}',
  'sw.js': '// sw 0.4.0',
  'dashboard.html': '<script src="assets/dashboard-OLD.js"></script>',
  'assets/dashboard-OLD.js': 'old',
  'assets/shared-SAME.js': 'same',
  'assets/my-notes.txt': 'the person’s own file, in assets/',
  'notes.txt': 'my own notes',
});

/** Xomoni 0.5.0's files. */
const newVersion = (): ReleaseFile[] => [
  { path: 'assets/dashboard-NEW.js', data: utf8('new') },
  { path: 'assets/shared-SAME.js', data: utf8('same') },
  { path: 'dashboard.html', data: utf8('<script src="assets/dashboard-NEW.js"></script>') },
  { path: 'manifest.json', data: utf8('{"version":"0.5.0"}') },
  { path: 'sw.js', data: utf8('// sw 0.5.0') },
  { path: 'icons/icon16.png', data: new Uint8Array([1, 2, 3]) },
];

/** What the one-click update to 0.4.0 wrote, as `kvShipped` keeps it. */
const SHIPPED_040: Shipped = {
  version: '0.4.0',
  paths: ['assets/dashboard-OLD.js', 'assets/shared-SAME.js', 'dashboard.html', 'manifest.json', 'sw.js'],
};

const UPDATE = { from: '0.4.0', to: '0.5.0', at: 1_800_000_000_000 };

/** A journal in memory that remembers every state it was given; `failClear` makes forgetting it fail. */
function memoryJournal(failClear = false): JournalStore & { states: (UpdateJournal | null)[] } {
  const store = {
    states: [] as (UpdateJournal | null)[],
    get: () => Promise.resolve(store.states.at(-1) ?? null),
    set: (journal: UpdateJournal | null) => {
      if (!journal && failClear) return Promise.reject(new DOMException('Quota exceeded', 'QuotaExceededError'));
      store.states.push(journal);
      return Promise.resolve();
    },
  };
  return store;
}

/** The files written by the last update, in memory. */
function memoryShipped(initial: Shipped | null = null): ShippedStore & { value: Shipped | null } {
  const store = {
    value: initial,
    get: () => Promise.resolve(store.value),
    set: (shipped: Shipped) => {
      store.value = shipped;
      return Promise.resolve();
    },
  };
  return store;
}

/** The two stores, in memory. */
const stores = (journal = memoryJournal(), shipped = memoryShipped()) => ({ journal, shipped });

/** The failure `promise` rejects with. */
async function failure(promise: Promise<unknown>): Promise<UpdateFailure> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof UpdateFailure) return err;
    throw err;
  }
  throw new Error('it didn’t fail');
}

describe('writing a release into Xomoni’s folder (#305)', () => {
  it('writes every file, new ones first and manifest.json last, and keeps a journal only while writing', async () => {
    const folder = memoryFolder('xomoni', oldVersion());
    const { journal, shipped } = stores();
    const result = await writeRelease(folder, newVersion(), UPDATE, { journal, shipped });

    expect(result).toEqual({ written: 6, removed: 0 });
    expect(folder.writes).toEqual([
      'assets/dashboard-NEW.js',
      'icons/icon16.png',
      'assets/shared-SAME.js',
      'dashboard.html',
      'sw.js',
      'manifest.json',
    ]);
    expect(textOf(folder, 'manifest.json')).toBe('{"version":"0.5.0"}');
    expect(textOf(folder, 'sw.js')).toBe('// sw 0.5.0');

    expect(journal.states).toHaveLength(2);
    expect(journal.states[0]).toMatchObject({ from: '0.4.0', to: '0.5.0', at: UPDATE.at });
    const backups = new Map(journal.states[0]!.backups.map((b) => [b.path, b.old && new TextDecoder().decode(b.old)]));
    expect(backups.get('sw.js')).toBe('// sw 0.4.0');
    expect(backups.get('assets/dashboard-NEW.js')).toBeNull();
    expect(journal.states[1]).toBeNull();
    // What it wrote, for the next update to know which files are Xomoni's.
    expect(shipped.value).toEqual({ version: '0.5.0', paths: newVersion().map((f) => f.path) });
  });

  it('puts every old file back, and removes the new ones, when a write fails', async () => {
    const folder = memoryFolder('xomoni', oldVersion(), { failWrite: new Set(['sw.js']) });
    const { journal, shipped } = stores();
    const before = new Map(folder.files);

    const failed = await failure(writeRelease(folder, newVersion(), UPDATE, { journal, shipped }));
    expect(failed.problem).toBe('write-failed');
    // Exactly the folder as it was: no new file, no empty file left by the failed one, the old bytes back.
    expect([...folder.files.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [path, data] of before) expect(folder.files.get(path), path).toEqual(data);
    expect(textOf(folder, 'manifest.json')).toBe('{"version":"0.4.0"}');
    expect(journal.states.at(-1)).toBeNull();
    expect(shipped.value).toBeNull();
  });

  it('keeps the journal when putting back fails too, so the old version can be restored later', async () => {
    const faults = { failWrite: new Set(['manifest.json']), failAlways: new Set(['manifest.json']) };
    const folder = memoryFolder('xomoni', oldVersion(), faults);
    const { journal, shipped } = stores();
    expect((await failure(writeRelease(folder, newVersion(), UPDATE, { journal, shipped }))).problem).toBe(
      'rollback-failed',
    );
    expect(journal.states.at(-1)).toMatchObject({ from: '0.4.0', to: '0.5.0' });

    // Next time, with the disk working again, the journal puts 0.4.0 back whole.
    faults.failAlways.clear();
    faults.failWrite.clear();
    expect(await restoreJournal(folder, journal)).toBe(true);
    expect(journal.states.at(-1)).toBeNull();
    expect(textOf(folder, 'manifest.json')).toBe('{"version":"0.4.0"}');
    expect(textOf(folder, 'sw.js')).toBe('// sw 0.4.0');
    expect(folder.files.has('assets/dashboard-NEW.js')).toBe(false);
    expect(folder.files.has('icons/icon16.png')).toBe(false);
    expect(await restoreJournal(folder, journal)).toBe(true);
  });

  it('never writes over a journal already kept: it may be the only copy of the old files', async () => {
    // The review's case: sw.js is written, the manifest isn't, and putting sw.js back fails.
    const faults = { failAttempts: { 'manifest.json': [1, 2], 'sw.js': [2] } };
    const folder = memoryFolder('xomoni', oldVersion(), faults);
    const { journal, shipped } = stores();
    expect((await failure(writeRelease(folder, newVersion(), UPDATE, { journal, shipped }))).problem).toBe(
      'rollback-failed',
    );
    expect(textOf(folder, 'sw.js')).toBe('// sw 0.5.0');
    expect(textOf(folder, 'manifest.json')).toBe('{"version":"0.4.0"}');
    const kept = journal.states.at(-1);

    // A second update, with the disk working again, writes nothing and leaves the backup as it is.
    const writes = folder.writes.length;
    const again = await failure(
      writeRelease(folder, newVersion(), { ...UPDATE, at: UPDATE.at + 1 }, { journal, shipped }),
    );
    expect(again.problem).toBe('unfinished');
    expect(folder.writes.length).toBe(writes);
    expect(journal.states.at(-1)).toBe(kept);
    expect(new TextDecoder().decode(kept!.backups.find((b) => b.path === 'sw.js')!.old!)).toBe('// sw 0.4.0');

    // And the backup still puts 0.4.0 back whole.
    expect(await restoreJournal(folder, journal)).toBe(true);
    expect(textOf(folder, 'sw.js')).toBe('// sw 0.4.0');
  });

  it('finishes when the journal can’t be forgotten after every file is written: the reload settles it', async () => {
    const folder = memoryFolder('xomoni', oldVersion());
    const journal = memoryJournal(true);
    const shipped = memoryShipped();
    expect(await writeRelease(folder, newVersion(), UPDATE, { journal, shipped })).toEqual({ written: 6, removed: 0 });
    expect(textOf(folder, 'manifest.json')).toBe('{"version":"0.5.0"}');
    // Kept, and found stale once 0.5.0 runs (tests/update.test.ts).
    expect(journal.states.at(-1)).toMatchObject({ from: '0.4.0', to: '0.5.0' });
    expect(shipped.value?.version).toBe('0.5.0');
  });

  it('restores an update cut short (the tab closed mid-write) from its journal', async () => {
    const folder = memoryFolder('xomoni', oldVersion());
    const { journal, shipped } = stores();
    await writeRelease(folder, newVersion(), UPDATE, { journal, shipped });
    // As if the write had stopped after the files: the journal of that moment, with 0.5.0 on disk.
    await journal.set(journal.states[0]!);
    expect(await restoreJournal(folder, journal)).toBe(true);
    expect(textOf(folder, 'manifest.json')).toBe('{"version":"0.4.0"}');
    expect(textOf(folder, 'dashboard.html')).toBe('<script src="assets/dashboard-OLD.js"></script>');
  });

  it('says so when restoring fails, and keeps the journal', async () => {
    const folder = memoryFolder('xomoni', oldVersion(), { failWrite: new Set(['sw.js']) });
    const journal = memoryJournal();
    await journal.set({ ...UPDATE, backups: [{ path: 'sw.js', old: utf8('// sw 0.4.0') }] });
    expect(await restoreJournal(folder, journal)).toBe(false);
    expect(journal.states.at(-1)).not.toBeNull();
  });

  it('writes nothing when the old files can’t be read for the backup', async () => {
    const folder = memoryFolder('xomoni', oldVersion(), { failRead: new Set(['sw.js']) });
    const { journal, shipped } = stores();
    expect((await failure(writeRelease(folder, newVersion(), UPDATE, { journal, shipped }))).problem).toBe(
      'write-failed',
    );
    expect(folder.writes).toEqual([]);
    expect(journal.states).toEqual([]);
  });

  it('never writes outside the folder, whatever path it is given', async () => {
    const folder = memoryFolder('xomoni', oldVersion());
    for (const path of ['../evil.js', '/evil.js', 'a/../../evil.js', 'a\\evil.js']) {
      await expect(writeFileAt(folder, path, utf8('evil'))).rejects.toMatchObject({ problem: 'bad-package' });
      await expect(readFileAt(folder, path)).rejects.toBeInstanceOf(UpdateFailure);
    }
    expect(folder.writes).toEqual([]);
  });

  it('reads a missing file or folder as none', async () => {
    const folder = memoryFolder('xomoni', oldVersion());
    expect(await readFileAt(folder, 'missing.js')).toBeNull();
    expect(await readFileAt(folder, 'missing/x.js')).toBeNull();
    expect(new TextDecoder().decode((await readFileAt(folder, 'assets/shared-SAME.js'))!)).toBe('same');
  });

  it('orders new files, then replaced ones, then manifest.json', () => {
    const order = writeOrder([
      { path: 'manifest.json', old: utf8('x') },
      { path: 'sw.js', old: utf8('x') },
      { path: 'assets/new.js', old: null },
    ]);
    expect(order.map((b) => b.path)).toEqual(['assets/new.js', 'sw.js', 'manifest.json']);
  });
});

describe('the old version’s leftovers (#305)', () => {
  it('removes only files in assets/ that the previous one-click update wrote and this one doesn’t', async () => {
    const folder = memoryFolder('xomoni', oldVersion());
    const { journal, shipped } = stores(memoryJournal(), memoryShipped(SHIPPED_040));
    const result = await writeRelease(folder, newVersion(), UPDATE, { journal, shipped });

    expect(result.removed).toBe(1);
    expect(folder.files.has('assets/dashboard-OLD.js')).toBe(false);
    // Kept: in the new version, the person's own files (in assets/ too), and anything outside assets/.
    expect(textOf(folder, 'assets/shared-SAME.js')).toBe('same');
    expect(textOf(folder, 'assets/my-notes.txt')).toBe('the person’s own file, in assets/');
    expect(textOf(folder, 'notes.txt')).toBe('my own notes');
  });

  it('removes nothing after a version installed by hand, whose files Xomoni never wrote', async () => {
    const folder = memoryFolder('xomoni', oldVersion());
    const result = await writeRelease(folder, newVersion(), UPDATE, stores());
    expect(result.removed).toBe(0);
    expect(textOf(folder, 'assets/dashboard-OLD.js')).toBe('old');
  });

  it('removes nothing when the files kept are another version’s, or name a file outside assets/', async () => {
    const other = memoryFolder('xomoni', oldVersion());
    const stale = memoryShipped({ ...SHIPPED_040, version: '0.3.0' });
    expect((await writeRelease(other, newVersion(), UPDATE, stores(memoryJournal(), stale))).removed).toBe(0);
    expect(textOf(other, 'assets/dashboard-OLD.js')).toBe('old');

    const malformed = memoryFolder('xomoni', oldVersion());
    const broken = memoryShipped({ version: '0.4.0', paths: 'assets/dashboard-OLD.js' as unknown as string[] });
    expect(await writeRelease(malformed, newVersion(), UPDATE, stores(memoryJournal(), broken))).toEqual({
      written: 6,
      removed: 0,
    });

    const outside = memoryFolder('xomoni', oldVersion());
    const odd = memoryShipped({ version: '0.4.0', paths: ['notes.txt', '../escape.js', 'assets/../notes.txt'] });
    expect((await writeRelease(outside, newVersion(), UPDATE, stores(memoryJournal(), odd))).removed).toBe(0);
    expect(textOf(outside, 'notes.txt')).toBe('my own notes');
  });
});

describe('the journal and the files written, in IndexedDB (#305)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('keeps the backups’ bytes until the update is done', async () => {
    expect(await kvJournal.get()).toBeNull();
    const journal: UpdateJournal = {
      ...UPDATE,
      backups: [
        { path: 'sw.js', old: utf8('// sw') },
        { path: 'a.js', old: null },
      ],
    };
    await kvJournal.set(journal);
    const kept = await kvJournal.get();
    expect(kept?.backups[0]?.old).toEqual(utf8('// sw'));
    expect(kept?.backups[1]?.old).toBeNull();
    await kvJournal.set(null);
    expect(await kvJournal.get()).toBeNull();
  });

  it('survive *Delete local data*, so an update cut short can still be put back', async () => {
    await kvJournal.set({ ...UPDATE, backups: [{ path: 'sw.js', old: utf8('// sw 0.4.0') }] });
    await kvShipped.set(SHIPPED_040);
    await kvSet(UPDATE_KEYS.folder, { name: 'xomoni-extension' });
    await kvSet('settings', { preset: 'careful' });
    await wipeLocalData();
    expect((await kvJournal.get())?.backups[0]?.old).toEqual(utf8('// sw 0.4.0'));
    expect(await kvShipped.get()).toEqual(SHIPPED_040);
    expect(await kvGet(UPDATE_KEYS.folder, null)).toEqual({ name: 'xomoni-extension' });
    expect(await kvGet('settings', null)).toBeNull();
  });
});
