// The one-click update of a zip install (#305, ADR-0033), step by step. On the person's click, and only while no job
// runs, Xomoni downloads the release from this repository's GitHub releases, checks its Ed25519 signature against the
// keys this build trusts, reads and checks the zip, writes it into the folder the person chose (all or nothing, see
// `write.ts`) while holding the runner's Web Lock, writes it to the activity log, and reloads itself. Chrome keeps the
// extension's id and data, since the folder and its `key` stay the same. Every check comes before the first write.
import { addLog, kvGet } from '../shared/db';
import { asString } from '../shared/json';
import { RUNNER_LOCK, runnerLockHeld } from '../shared/runner-lock';
import type { LogLevel } from '../shared/types';
import { recordUpdate, takeUpdateRecord } from '../shared/update-record';
import { isNewer } from '../shared/version';
import {
  MAX_SIGNATURE_BYTES,
  MAX_ZIP_BYTES,
  type PermissionsApi,
  downloadAccess,
  downloadFile,
  releaseUrls,
} from './download';
import {
  type OwnFolderStore,
  type PickerHost,
  type RunningXomoni,
  checkOwnFolder,
  folderAccess,
  kvOwnFolderStore,
  runningXomoni,
} from './own-folder';
import { UpdateFailure, type UpdateProblem, problemText } from './problems';
import { readRelease } from './release-zip';
import { RELEASE_KEYS, ed25519Available, signedBy } from './signature';
import { type JournalStore, kvJournal, restoreJournal, writeRelease } from './write';

/** What the update is doing, for the dashboard to say. */
export type UpdateStep = 'download' | 'verify' | 'write' | 'reload';

/** Everything the update touches outside itself, so tests can stand in for the browser. */
export interface UpdatePorts {
  fetch: typeof fetch;
  subtle: SubtleCrypto;
  /** The public keys trusted to sign a release (`RELEASE_KEYS`). */
  keys: readonly string[];
  folders: OwnFolderStore;
  journal: JournalStore;
  permissions: PermissionsApi;
  host: PickerHost;
  running: () => RunningXomoni;
  /** Whether Xomoni was loaded unpacked (a zip install), the only kind it updates itself. */
  zipInstall: () => Promise<boolean>;
  jobRunning: () => Promise<boolean>;
  /** Runs `work` holding the runner's Web Lock if it is free; `held` says whether it was. */
  withLock: <T>(work: (held: boolean) => Promise<T>) => Promise<T>;
  reload: () => void;
  now: () => number;
}

/**
 * Whether Xomoni was loaded unpacked. `chrome.management.getSelf` says so without the `management` permission; where
 * it can't, a manifest without the `update_url` a store adds is taken for one.
 */
export async function isZipInstall(): Promise<boolean> {
  try {
    return (await chrome.management.getSelf()).installType === 'development';
  } catch {
    return !('update_url' in chrome.runtime.getManifest());
  }
}

/** The browser's own parts, as the dashboard uses them. */
export function browserPorts(): UpdatePorts {
  return {
    fetch: (input, init) => fetch(input, init),
    subtle: crypto.subtle,
    keys: RELEASE_KEYS,
    folders: kvOwnFolderStore,
    journal: kvJournal,
    permissions: {
      contains: (permissions) => chrome.permissions.contains(permissions),
      request: (permissions) => chrome.permissions.request(permissions),
    },
    host: globalThis,
    running: runningXomoni,
    zipInstall: isZipInstall,
    jobRunning: runnerLockHeld,
    withLock: <T>(work: (held: boolean) => Promise<T>) =>
      navigator.locks.request(RUNNER_LOCK, { ifAvailable: true }, (lock) => work(!!lock)) as Promise<T>,
    reload: () => chrome.runtime.reload(),
    now: Date.now,
  };
}

/** Writes a line about the update to the activity log, under the active X account (or none). */
async function log(level: LogLevel, message: string) {
  const account = await kvGet<string | null>('activeAccount', null);
  await addLog({
    accountId: account ?? '',
    jobId: null,
    level,
    action: 'system',
    targetId: null,
    outcome: null,
    message,
  });
}

