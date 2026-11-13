import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectingArchive, kvGet } from '../../src/shared/db';
import { ARCHIVE_FILE, FOLDER_NOTE, FOLDER_NOTE_URL } from '../../src/shared/x-archive';
import {
  type DownloadsApi,
  type FolderHandle,
  FOLDER_NOT_CHOSEN,
  canRead,
  chooseFolder,
  fileKey,
  isArchiveFolder,
  kvFolderStore,
  makeArchiveFolder,
  markArchiveSeen,
  newestArchive,
  pickArchiveFolder,
  seenArchives,
  wrongFolder,
} from '../../src/ui/downloads-folder';
import { stubChrome } from '../support/chrome';
import { folderWith } from '../support/folder';
import { ME, resetDb } from '../support/fixtures';

const file = (name: string, lastModified: number, size = 3) => new File(['x'.repeat(size)], name, { lastModified });

describe('the Downloads folder (#187)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('knows X’s archive by its name', () => {
    expect(ARCHIVE_FILE.test('twitter-2026-11-08-0a1b2c3d.zip')).toBe(true);
    expect(ARCHIVE_FILE.test('x-2027-01-02-abc.zip')).toBe(true);
    expect(ARCHIVE_FILE.test('twitter-2026-11-08-0a1b2c3d.zip.crdownload')).toBe(false);
    expect(ARCHIVE_FILE.test('holiday-photos.zip')).toBe(false);
    expect(ARCHIVE_FILE.test('twitter-archive.zip')).toBe(false);
  });

  it('picks the newest archive not seen yet, never a half-downloaded one or another file', async () => {
    const older = file('twitter-2026-01-01-aaa.zip', 1000);
    const newer = file('twitter-2026-11-08-bbb.zip', 5000);
    const folder = folderWith([
      older,
      newer,
      file('twitter-2026-11-09-ccc.zip.crdownload', 9000),
      file('report.zip', 9000),
    ]);

    expect(await newestArchive(folder, new Set())).toBe(newer);
    expect(await newestArchive(folder, new Set([fileKey(newer)]))).toBe(older);
    expect(await newestArchive(folder, new Set([fileKey(newer), fileKey(older)]))).toBeNull();
  });

  it('reads without asking only when allowed already, and asks only when told to', async () => {
    const allowed = folderWith([], 'granted');
    expect(await canRead(allowed, false)).toBe(true);

    const asking = folderWith([], 'prompt');
    expect(await canRead(asking, false)).toBe(false);
    expect(asking.requestPermission).not.toHaveBeenCalled();
    expect(await canRead(asking, true)).toBe(true);
    expect(asking.requestPermission).toHaveBeenCalledWith({ mode: 'read' });

    const refused = { ...folderWith([], 'denied'), requestPermission: () => Promise.resolve('denied' as const) };
    expect(await canRead(refused, true)).toBe(false);
  });

  it('remembers the files imported for each account, the last 20, once each', async () => {
    const a = file('twitter-2026-01-01-a.zip', 1);
    await markArchiveSeen(ME, a);
    await markArchiveSeen(ME, a);
    expect([...(await seenArchives(ME))]).toEqual([fileKey(a)]);
    expect(await seenArchives('someone-else')).toEqual(new Set());

    for (let i = 0; i < 25; i++) await markArchiveSeen(ME, file(`twitter-2026-01-01-${i}.zip`, i + 10));
    const seen = await seenArchives(ME);
    expect(seen.size).toBe(20);
    expect(seen.has(fileKey(a))).toBe(false);
  });

  it('opens the folder picker in Downloads, read-only', async () => {
    const folder = folderWith([]);
    const showDirectoryPicker = vi.fn(() => Promise.resolve(folder));
    expect(await chooseFolder({ showDirectoryPicker })).toBe(folder);
    expect(showDirectoryPicker).toHaveBeenCalledWith({ id: 'downloads', startIn: 'downloads', mode: 'read' });

    const closed = () => Promise.reject(new DOMException('closed', 'AbortError'));
    expect(await chooseFolder({ showDirectoryPicker: closed })).toBeNull();
    const refused = () => Promise.reject(new DOMException('no', 'SecurityError'));
    expect(await chooseFolder({ showDirectoryPicker: refused })).toBeUndefined();
    expect(await chooseFolder({})).toBeUndefined();
  });
});

