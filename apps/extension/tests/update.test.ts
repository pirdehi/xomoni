import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UPDATE_KEYS, db, kvGet, kvSet } from '../src/shared/db';
import { RUNNER_LOCK } from '../src/shared/runner-lock';
import { recentUpdate, recordUpdate } from '../src/shared/update-record';
import { RELEASE_HOSTS, releaseUrls } from '../src/update/download';
import type { OwnFolder } from '../src/update/own-folder';
import {
  UPDATE_LOCK,
  type UpdatePorts,
  type UpdateStep,
  browserPorts,
  chromeMajor,
  isZipInstall,
  oneClickState,
  putBackUnfinished,
  unfinishedUpdate,
  updateOutcome,
  updateTo,
  updateWriting,
} from '../src/update/update';
import { type UpdateJournal, kvJournal, kvShipped } from '../src/update/write';
import { stubChrome } from './support/chrome';
import { resetDb } from './support/fixtures';
import { type FolderFaults, memoryFolder, memoryStore, textOf } from './support/own-folder';
import { type Served, fakeGitHub, releaseFiles, releaseManifest, releaseZip, throwawayKeys } from './support/release';
import type { ZipSpec } from './support/zip';

const NAME = 'Xomoni — X Account Manager';
const NOW = 1_800_000_000_000;
const keys = await throwawayKeys();

/** Xomoni 0.4.0's folder, as Load unpacked left it. */
const installed = (faults: FolderFaults = {}, manifest: Record<string, unknown> = releaseManifest('0.4.0')) =>
  memoryFolder(
    'xomoni-extension',
    {
      'manifest.json': JSON.stringify(manifest),
      'sw.js': '// sw 0.4.0',
      'content.js': '// content 0.4.0',
      'dashboard.html': '<script src="assets/dashboard-OLD.js"></script>',
      'assets/dashboard-OLD.js': 'old',
    },
    faults,
  );

/** A signed release of 0.5.0 as GitHub would serve it, made with `files` and signed with `signer`. */
async function served(files: ZipSpec[] = releaseFiles('0.5.0'), signer = keys) {
  const zip = await releaseZip(files);
  return { zip, signature: await signer.sign(zip) };
}

/** The hex SHA-256 of `data`, as `SHA256SUMS` lists it. */
async function sha256(data: Uint8Array<ArrayBuffer>) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Everything the update touches, standing in for the browser: a 0.4.0 zip install with its folder chosen. */
function ports(
  folder: OwnFolder | null,
  github: { zip?: Served; signature?: Served },
  overrides: Partial<UpdatePorts> = {},
) {
  const fake = fakeGitHub('0.5.0', github);
  const reload = vi.fn();
  const permissions = {
    contains: vi.fn(() => Promise.resolve(true)),
    request: vi.fn(() => Promise.resolve(true)),
    remove: vi.fn(() => Promise.resolve(true)),
  };
  const store = memoryStore(folder);
  const all: Partial<UpdatePorts> = {
    fetch: fake.fetch,
    keys: [keys.publicKey],
    folders: store,
    permissions,
    host: { showDirectoryPicker: vi.fn(), navigator: { userActivation: { isActive: true } } },
    running: () => ({ name: NAME, version: '0.4.0' }),
    browserMajor: () => 140,
    zipInstall: () => Promise.resolve(true),
    jobRunning: () => Promise.resolve(false),
    reload,
    now: () => NOW,
    ...overrides,
  };
  return { all, calls: fake.calls, reload, permissions, store };
}

/** The folder's files, to compare before and after. */
const snapshot = (folder: { files: Map<string, Uint8Array> }) => new Map(folder.files);

/** The activity log's messages. */
const logLines = async () => (await db.logs.toArray()).map((l) => `${l.level}: ${l.message}`);

