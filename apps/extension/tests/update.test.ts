import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, kvSet } from '../src/shared/db';
import { RUNNER_LOCK } from '../src/shared/runner-lock';
import { recentUpdate, recordUpdate } from '../src/shared/update-record';
import { releaseUrls } from '../src/update/download';
import type { OwnFolder } from '../src/update/own-folder';
import {
  type UpdatePorts,
  type UpdateStep,
  browserPorts,
  isZipInstall,
  oneClickState,
  putBackUnfinished,
  unfinishedUpdate,
  updateOutcome,
  updateTo,
} from '../src/update/update';
import { kvJournal } from '../src/update/write';
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
  const permissions = { contains: vi.fn(() => Promise.resolve(true)), request: vi.fn(() => Promise.resolve(true)) };
  const store = memoryStore(folder);
  const all: Partial<UpdatePorts> = {
    fetch: fake.fetch,
    keys: [keys.publicKey],
    folders: store,
    permissions,
    host: { showDirectoryPicker: vi.fn(), navigator: { userActivation: { isActive: true } } },
    running: () => ({ name: NAME, version: '0.4.0' }),
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
    expect(folder.files.has('assets/dashboard-OLD.js')).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);

    const [line] = await db.logs.toArray();
    expect(line).toMatchObject({ accountId: 'acc1', level: 'success', action: 'system', jobId: null });
    const sha = await sha256(github.zip);
    expect(line?.message).toBe(
      `Updated Xomoni from 0.4.0 to 0.5.0: the release’s signature checked out (key ${keys.publicKey.slice(0, 8)}…, zip SHA-256 ${sha}), 6 files written, 1 old ones removed. Xomoni restarts now.`,
    );
    expect(await recentUpdate(NOW)).toEqual({ from: '0.4.0', to: '0.5.0', at: NOW });
    expect(await unfinishedUpdate()).toBeNull();
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
        if (options?.create)
          heldDuringWrite = (await navigator.locks.query()).held!.some((l) => l.name === RUNNER_LOCK);
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
        'GitHub refused',
        () => ({ permissions: { contains: () => Promise.resolve(false), request: () => Promise.resolve(false) } }),
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
    const permissions = { contains: vi.fn(() => Promise.resolve(true)), request: vi.fn(() => Promise.resolve(false)) };
    const reload = vi.fn();
    vi.stubGlobal('chrome', { ...chrome, permissions, runtime: { ...chrome.runtime, reload } });
    const fetcher = vi.fn(() => Promise.resolve(new Response('ok')));
    vi.stubGlobal('fetch', fetcher);
    const live = browserPorts();
    expect(await live.permissions.contains({ origins: ['https://github.com/*'] })).toBe(true);
    expect(await live.permissions.request({ origins: ['https://github.com/*'] })).toBe(false);
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
  const journal = {
    from: '0.4.0',
    to: '0.5.0',
    at: NOW,
    backups: [
      { path: 'manifest.json', old: new TextEncoder().encode(JSON.stringify(releaseManifest('0.4.0'))) },
      { path: 'assets/dashboard-NEW123.js', old: null },
    ],
  };

  it('is found from its journal', async () => {
    expect(await unfinishedUpdate()).toBeNull();
    await kvJournal.set(journal);
    expect(await unfinishedUpdate()).toEqual({ from: '0.4.0', to: '0.5.0' });
  });

  it('is put back on a click, logged, and Xomoni reloads', async () => {
    const folder = memoryFolder('xomoni-extension', {
      'manifest.json': JSON.stringify(releaseManifest('0.5.0')),
      'assets/dashboard-NEW123.js': 'new',
    });
    await kvJournal.set(journal);
    const reload = vi.fn();
    expect(await putBackUnfinished({ folders: memoryStore(folder), reload })).toBe('restored');
    expect((JSON.parse(textOf(folder, 'manifest.json')) as { version: string }).version).toBe('0.4.0');
    expect(folder.files.has('assets/dashboard-NEW123.js')).toBe(false);
    expect(reload).toHaveBeenCalled();
    expect(await unfinishedUpdate()).toBeNull();
    expect(await logLines()).toEqual([
      'success: Put back Xomoni 0.4.0: the update to 0.5.0 hadn’t finished. Xomoni restarts now.',
    ]);
    expect(await putBackUnfinished({ folders: memoryStore(folder), reload })).toBe('restored');
  });

  it('says why it couldn’t be put back', async () => {
    await kvJournal.set(journal);
    const reload = vi.fn();
    expect(await putBackUnfinished({ folders: memoryStore(null), reload })).toBe('no-folder');
    const prompt = memoryFolder('x', {}, { permission: 'prompt' });
    expect(
      await putBackUnfinished({
        folders: memoryStore(prompt),
        host: { navigator: { userActivation: { isActive: false } } },
        reload,
      }),
    ).toBe('needs-click');
    const refused = memoryFolder('x', {}, { permission: 'prompt', grantOnRequest: false });
    expect(await putBackUnfinished({ folders: memoryStore(refused), host: {}, reload })).toBe('folder-denied');
    const folder = memoryFolder(
      'x',
      {},
      { failWrite: new Set(['manifest.json']), failAlways: new Set(['manifest.json']) },
    );
    expect(
      await navigator.locks.request(RUNNER_LOCK, () => putBackUnfinished({ folders: memoryStore(folder), reload })),
    ).toBe('busy');
    expect(await putBackUnfinished({ folders: memoryStore(folder), reload })).toBe('failed');
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
});