/** `chrome.downloads` as far as making the folder goes: each search answers the next state in `states`. */
function downloadsApi(states: (string | undefined)[]): DownloadsApi & {
  download: ReturnType<typeof vi.fn>;
  erase: ReturnType<typeof vi.fn>;
} {
  return {
    download: vi.fn(() => Promise.resolve(41)),
    search: vi.fn(() => {
      const state = states.length > 1 ? states.shift() : states[0];
      return Promise.resolve(state ? [{ state }] : []);
    }),
    erase: vi.fn(() => Promise.resolve([41])),
  };
}

describe('the Xomoni folder in Downloads (#196)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('makes Downloads/Xomoni by saving a note in it, and keeps the note out of Chrome’s downloads list', async () => {
    const api = downloadsApi(['in_progress', 'complete']);

    expect(await makeArchiveFolder(api)).toBe(true);

    expect(api.download).toHaveBeenCalledWith({
      url: FOLDER_NOTE_URL,
      filename: `Xomoni/${FOLDER_NOTE}`,
      conflictAction: 'overwrite',
      saveAs: false,
    });
    expect(api.erase).toHaveBeenCalledWith({ id: 41 });
  });

  it('uses Chrome’s own downloads by default', async () => {
    const chrome = stubChrome();

    expect(await makeArchiveFolder()).toBe(true);

    expect(chrome.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: `Xomoni/${FOLDER_NOTE}`, saveAs: false }),
    );
    expect(chrome.downloads.search).toHaveBeenCalledWith({ id: 1 });
    expect(chrome.downloads.erase).toHaveBeenCalledWith({ id: 1 });
    vi.unstubAllGlobals();
  });

  it('says so when Chrome couldn’t save the note, or took too long', async () => {
    expect(await makeArchiveFolder(downloadsApi(['interrupted']))).toBe(false);
    expect(await makeArchiveFolder(downloadsApi(['in_progress']), 150)).toBe(false);
    expect(await makeArchiveFolder(downloadsApi([undefined]), 0)).toBe(false);
  });

  it('knows the Xomoni folder by its exact name', () => {
    expect(isArchiveFolder({ name: 'Xomoni' })).toBe(true);
    expect(isArchiveFolder({ name: 'Downloads' })).toBe(false);
    expect(isArchiveFolder({ name: 'xomoni' })).toBe(false);
  });

  it('keeps the Xomoni folder, and tells the service worker it was chosen', async () => {
    // IndexedDB keeps the browser's handle as it is; a plain stand-in here, since a test double has functions.
    const folder = { name: 'Xomoni' } as unknown as FolderHandle;
    const showDirectoryPicker = vi.fn(() => Promise.resolve(folder));
    const make = vi.fn(() => Promise.resolve(true));

    expect(await pickArchiveFolder(kvFolderStore, { showDirectoryPicker }, make)).toEqual({ folder });

    expect(make).toHaveBeenCalledOnce();
    expect(await kvGet('archiveFolderChosen', false)).toBe(true);
    expect(await expectingArchive()).toBe(true);
    await kvFolderStore.set(null);
    expect(await kvGet('archiveFolderChosen', true)).toBe(false);
    expect(await expectingArchive()).toBe(false);
  });

  it('refuses any other folder, and says why when none came back', async () => {
    const make = () => Promise.resolve(true);
    const other = folderWith([], 'granted', 'Downloads');
    expect(await pickArchiveFolder(kvFolderStore, { showDirectoryPicker: () => Promise.resolve(other) }, make)).toEqual(
      {
        problem: wrongFolder('Downloads'),
      },
    );
    const closed = () => Promise.reject(new DOMException('closed', 'AbortError'));
    expect(await pickArchiveFolder(kvFolderStore, { showDirectoryPicker: closed }, make)).toEqual({
      problem: FOLDER_NOT_CHOSEN,
    });
    expect(await kvGet('archiveFolderChosen', false)).toBe(false);
  });

  it('makes nothing and says nothing where the browser has no folder picker, or the picker fails', async () => {
    const make = vi.fn(() => Promise.resolve(true));
    expect(await pickArchiveFolder(kvFolderStore, {}, make)).toEqual({ problem: null });
    expect(make).not.toHaveBeenCalled();
    const broken = () => Promise.reject(new DOMException('no', 'SecurityError'));
    expect(await pickArchiveFolder(kvFolderStore, { showDirectoryPicker: broken }, make)).toEqual({ problem: null });
  });
});