/** The problems worth a line in the activity log: those about the release or the folder's files, not the setup. */
const LOGGED: ReadonlySet<UpdateProblem> = new Set<UpdateProblem>([
  'download-failed',
  'unsigned',
  'bad-signature',
  'bad-package',
  'wrong-version',
  'new-identity',
  'write-failed',
  'rollback-failed',
]);

/** The hex SHA-256 of `data`, to compare with the release's `SHA256SUMS`. */
async function sha256(subtle: SubtleCrypto, data: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await subtle.digest('SHA-256', data));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** How an update ended: written (and Xomoni is reloading), or why not, with nothing changed unless it says so. */
export type UpdateResult = { ok: true; written: number } | { ok: false; problem: UpdateProblem };

/** Stops the update for `problem`. */
function stop(problem: UpdateProblem, detail?: string): never {
  throw new UpdateFailure(problem, detail);
}

/**
 * Updates this Xomoni to `version`, on the person's click (Chrome's prompts need it): the checks, the download, the
 * signature, the package, then the write under the runner's lock, the log line, the record for after the reload, and
 * the reload. `onStep` hears each step as it starts. Returns why it stopped; nothing is written before every check
 * passed, and a failed write is undone.
 */
export async function updateTo(
  version: string,
  onStep: (step: UpdateStep) => void = () => undefined,
  overrides: Partial<UpdatePorts> = {},
): Promise<UpdateResult> {
  const ports = { ...browserPorts(), ...overrides };
  const running = ports.running();
  try {
    if (!(await ports.zipInstall())) stop('not-zip');
    if (!ports.keys.length) stop('no-key');
    if (!(await ed25519Available(ports.subtle))) stop('unsupported');
    if (!isNewer(version, running.version)) stop('not-newer');
    if (await ports.jobRunning()) stop('busy');
    const folder = await ports.folders.get();
    if (!folder) stop('no-folder');
    // Both prompts need the click: GitHub's first, since the folder's is often granted for good already.
    if (!(await downloadAccess(ports.permissions))) stop('download-denied');
    const access = await folderAccess(folder, true, ports.host);
    if (access !== 'granted') stop(access === 'denied' ? 'folder-denied' : 'needs-click');
    const check = await checkOwnFolder(folder, running);
    if (!check.ok) stop('wrong-folder');

    onStep('download');
    const urls = releaseUrls(version);
    const zip = await downloadFile(urls.zip, MAX_ZIP_BYTES, ports.fetch);
    if (!zip) stop('download-failed', 'the release has no zip');
    const signature = await downloadFile(urls.signature, MAX_SIGNATURE_BYTES, ports.fetch);
    if (!signature) stop('unsigned');

    onStep('verify');
    const key = await signedBy(zip, signature, ports.keys, ports.subtle);
    if (!key) stop('bad-signature');
    const release = await readRelease(new Blob([zip]), version);
    const folderKey = asString(check.manifest.key) ?? null;
    if (release.key !== folderKey) stop('new-identity');
    const digest = await sha256(ports.subtle, zip);

    onStep('write');
    const written = await ports.withLock(async (held) => {
      if (!held) stop('busy');
      const result = await writeRelease(
        folder,
        release.files,
        { from: running.version, to: version, at: ports.now() },
        ports.journal,
      );
      const removed = result.removed ? `, ${result.removed} old ones removed` : '';
      await log(
        'success',
        `Updated Xomoni from ${running.version} to ${version}: the release’s signature checked out (key ${key.slice(0, 8)}…, zip SHA-256 ${digest}), ${result.written} files written${removed}. Xomoni restarts now.`,
      ).catch(() => undefined);
      await recordUpdate({ from: running.version, to: version, at: ports.now() }).catch(() => undefined);
      return result.written;
    });
    onStep('reload');
    ports.reload();
    return { ok: true, written };
  } catch (err) {
    if (!(err instanceof UpdateFailure)) throw err;
    if (LOGGED.has(err.problem)) {
      const text = problemText(err.problem, version, running.version);
      const level = err.problem === 'bad-signature' || err.problem === 'rollback-failed' ? 'error' : 'warn';
      await log(level, `Couldn’t update Xomoni to ${version}. ${text}${err.detail ? ` (${err.detail})` : ''}`).catch(
        () => undefined,
      );
    }
    return { ok: false, problem: err.problem };
  }
}