beforeEach(async () => {
  stubChrome();
  await resetDb();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a one-click update (#305)', () => {
  it('downloads, checks, writes, logs, remembers and reloads, in that order', async () => {
    const folder = installed();
    const github = await served();
    const { all, calls, reload } = ports(folder, github);
    const steps: UpdateStep[] = [];
    await kvSet('activeAccount', 'acc1');

    expect(await updateTo('0.5.0', (step) => steps.push(step), all)).toEqual({ ok: true, written: 6 });

    expect(steps).toEqual(['download', 'verify', 'write', 'reload']);
    expect(calls).toEqual([releaseUrls('0.5.0').zip, releaseUrls('0.5.0').signature]);
    expect(JSON.parse(textOf(folder, 'manifest.json'))).toMatchObject({ version: '0.5.0', name: NAME });
    expect(textOf(folder, 'sw.js')).toBe('// sw 0.5.0');
    // 0.4.0 was installed by hand: Xomoni doesn't know its files, so it removes none.
    expect(textOf(folder, 'assets/dashboard-OLD.js')).toBe('old');
    expect(reload).toHaveBeenCalledTimes(1);

    const [line] = await db.logs.toArray();
    expect(line).toMatchObject({ accountId: 'acc1', level: 'success', action: 'system', jobId: null });
    const sha = await sha256(github.zip);
    expect(line?.message).toBe(
      `Updated Xomoni from 0.4.0 to 0.5.0: the release’s signature checked out (key ${keys.publicKey.slice(0, 8)}…, zip SHA-256 ${sha}), 6 files written. Xomoni restarts now.`,
    );
    expect(await recentUpdate(NOW)).toEqual({ from: '0.4.0', to: '0.5.0', at: NOW });
    expect(await unfinishedUpdate()).toBeNull();
    expect((await kvShipped.get())?.version).toBe('0.5.0');
  });

  it('removes the files the previous one-click update wrote and this one doesn’t, and nothing else', async () => {
    const folder = installed();
    folder.files.set('assets/mine.txt', new TextEncoder().encode('the person’s'));
    await kvShipped.set({ version: '0.4.0', paths: ['assets/dashboard-OLD.js', 'sw.js', 'manifest.json'] });
    const { all } = ports(folder, await served());
    expect(await updateTo('0.5.0', undefined, all)).toEqual({ ok: true, written: 6 });
    expect(folder.files.has('assets/dashboard-OLD.js')).toBe(false);
    expect(textOf(folder, 'assets/mine.txt')).toBe('the person’s');
    expect(await logLines()).toEqual([expect.stringContaining('6 files written, 1 old ones removed.')]);
  });

  it('gives back the access to GitHub once it has downloaded, whatever happened', async () => {
    const ok = ports(installed(), await served());
    await updateTo('0.5.0', undefined, ok.all);
    expect(ok.permissions.remove).toHaveBeenCalledWith({ origins: [...RELEASE_HOSTS] });

    const offline = ports(installed(), { zip: 'offline' });
    expect((await updateTo('0.5.0', undefined, offline.all)).ok).toBe(false);
    expect(offline.permissions.remove).toHaveBeenCalledWith({ origins: [...RELEASE_HOSTS] });

    // Asked for, then the folder refused: given back before anything is downloaded.
    const refused = ports(installed({ permission: 'prompt', grantOnRequest: false }), await served());
    expect(await updateTo('0.5.0', undefined, refused.all)).toEqual({ ok: false, problem: 'folder-denied' });
    expect(refused.permissions.remove).toHaveBeenCalled();
    expect(refused.calls).toEqual([]);
  });

  it('reloads while it still holds the locks, so nothing starts between the write and the restart', async () => {
    let held: string[] = [];
    let writingAtReload: Promise<boolean> = Promise.resolve(false);
    const { all } = ports(installed(), await served(), {
      reload: () => {
        void navigator.locks.query().then((snapshot) => (held = (snapshot.held ?? []).map((lock) => lock.name ?? '')));
        writingAtReload = updateWriting();
      },
    });
    expect((await updateTo('0.5.0', undefined, all)).ok).toBe(true);
    await writingAtReload;
    expect(held).toEqual(expect.arrayContaining([RUNNER_LOCK, UPDATE_LOCK]));
    expect(await writingAtReload).toBe(true);
    expect(await updateWriting()).toBe(false);
  });

  it('finishes, and says so, when the journal can’t be forgotten after a complete write', async () => {
    const folder = installed();
    const kept: (UpdateJournal | null)[] = [];
    const journal = {
      get: () => Promise.resolve(kept.at(-1) ?? null),
      set: (next: UpdateJournal | null) =>
        next ? Promise.resolve(void kept.push(next)) : Promise.reject(new DOMException('Quota', 'QuotaExceededError')),
    };
    const { all, reload } = ports(folder, await served(), { journal });
    expect(await updateTo('0.5.0', undefined, all)).toEqual({ ok: true, written: 6 });
    expect(reload).toHaveBeenCalled();
    expect(kept).toHaveLength(1);
  });

  it('refuses a release that asks for more access than this version, which Chrome would never show', async () => {
    const folder = installed();
    const before = snapshot(folder);
    const wider = releaseFiles('0.5.0', releaseManifest('0.5.0', { permissions: ['tabs'] }));
    const { all, reload } = ports(folder, await served(wider));
    expect(await updateTo('0.5.0', undefined, all)).toEqual({ ok: false, problem: 'new-permissions' });
    expect(folder.files).toEqual(before);
    expect(reload).not.toHaveBeenCalled();
    expect(await logLines()).toEqual([
      expect.stringMatching(
        /^warn: Couldn’t update Xomoni to 0\.5\.0\. .*asks for more access.*\(permissions: tabs\)$/,
      ),
    ]);
  });

  it('refuses a release that needs a newer browser than this one', async () => {
    const needs = (minimum: string) =>
      releaseFiles('0.5.0', releaseManifest('0.5.0', { minimum_chrome_version: minimum }));
    const folder = installed();
    const before = snapshot(folder);
    const old = ports(folder, await served(needs('141')), { browserMajor: () => 140 });
    expect(await updateTo('0.5.0', undefined, old.all)).toEqual({ ok: false, problem: 'old-browser' });
    expect(folder.files).toEqual(before);
    expect(await logLines()).toEqual([expect.stringContaining('(it needs Chrome 141, and this browser is 140)')]);

    // A browser that can't be told apart needs no minimum at all, and a manifest's own value must be one.
    const unknown = ports(installed(), await served(needs('116')), { browserMajor: () => null });
    expect(await updateTo('0.5.0', undefined, unknown.all)).toEqual({ ok: false, problem: 'old-browser' });
    const odd = ports(installed(), await served(needs('soon')));
    expect(await updateTo('0.5.0', undefined, odd.all)).toEqual({ ok: false, problem: 'old-browser' });

    const same = ports(installed(), await served(needs('140.0.7339')), { browserMajor: () => 140 });
    expect(await updateTo('0.5.0', undefined, same.all)).toEqual({ ok: true, written: 6 });
  });

  it('reads the browser’s major version from its user agent', () => {
    const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)';
    expect(chromeMajor(`${chrome} Chrome/137.0.0.0 Safari/537.36`)).toBe(137);
    expect(chromeMajor(`${chrome} Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0`)).toBe(138);
    expect(chromeMajor('Mozilla/5.0 (X11; Linux x86_64) Chromium/120.0 Safari/537.36')).toBe(120);
    expect(chromeMajor('Mozilla/5.0 (Macintosh) Gecko/20100101 Firefox/140.0')).toBeNull();
    expect(chromeMajor('Node.js/26')).toBeNull();
  });

  describe('after one that didn’t finish', () => {
    it('refuses, writing nothing and keeping the only backup, until it is put back', async () => {
      // The review's case: sw.js 0.5.0 written, the manifest still 0.4.0, and putting sw.js back failed.
      const folder = installed({ failAttempts: { 'manifest.json': [1, 2], 'sw.js': [2] } });
      const first = ports(folder, await served());
      expect(await updateTo('0.5.0', undefined, first.all)).toEqual({ ok: false, problem: 'rollback-failed' });
      expect(textOf(folder, 'sw.js')).toBe('// sw 0.5.0');
      expect(JSON.parse(textOf(folder, 'manifest.json'))).toMatchObject({ version: '0.4.0' });
      const kept = await kvJournal.get();
      expect(kept).not.toBeNull();

      // A second click on *Update now*: nothing downloaded, nothing written, the journal as it was.
      const after = snapshot(folder);
      const second = ports(folder, await served());
      expect(await updateTo('0.5.0', undefined, second.all)).toEqual({ ok: false, problem: 'unfinished' });
      expect(second.calls).toEqual([]);
      expect(folder.files).toEqual(after);
      expect(await kvJournal.get()).toEqual(kept);

      // *Put back* restores 0.4.0 whole, from that journal.
      expect(await putBackUnfinished({ ...second.all })).toBe('restored');
      expect(textOf(folder, 'sw.js')).toBe('// sw 0.4.0');
      expect(await kvJournal.get()).toBeNull();
    });

    it('checks the journal and the folder again under the lock: another tab may have written meanwhile', async () => {
      const folder = installed();
      const github = await served();
      // While this tab downloads, another one leaves a journal behind.
      const { all, reload } = ports(folder, github, {
        fetch: async (input, init) => {
          await kvJournal.set({ from: '0.4.0', to: '0.5.0', at: 1, backups: [] });
          return fakeGitHub('0.5.0', github).fetch(input, init);
        },
      });
      expect(await updateTo('0.5.0', undefined, all)).toEqual({ ok: false, problem: 'unfinished' });
      expect(folder.writes).toEqual([]);
      expect(await kvJournal.get()).toMatchObject({ at: 1 });
      expect(reload).not.toHaveBeenCalled();

      // Or updates the folder itself: it no longer holds the version running.
      await kvJournal.set(null);
      const moved = installed();
      const raced = ports(moved, github, {
        fetch: (input, init) => {
          moved.files.set('manifest.json', new TextEncoder().encode(JSON.stringify(releaseManifest('0.5.0'))));
          return fakeGitHub('0.5.0', github).fetch(input, init);
        },
      });
      expect(await updateTo('0.5.0', undefined, raced.all)).toEqual({ ok: false, problem: 'wrong-folder' });
      expect(moved.writes).toEqual([]);
    });

    it('says an update is writing only while it holds its lock', async () => {
      expect(await updateWriting()).toBe(false);
      let during: boolean | undefined;
      const folder = installed({
        onWrite: () => {
          void updateWriting().then((now) => (during ??= now));
        },
      });
      expect((await updateTo('0.5.0', undefined, ports(folder, await served()).all)).ok).toBe(true);
      expect(during).toBe(true);
      expect(await updateWriting()).toBe(false);
    });
  });

  describe('changes nothing when the release can’t be trusted', () => {
    it.each([
      [
        'a tampered zip',
        async () => {
          const signed = await served();
          return { ...signed, zip: signed.zip.map((b, i) => (i === 40 ? b ^ 1 : b)) };
        },
      ],
      ['a signature by another key', async () => served(releaseFiles('0.5.0'), await throwawayKeys())],
      [
        'the signature of another release',
        async () => ({ zip: (await served()).zip, signature: (await served(releaseFiles('0.5.1'))).signature }),
      ],
    ])('%s: bad-signature, logged as an error', async (_, make) => {
      const folder = installed();
      const before = snapshot(folder);
      const { all, reload } = ports(folder, await make());

      expect(await updateTo('0.5.0', undefined, all)).toEqual({ ok: false, problem: 'bad-signature' });
      expect(folder.files).toEqual(before);
      expect(folder.writes).toEqual([]);
      expect(reload).not.toHaveBeenCalled();
      expect(await logLines()).toEqual([
        expect.stringMatching(
          /^error: Couldn’t update Xomoni to 0\.5\.0\. The download of Xomoni 0\.5\.0 isn’t signed/,
        ),
      ]);
    });

    it('a release with no signature: unsigned', async () => {
      const folder = installed();
      const before = snapshot(folder);
      const { all, reload } = ports(folder, { zip: (await served()).zip, signature: 404 });
      expect(await updateTo('0.5.0', undefined, all)).toEqual({ ok: false, problem: 'unsigned' });
      expect(folder.files).toEqual(before);
      expect(reload).not.toHaveBeenCalled();
      expect(await logLines()).toEqual([expect.stringMatching(/^warn: .*has no signature/)]);
    });

    it('a signed zip that would write outside the folder (zip-slip): bad-package, nothing written', async () => {
      const folder = installed();
      const before = snapshot(folder);
      const github = await served([...releaseFiles('0.5.0'), { path: '../../.zshrc', data: 'evil' }]);
      const { all } = ports(folder, github);
      expect(await updateTo('0.5.0', undefined, all)).toEqual({ ok: false, problem: 'bad-package' });
      expect(folder.files).toEqual(before);
      expect(await logLines()).toEqual([expect.stringContaining('(unsafe path "../../.zshrc")')]);
    });

    it('an older signed release served as the new one: wrong-version', async () => {
      const folder = installed();
      const before = snapshot(folder);
      const { all } = ports(folder, await served(releaseFiles('0.4.1')));
      expect(await updateTo('0.5.0', undefined, all)).toEqual({ ok: false, problem: 'wrong-version' });
      expect(folder.files).toEqual(before);
    });

    it('a release with another key, which Chrome would load as another extension: new-identity', async () => {
      const folder = installed();
      const before = snapshot(folder);
      const keyed = releaseFiles(
        '0.5.0',
        releaseManifest('0.5.0', { key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA' }),
      );
      const { all } = ports(folder, await served(keyed));
      expect(await updateTo('0.5.0', undefined, all)).toEqual({ ok: false, problem: 'new-identity' });
      expect(folder.files).toEqual(before);
      expect(await logLines()).toEqual([expect.stringContaining('Export your data first')]);
    });

    it('a release that keeps the folder’s key updates as usual', async () => {
      const key = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA';
      const folder = installed({}, releaseManifest('0.4.0', { key }));
      const { all } = ports(folder, await served(releaseFiles('0.5.0', releaseManifest('0.5.0', { key }))));
      expect(await updateTo('0.5.0', undefined, all)).toEqual({ ok: true, written: 6 });
    });
  });

  describe('changes nothing when the network fails', () => {
    it.each<[string, { zip?: Served; signature?: Served }]>([
      ['no network', { zip: 'offline' }],
      ['GitHub failing', { zip: 503 }],
      ['no zip in the release', { zip: 404 }],
      ['the network cut before the signature', { signature: 'offline' }],
    ])('%s: download-failed', async (_, github) => {
      const folder = installed();
      const before = snapshot(folder);
      const signed = await served();
      const { all, reload } = ports(folder, { ...signed, ...github });
      expect(await updateTo('0.5.0', undefined, all)).toEqual({ ok: false, problem: 'download-failed' });
      expect(folder.files).toEqual(before);
      expect(reload).not.toHaveBeenCalled();
    });
  });

  describe('never while a job runs', () => {
    it('refuses before downloading anything when the runner holds its lock', async () => {
      const folder = installed();
      const { all, calls } = ports(folder, await served());
      // The real check: whether any tab's runner holds the lock.
      delete all.jobRunning;
      const result = await navigator.locks.request(RUNNER_LOCK, () => updateTo('0.5.0', undefined, all));
      expect(result).toEqual({ ok: false, problem: 'busy' });
      expect(calls).toEqual([]);
      expect(folder.writes).toEqual([]);
    });

    it('refuses to write when a job took the lock while it downloaded', async () => {
      const folder = installed();
      const before = snapshot(folder);
      const { all, reload } = ports(folder, await served());
      // The lock is free when the update starts, and taken by the time it writes.
      let release: () => void = () => undefined;
      const job = navigator.locks.request(RUNNER_LOCK, () => new Promise<void>((resolve) => (release = resolve)));
      expect(await updateTo('0.5.0', undefined, all)).toEqual({ ok: false, problem: 'busy' });
      release();
      await job;
      expect(folder.files).toEqual(before);
      expect(reload).not.toHaveBeenCalled();
    });

    it('holds the lock while it writes, so no job can start then', async () => {
      const folder = installed();
      let heldDuringWrite: boolean | undefined;
      const { all } = ports(folder, await served());
      const original = folder.getDirectoryHandle.bind(folder);
      folder.getDirectoryHandle = async (name, options) => {
        if (options?.create) {
          const held = (await navigator.locks.query()).held!.map((l) => l.name);
          heldDuringWrite = held.includes(RUNNER_LOCK) && held.includes(UPDATE_LOCK);
        }
        return original(name, options);
      };
      expect((await updateTo('0.5.0', undefined, all)).ok).toBe(true);
      expect(heldDuringWrite).toBe(true);
    });
  });

  it('puts the old files back when a write fails, and says so', async () => {
    const folder = installed({ failWrite: new Set(['sw.js']) });
    const before = snapshot(folder);
    const { all, reload } = ports(folder, await served());
    expect(await updateTo('0.5.0', undefined, all)).toEqual({ ok: false, problem: 'write-failed' });
    expect([...folder.files.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [path, data] of before) expect(folder.files.get(path), path).toEqual(data);
    expect(reload).not.toHaveBeenCalled();
    expect(await unfinishedUpdate()).toBeNull();
    expect(await logLines()).toEqual([expect.stringMatching(/^warn: .*the old files were put back/)]);
  });

  describe('stops before anything when it can’t or shouldn’t update', () => {
    it.each<[string, (f: ReturnType<typeof installed>) => Partial<UpdatePorts>, string]>([
      ['a store install', () => ({ zipInstall: () => Promise.resolve(false) }), 'not-zip'],
      ['a build that trusts no key', () => ({ keys: [] }), 'no-key'],
      [
        'a browser without Ed25519',
        () => ({ subtle: { importKey: () => Promise.reject(new Error('no')) } as unknown as SubtleCrypto }),
        'unsupported',
      ],
      ['an older version', () => ({ running: () => ({ name: NAME, version: '0.6.0' }) }), 'not-newer'],
      ['the same version', () => ({ running: () => ({ name: NAME, version: '0.5.0' }) }), 'not-newer'],
      ['no folder chosen', () => ({ folders: memoryStore(null) }), 'no-folder'],
      [
        'an earlier update’s journal still kept',
        () => ({
          journal: {
            get: () => Promise.resolve({ from: '0.4.0', to: '0.5.0', at: 1, backups: [] }),
            set: () => Promise.reject(new Error('never written')),
          },
        }),
        'unfinished',
      ],
      [
        'GitHub refused',
        () => ({
          permissions: {
            contains: () => Promise.resolve(false),
            request: () => Promise.resolve(false),
            remove: () => Promise.resolve(false),
          },
        }),
        'download-denied',
      ],
      [
        'a folder of another version',
        () => ({ folders: memoryStore(installed({}, releaseManifest('0.3.0'))) }),
        'wrong-folder',
      ],
    ])('%s', async (_, make, problem) => {
      const folder = installed();
      const { all, calls } = ports(folder, await served(), make(folder));
      expect(await updateTo('0.5.0', undefined, all)).toEqual({ ok: false, problem });
      expect(calls).toEqual([]);
      expect(folder.writes).toEqual([]);
      expect(await logLines()).toEqual([]);
    });

    it('asks for the folder on the click, and needs another click when that one is used up', async () => {
      const prompt = installed({ permission: 'prompt' });
      const asked = ports(prompt, await served());
      expect(await updateTo('0.5.0', undefined, asked.all)).toEqual({ ok: true, written: 6 });
      expect(prompt.requests).toBe(1);

      const used = installed({ permission: 'prompt' });
      const { all, calls } = ports(used, await served(), {
        host: { navigator: { userActivation: { isActive: false } } },
      });
      expect(await updateTo('0.5.0', undefined, all)).toEqual({ ok: false, problem: 'needs-click' });
      expect(calls).toEqual([]);

      const refused = installed({ permission: 'prompt', grantOnRequest: false });
      expect(await updateTo('0.5.0', undefined, ports(refused, await served()).all)).toEqual({
        ok: false,
        problem: 'folder-denied',
      });
    });
  });

  it('lets an unexpected failure through, having written nothing', async () => {
    const folder = installed();
    const { all } = ports(folder, await served(), {
      folders: { get: () => Promise.reject(new Error('IndexedDB is gone')), set: () => Promise.resolve() },
    });
    await expect(updateTo('0.5.0', undefined, all)).rejects.toThrow('IndexedDB is gone');
    expect(folder.writes).toEqual([]);
  });
});

describe('whether one-click updates work here (#305)', () => {
  const base = (overrides: Partial<UpdatePorts> = {}): Partial<UpdatePorts> => ({
    keys: [keys.publicKey],
    zipInstall: () => Promise.resolve(true),
    host: { showDirectoryPicker: vi.fn() },
    folders: memoryStore(null),
    ...overrides,
  });

  it('says why not: a store install, no key, an old browser', async () => {
    expect(await oneClickState(base({ zipInstall: () => Promise.resolve(false) }))).toEqual({
      ready: false,
      why: 'not-zip',
    });
    expect(await oneClickState(base({ keys: [] }))).toEqual({ ready: false, why: 'no-key' });
    expect(await oneClickState(base({ host: {} }))).toEqual({ ready: false, why: 'unsupported' });
    const old = { importKey: () => Promise.reject(new Error('no')) } as unknown as SubtleCrypto;
    expect(await oneClickState(base({ subtle: old }))).toEqual({ ready: false, why: 'unsupported' });
  });

  it('names the folder chosen, if any', async () => {
    expect(await oneClickState(base())).toEqual({ ready: true, folder: null });
    expect(await oneClickState(base({ folders: memoryStore(installed()) }))).toEqual({
      ready: true,
      folder: 'xomoni-extension',
    });
  });

  it('knows a zip install from what Chrome says, or else from the manifest', async () => {
    const chrome = stubChrome();
    expect(await isZipInstall()).toBe(true);
    chrome.runtime.getManifest.mockReturnValue({
      version: '0.3.0',
      update_url: 'https://clients2.google.com/',
    } as never);
    expect(await isZipInstall()).toBe(false);
    vi.stubGlobal('chrome', {
      ...chrome,
      management: { getSelf: () => Promise.resolve({ installType: 'development' }) },
    });
    expect(await isZipInstall()).toBe(true);
    vi.stubGlobal('chrome', { ...chrome, management: { getSelf: () => Promise.resolve({ installType: 'normal' }) } });
    expect(await isZipInstall()).toBe(false);
  });

  it('uses Chrome’s own APIs in the dashboard', async () => {
    const chrome = stubChrome();
    const permissions = {
      contains: vi.fn(() => Promise.resolve(true)),
      request: vi.fn(() => Promise.resolve(false)),
      remove: vi.fn(() => Promise.resolve(true)),
    };
    const reload = vi.fn();
    vi.stubGlobal('chrome', { ...chrome, permissions, runtime: { ...chrome.runtime, reload } });
    const fetcher = vi.fn(() => Promise.resolve(new Response('ok')));
    vi.stubGlobal('fetch', fetcher);
    const live = browserPorts();
    expect(await live.permissions.contains({ origins: ['https://github.com/*'] })).toBe(true);
    expect(await live.permissions.request({ origins: ['https://github.com/*'] })).toBe(false);
    expect(await live.permissions.remove({ origins: ['https://github.com/*'] })).toBe(true);
    expect(live.browserMajor()).toBe(chromeMajor(navigator.userAgent));
    live.reload();
    expect(reload).toHaveBeenCalled();
    expect(await (await live.fetch('https://github.com/x')).text()).toBe('ok');
    expect(await live.withLock((held) => Promise.resolve(held))).toBe(true);
    expect(await navigator.locks.request(RUNNER_LOCK, () => live.withLock((held) => Promise.resolve(held)))).toBe(
      false,
    );
    expect(await live.jobRunning()).toBe(false);
    expect(live.running().version).toBe('0.3.0');
    expect(live.now()).toBeGreaterThan(0);
  });
});

describe('an update cut short (#305)', () => {
  const journal: UpdateJournal = {
    from: '0.4.0',
    to: '0.5.0',
    at: NOW,
    backups: [
      { path: 'manifest.json', old: new TextEncoder().encode(JSON.stringify(releaseManifest('0.4.0'))) },
      { path: 'assets/dashboard-NEW123.js', old: null },
    ],
  };
  /** The folder as the cut-short update left it: `holds` in its manifest, and the new asset written. */
  const halfWritten = (holds = '0.5.0', faults: FolderFaults = {}) =>
    memoryFolder(
      'xomoni-extension',
      { 'manifest.json': JSON.stringify(releaseManifest(holds)), 'assets/dashboard-NEW123.js': 'new' },
      faults,
    );
  /** 0.4.0 running, with `folder` chosen. */
  const at040 = (folder: OwnFolder | null, overrides: Partial<UpdatePorts> = {}): Partial<UpdatePorts> => ({
    folders: memoryStore(folder),
    running: () => ({ name: NAME, version: '0.4.0' }),
    reload: vi.fn(),
    ...overrides,
  });

  it('is found from its journal', async () => {
    expect(await unfinishedUpdate()).toBeNull();
    await kvJournal.set(journal);
    expect(await unfinishedUpdate()).toEqual({ from: '0.4.0', to: '0.5.0' });
  });

  it('is put back on a click, logged, and Xomoni reloads, under the locks', async () => {
    for (const holds of ['0.5.0', '0.4.0']) {
      await kvJournal.set(journal);
      await db.logs.clear();
      const folder = halfWritten(holds);
      let writing: Promise<boolean> = Promise.resolve(false);
      const reload = vi.fn(() => void (writing = updateWriting()));
      expect(await putBackUnfinished(at040(folder, { reload }))).toBe('restored');
      expect(JSON.parse(textOf(folder, 'manifest.json'))).toMatchObject({ version: '0.4.0' });
      expect(folder.files.has('assets/dashboard-NEW123.js')).toBe(false);
      expect(reload).toHaveBeenCalled();
      expect(await writing).toBe(true);
      expect(await unfinishedUpdate()).toBeNull();
      expect(await logLines()).toEqual([
        'success: Put back Xomoni 0.4.0: the update to 0.5.0 hadn’t finished. Xomoni restarts now.',
      ]);
    }
    expect(await putBackUnfinished(at040(halfWritten()))).toBe('done');
  });

  it('is forgotten, not put back, when Xomoni already runs the version it was writing', async () => {
    await kvJournal.set(journal);
    const folder = halfWritten();
    const before = snapshot(folder);
    const reload = vi.fn();
    expect(await putBackUnfinished(at040(folder, { running: () => ({ name: NAME, version: '0.5.0' }), reload }))).toBe(
      'done',
    );
    expect(folder.files).toEqual(before);
    expect(reload).not.toHaveBeenCalled();
    expect(await kvJournal.get()).toBeNull();
    expect(await logLines()).toEqual([expect.stringMatching(/^info: The update to Xomoni 0\.5\.0 had finished/)]);
  });

  it('is forgotten, saying why, when Xomoni runs another version, or the folder holds one', async () => {
    await kvJournal.set(journal);
    const folder = halfWritten();
    const before = snapshot(folder);
    expect(await putBackUnfinished(at040(folder, { running: () => ({ name: NAME, version: '0.6.0' }) }))).toBe('stale');
    expect(folder.files).toEqual(before);
    expect(await kvJournal.get()).toBeNull();

    await kvJournal.set(journal);
    const other = halfWritten('0.3.0');
    const otherBefore = snapshot(other);
    expect(await putBackUnfinished(at040(other))).toBe('stale');
    expect(other.files).toEqual(otherBefore);
    expect(await kvJournal.get()).toBeNull();

    await kvJournal.set(journal);
    const empty = memoryFolder('Downloads', {});
    expect(await putBackUnfinished(at040(empty))).toBe('stale');
    expect(empty.writes).toEqual([]);

    expect(await logLines()).toEqual([
      expect.stringMatching(/^warn: .*this Xomoni runs 0\.6\.0, and putting that backup back would mix versions\.$/),
      expect.stringMatching(/^warn: .*the folder “xomoni-extension” holds Xomoni 0\.3\.0 now/),
      expect.stringMatching(/^warn: .*the folder “Downloads” holds no Xomoni now/),
    ]);
  });

  it('says why it couldn’t be put back, and keeps the journal then', async () => {
    await kvJournal.set(journal);
    const reload = vi.fn();
    expect(await putBackUnfinished(at040(null, { reload }))).toBe('no-folder');
    expect(
      await putBackUnfinished(
        at040(halfWritten('0.5.0', { permission: 'prompt' }), {
          host: { navigator: { userActivation: { isActive: false } } },
          reload,
        }),
      ),
    ).toBe('needs-click');
    expect(
      await putBackUnfinished(
        at040(halfWritten('0.5.0', { permission: 'prompt', grantOnRequest: false }), { host: {} }),
      ),
    ).toBe('folder-denied');
    const stuck = halfWritten('0.5.0', {
      failWrite: new Set(['manifest.json']),
      failAlways: new Set(['manifest.json']),
    });
    expect(await navigator.locks.request(RUNNER_LOCK, () => putBackUnfinished(at040(stuck, { reload })))).toBe('busy');
    expect(await putBackUnfinished(at040(stuck, { reload }))).toBe('failed');
    expect(reload).not.toHaveBeenCalled();
    expect(await unfinishedUpdate()).not.toBeNull();
    expect(await logLines()).toEqual([expect.stringMatching(/^error: Couldn’t put back every file of Xomoni 0\.4\.0/)]);
  });
});

describe('after the reload (#305)', () => {
  it('says the new version runs, once', async () => {
    await recordUpdate({ from: '0.4.0', to: '0.5.0', at: NOW });
    const running = () => ({ name: NAME, version: '0.5.0' });
    expect(await updateOutcome({ running })).toEqual({ took: true, version: '0.5.0' });
    expect(await updateOutcome({ running })).toBeNull();
  });

  it('forgets a folder Chrome doesn’t load Xomoni from, and logs it', async () => {
    await recordUpdate({ from: '0.4.0', to: '0.5.0', at: NOW });
    const folders = memoryStore(installed());
    expect(await updateOutcome({ running: () => ({ name: NAME, version: '0.4.0' }), folders })).toEqual({
      took: false,
      version: '0.5.0',
      running: '0.4.0',
    });
    expect(folders.folder).toBeNull();
    expect(await logLines()).toEqual([
      expect.stringMatching(/^warn: The update to Xomoni 0\.5\.0 was written, but Chrome still runs 0\.4\.0/),
    ]);
  });

  it('says nothing about a record of other versions, and keeps the folder', async () => {
    await recordUpdate({ from: '0.2.0', to: '0.3.0', at: NOW });
    const folders = memoryStore(installed());
    expect(await updateOutcome({ running: () => ({ name: NAME, version: '0.4.0' }), folders })).toBeNull();
    expect(folders.folder).not.toBeNull();
    expect(await logLines()).toEqual([]);
  });

  it('forgets a journal the update left when it couldn’t, once the new version runs', async () => {
    await kvJournal.set({ from: '0.4.0', to: '0.5.0', at: NOW, backups: [] });
    await recordUpdate({ from: '0.4.0', to: '0.5.0', at: NOW });
    expect(await updateOutcome({ running: () => ({ name: NAME, version: '0.5.0' }) })).toEqual({
      took: true,
      version: '0.5.0',
    });
    expect(await kvJournal.get()).toBeNull();
  });

  it('keeps a journal Xomoni can still put back, and forgets one for other versions', async () => {
    await kvJournal.set({ from: '0.4.0', to: '0.5.0', at: NOW, backups: [] });
    expect(await updateOutcome({ running: () => ({ name: NAME, version: '0.4.0' }) })).toBeNull();
    expect(await kvJournal.get()).not.toBeNull();
    expect(await updateOutcome({ running: () => ({ name: NAME, version: '0.7.0' }) })).toBeNull();
    expect(await kvJournal.get()).toBeNull();
    expect(await logLines()).toEqual([expect.stringMatching(/^warn: Forgot the backup .*this Xomoni runs 0\.7\.0/)]);
  });

  it('keeps the update’s values through *Delete local data*', async () => {
    await kvJournal.set({ from: '0.4.0', to: '0.5.0', at: NOW, backups: [] });
    await kvSet(UPDATE_KEYS.folder, { name: 'xomoni-extension' });
    const { wipeLocalData } = await import('../src/shared/db');
    await wipeLocalData();
    expect(await unfinishedUpdate()).toEqual({ from: '0.4.0', to: '0.5.0' });
    expect(await kvGet(UPDATE_KEYS.folder, null)).toEqual({ name: 'xomoni-extension' });
  });
});
