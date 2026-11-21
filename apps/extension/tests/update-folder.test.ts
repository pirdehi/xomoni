import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type OwnFolder,
  type PickerHost,
  checkOwnFolder,
  folderAccess,
  folderProblemText,
  kvOwnFolderStore,
  pickOwnFolder,
  readFolderManifest,
  runningXomoni,
} from '../src/update/own-folder';
import { stubChrome } from './support/chrome';
import { resetDb } from './support/fixtures';
import { memoryFolder, memoryStore } from './support/own-folder';
import { releaseManifest } from './support/release';

const RUNNING = { name: 'Xomoni — X Account Manager', version: '0.4.0' };
const xomoniFolder = (version = '0.4.0', extra: Record<string, unknown> = {}) =>
  memoryFolder('xomoni-extension', { 'manifest.json': JSON.stringify(releaseManifest(version, extra)), 'sw.js': '' });

/** A host whose picker answers with `folder`, or fails with `error`. */
const pickerHost = (answer: OwnFolder | DOMException, active = true) => {
  const showDirectoryPicker = vi.fn((_options: { id?: string; mode?: 'readwrite' }) =>
    answer instanceof DOMException ? Promise.reject(answer) : Promise.resolve(answer),
  );
  return { showDirectoryPicker, navigator: { userActivation: { isActive: active } } } satisfies PickerHost;
};

describe('Xomoni’s own folder (#305)', () => {
  it('is this Xomoni’s when its manifest names this extension at this version', async () => {
    const check = await checkOwnFolder(xomoniFolder(), RUNNING);
    expect(check.ok).toBe(true);
    expect(check.ok && check.manifest.version).toBe('0.4.0');
  });

  it('is another copy when it holds another version', async () => {
    expect(await checkOwnFolder(xomoniFolder('0.3.0'), RUNNING)).toEqual({
      ok: false,
      why: 'other-version',
      version: '0.3.0',
    });
  });

  it('isn’t Xomoni’s without a manifest, with another extension’s, or one that can’t be read', async () => {
    expect(await checkOwnFolder(memoryFolder('Downloads', { 'notes.txt': 'hi' }), RUNNING)).toEqual({
      ok: false,
      why: 'not-xomoni',
    });
    const other = memoryFolder('other', { 'manifest.json': JSON.stringify({ name: 'Other', version: '0.4.0' }) });
    expect((await checkOwnFolder(other, RUNNING)).ok).toBe(false);
    expect(await readFolderManifest(memoryFolder('x', { 'manifest.json': '{oops' }))).toBeNull();
    expect(await readFolderManifest(memoryFolder('x', { 'manifest.json': '"text"' }))).toBeNull();
    const huge = memoryFolder('x', { 'manifest.json': `{"name":"${'a'.repeat(300 * 1024)}"}` });
    expect(await readFolderManifest(huge)).toBeNull();
    const unreadable = memoryFolder('x', { 'manifest.json': '{}' }, { failRead: new Set(['manifest.json']) });
    expect(await readFolderManifest(unreadable)).toBeNull();
  });

  it('says why a folder isn’t this Xomoni’s, and where Chrome shows the right one', () => {
    expect(folderProblemText('Downloads', { ok: false, why: 'not-xomoni' }, '0.4.0')).toMatch(
      /^“Downloads” isn’t Xomoni’s folder: it has no Xomoni manifest\.json\. .*Details, under Source\.$/,
    );
    expect(folderProblemText('old', { ok: false, why: 'other-version', version: '0.3.0' }, '0.4.0')).toContain(
      '“old” holds Xomoni 0.3.0, but this one is 0.4.0.',
    );
    expect(folderProblemText('old', { ok: false, why: 'other-version', version: '' }, '0.4.0')).toContain(
      'holds Xomoni of another version',
    );
  });
});