/** Whether one-click updates can work here, and the folder chosen for them (its name), if any. */
export type OneClickState =
  | { ready: true; folder: string | null }
  | { ready: false; why: Extract<UpdateProblem, 'not-zip' | 'no-key' | 'unsupported'> };

/**
 * Whether this Xomoni can update itself in one click: a zip install, a build that trusts a signing key, a browser with
 * Ed25519 and the folder picker. Says which folder was chosen, so the dashboard offers to choose one or to update.
 */
export async function oneClickState(overrides: Partial<UpdatePorts> = {}): Promise<OneClickState> {
  const ports = { ...browserPorts(), ...overrides };
  if (!(await ports.zipInstall())) return { ready: false, why: 'not-zip' };
  if (!ports.keys.length) return { ready: false, why: 'no-key' };
  if (typeof ports.host.showDirectoryPicker !== 'function' || !(await ed25519Available(ports.subtle))) {
    return { ready: false, why: 'unsupported' };
  }
  const folder = await ports.folders.get();
  return { ready: true, folder: folder?.name ?? null };
}

/** An update that didn't finish writing (its journal is still kept): from which version, to which. */
export async function unfinishedUpdate(
  overrides: Partial<UpdatePorts> = {},
): Promise<{ from: string; to: string } | null> {
  const journal = await (overrides.journal ?? kvJournal).get();
  return journal ? { from: journal.from, to: journal.to } : null;
}

/** How putting back an unfinished update went. */
export type PutBackResult = 'restored' | 'failed' | 'busy' | 'no-folder' | 'needs-click' | 'folder-denied';

/**
 * Puts back the version an unfinished update replaced (`restoreJournal`), on the person's click and while no job
 * runs, logs it, and reloads Xomoni so Chrome runs that version whole again.
 */
export async function putBackUnfinished(overrides: Partial<UpdatePorts> = {}): Promise<PutBackResult> {
  const ports = { ...browserPorts(), ...overrides };
  const journal = await ports.journal.get();
  if (!journal) return 'restored';
  const folder = await ports.folders.get();
  if (!folder) return 'no-folder';
  const access = await folderAccess(folder, true, ports.host);
  if (access !== 'granted') return access === 'denied' ? 'folder-denied' : 'needs-click';
  const restored = await ports.withLock(async (held) => (held ? restoreJournal(folder, ports.journal) : null));
  if (restored === null) return 'busy';
  await log(
    restored ? 'success' : 'error',
    restored
      ? `Put back Xomoni ${journal.from}: the update to ${journal.to} hadn’t finished. Xomoni restarts now.`
      : `Couldn’t put back every file of Xomoni ${journal.from} after the unfinished update to ${journal.to}.`,
  ).catch(() => undefined);
  if (!restored) return 'failed';
  ports.reload();
  return 'restored';
}

/** What happened to the update written before the reload: the new version runs, or Chrome still runs the old one. */
export type UpdateOutcome = { took: true; version: string } | { took: false; version: string; running: string };

/**
 * Reports the update written before the reload, once (the first dashboard to ask takes it). When Chrome still runs
 * the old version, the folder written to isn't the one Chrome loads Xomoni from: it is forgotten, and the log says so.
 */
export async function updateOutcome(overrides: Partial<UpdatePorts> = {}): Promise<UpdateOutcome | null> {
  const record = await takeUpdateRecord();
  if (!record) return null;
  const ports = { ...browserPorts(), ...overrides };
  const current = ports.running().version;
  if (current === record.to) return { took: true, version: record.to };
  await ports.folders.set(null);
  await log(
    'warn',
    `The update to Xomoni ${record.to} was written, but Chrome still runs ${current}: it loads Xomoni from another folder. Choose that folder to update in one click.`,
  ).catch(() => undefined);
  return { took: false, version: record.to, running: current };
}
