import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { UpdateFailure } from '../src/update/problems';
import type { ReleaseFile } from '../src/update/release-zip';
import {
  type JournalStore,
  type UpdateJournal,
  kvJournal,
  readFileAt,
  restoreJournal,
  writeFileAt,
  writeOrder,
  writeRelease,
} from '../src/update/write';
import { resetDb } from './support/fixtures';
import { memoryFolder, textOf } from './support/own-folder';

const utf8 = (text: string) => new TextEncoder().encode(text);

/** The folder of Xomoni 0.4.0 as Load unpacked left it, with a file of the person's own beside it. */
const oldVersion = () => ({
  'manifest.json': '{"version":"0.4.0"}',
  'sw.js': '// sw 0.4.0',
  'dashboard.html': '<script src="assets/dashboard-OLD.js"></script>',
  'assets/dashboard-OLD.js': 'old',
  'assets/shared-SAME.js': 'same',
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

const UPDATE = { from: '0.4.0', to: '0.5.0', at: 1_800_000_000_000 };

/** A journal in memory that remembers every state it was given. */
function memoryJournal(): JournalStore & { states: (UpdateJournal | null)[] } {
  const store = {
    states: [] as (UpdateJournal | null)[],
    get: () => Promise.resolve(store.states.at(-1) ?? null),
    set: (journal: UpdateJournal | null) => {
      store.states.push(journal);
      return Promise.resolve();
    },
  };
  return store;
}

describe('writing a release into Xomoni’s folder (#305)', () => {
  it('writes every file, new ones first and manifest.json last, and keeps a journal only while writing', async () => {
    const folder = memoryFolder('xomoni', oldVersion());
    const journal = memoryJournal();
    const result = await writeRelease(folder, newVersion(), UPDATE, journal);

    expect(result).toEqual({ written: 6, removed: 1 });
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
    // The old version's leftover in assets/ is gone; the person's own file outside it stays.
    expect(folder.files.has('assets/dashboard-OLD.js')).toBe(false);
    expect(textOf(folder, 'notes.txt')).toBe('my own notes');

    expect(journal.states).toHaveLength(2);
    expect(journal.states[0]).toMatchObject({ from: '0.4.0', to: '0.5.0', at: UPDATE.at });
    const backups = new Map(journal.states[0]!.backups.map((b) => [b.path, b.old && new TextDecoder().decode(b.old)]));
    expect(backups.get('sw.js')).toBe('// sw 0.4.0');
    expect(backups.get('assets/dashboard-NEW.js')).toBeNull();
    expect(journal.states[1]).toBeNull();
  });

  it('puts every old file back, and removes the new ones, when a write fails', async () => {
    const folder = memoryFolder('xomoni', oldVersion(), { failWrite: new Set(['sw.js']) });
    const journal = memoryJournal();
    const before = new Map(folder.files);

    let failure: unknown;
    try {
      await writeRelease(folder, newVersion(), UPDATE, journal);
    } catch (err) {
      failure = err;
    }
    expect(failure).toBeInstanceOf(UpdateFailure);
    expect((failure as UpdateFailure).problem).toBe('write-failed');
    // Exactly the folder as it was: no new file, no empty file left by the failed one, the old bytes back.
    expect([...folder.files.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [path, data] of before) expect(folder.files.get(path), path).toEqual(data);
    expect(textOf(folder, 'manifest.json')).toBe('{"version":"0.4.0"}');
    expect(journal.states.at(-1)).toBeNull();
  });

  it('keeps the journal when putting back fails too, so the old version can be restored later', async () => {
    const faults = { failWrite: new Set(['manifest.json']), failAlways: new Set(['manifest.json']) };
    const folder = memoryFolder('xomoni', oldVersion(), faults);
    const journal = memoryJournal();
    await expect(writeRelease(folder, newVersion(), UPDATE, journal)).rejects.toMatchObject({
      problem: 'rollback-failed',
    });
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

  it('restores an update cut short (the tab closed mid-write) from its journal', async () => {
    const folder = memoryFolder('xomoni', oldVersion());
    const journal = memoryJournal();
    await writeRelease(folder, newVersion(), UPDATE, journal);
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
    const journal = memoryJournal();
    await expect(writeRelease(folder, newVersion(), UPDATE, journal)).rejects.toMatchObject({
      problem: 'write-failed',
    });
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

describe('the journal in IndexedDB (#305)', () => {
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
});