describe('choosing the folder (#305)', () => {
  it('asks for read and write access in the picker, and keeps the folder when it is this Xomoni’s', async () => {
    const store = memoryStore();
    const folder = xomoniFolder();
    const host = pickerHost(folder);
    expect(await pickOwnFolder(store, RUNNING, host)).toEqual({ folder });
    expect(host.showDirectoryPicker).toHaveBeenCalledWith({ id: 'xomoni-folder', mode: 'readwrite' });
    expect(store.folder).toBe(folder);
  });

  it('keeps nothing, and says why, for the wrong folder', async () => {
    const store = memoryStore();
    const pick = await pickOwnFolder(store, RUNNING, pickerHost(memoryFolder('Downloads')));
    expect(pick.problem).toContain('“Downloads” isn’t Xomoni’s folder');
    const copy = await pickOwnFolder(store, RUNNING, pickerHost(xomoniFolder('0.3.0')));
    expect(copy.problem).toContain('holds Xomoni 0.3.0');
    expect(store.folder).toBeNull();
  });

  it('says nothing when the picker is closed, and why when Chrome refuses the folder', async () => {
    const store = memoryStore();
    expect(await pickOwnFolder(store, RUNNING, pickerHost(new DOMException('', 'AbortError')))).toEqual({
      problem: null,
    });
    const refused = await pickOwnFolder(store, RUNNING, pickerHost(new DOMException('System folder', 'SecurityError')));
    expect(refused.problem).toBe('Chrome didn’t let Xomoni use that folder. Choose the folder you loaded Xomoni from.');
    expect(await pickOwnFolder(store, RUNNING, {})).toEqual({ problem: null });
    expect(store.folder).toBeNull();
  });
});

describe('writing to the folder (#305)', () => {
  it('may write when Chrome kept the permission (Allow on every visit)', async () => {
    const folder = memoryFolder('x');
    expect(await folderAccess(folder, false, {})).toBe('granted');
    expect(folder.requests).toBe(0);
    expect(await folderAccess({ ...folder, queryPermission: undefined }, false, {})).toBe('granted');
  });

  it('asks again on a click, and only then', async () => {
    const folder = memoryFolder('x', {}, { permission: 'prompt' });
    expect(await folderAccess(folder, false, {})).toBe('needs-click');
    expect(folder.requests).toBe(0);
    expect(await folderAccess(folder, true, { navigator: { userActivation: { isActive: true } } })).toBe('granted');
    expect(folder.requests).toBe(1);
  });

  it('needs a fresh click when the click was used up by another prompt', async () => {
    const folder = memoryFolder('x', {}, { permission: 'prompt' });
    expect(await folderAccess(folder, true, { navigator: { userActivation: { isActive: false } } })).toBe(
      'needs-click',
    );
    expect(folder.requests).toBe(0);
    const throwing = { ...folder, requestPermission: () => Promise.reject(new DOMException('', 'SecurityError')) };
    expect(await folderAccess(throwing, true, {})).toBe('needs-click');
    expect(await folderAccess({ ...folder, requestPermission: undefined }, true, {})).toBe('needs-click');
  });

  it('is denied when the person says no', async () => {
    const folder = memoryFolder('x', {}, { permission: 'prompt', grantOnRequest: false });
    expect(await folderAccess(folder, true, {})).toBe('denied');
    expect(await folderAccess(memoryFolder('x', {}, { permission: 'denied' }), true, {})).toBe('denied');
  });
});

describe('the folder kept between visits (#305)', () => {
  beforeEach(async () => {
    stubChrome();
    await resetDb();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is kept in IndexedDB, as the browser keeps a handle, and forgotten on request', async () => {
    expect(await kvOwnFolderStore.get()).toBeNull();
    // A real handle survives IndexedDB's structured clone; a plain stand-in shows the round trip.
    const handle = { kind: 'directory', name: 'xomoni-extension' } as unknown as OwnFolder;
    await kvOwnFolderStore.set(handle);
    expect(await kvOwnFolderStore.get()).toEqual(handle);
    await kvOwnFolderStore.set(null);
    expect(await kvOwnFolderStore.get()).toBeNull();
  });

  it('identifies the running Xomoni by the name and version Chrome loaded', () => {
    vi.mocked(chrome.runtime.getManifest).mockReturnValue({
      name: 'Xomoni',
      version: '0.4.0',
      manifest_version: 3,
    });
    expect(runningXomoni()).toEqual({ name: 'Xomoni', version: '0.4.0' });
  });
});
