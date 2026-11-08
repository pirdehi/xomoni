import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ARCHIVE_FILE,
  canRead,
  chooseFolder,
  fileKey,
  markArchiveSeen,
  newestArchive,
  seenArchives,
} from '../../src/ui/downloads-folder';
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
