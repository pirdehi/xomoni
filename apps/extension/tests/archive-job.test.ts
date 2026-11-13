import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ARCHIVE_DOWNLOADING,
  ARCHIVE_NOTHING_ON_X,
  ARCHIVE_PREPARING,
  UNKNOWN_ARCHIVE_PAGE,
  pressFailed,
  runArchive,
} from '../src/engine/archive';
import { JobContext, NeedsYou, Stop } from '../src/engine/context';
import { Limiter } from '../src/engine/limiter';
import type { EnginePorts } from '../src/engine/ports';
import { ARCHIVE_TITLE, archiveJob } from '../src/engine/runner';
import type * as Timers from '../src/engine/timers';
import { needMessage } from '../src/shared/attention';
import { archiveDownloadTarget } from '../src/background/archive-downloads';
import { archiveRequest, db, expectingArchive, saveArchiveRequest, setArchiveFolderChosen } from '../src/shared/db';
import type { ActorCommand, ArchivePressResult, ArchiveState } from '../src/shared/messages';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { DAY, HOUR } from '../src/shared/time';
import type { Job } from '../src/shared/types';
import {
  ARCHIVE_FOLDER,
  ARCHIVE_PAGE_URL,
  FOLDER_NOTE,
  FOLDER_NOTE_URL,
  type ArchiveMode,
  type ArchiveRequest,
  FIRST_LOOK_AFTER_MS,
  IMPORT_WINDOW_MS,
  LOOK_EVERY_MS,
  STOP_LOOKING_AFTER_MS,
  archiveDownloadPath,
  archiveOverdue,
  expectsArchive,
  nextArchiveLook,
} from '../src/shared/x-archive';
import { ACCOUNT, page } from './support/engine';

// The engine's sleeps run on a Web Worker in the dashboard; here they return at once.
vi.mock('../src/engine/timers', async (importOriginal) => ({
  ...(await importOriginal<typeof Timers>()),
  sleep: async () => {},
}));

const NOW = Date.UTC(2026, 10, 9, 12);

/**
 * An archive run over a fake job context. `states` is what X's archive page shows at each read, in turn (the last
 * one repeats); `press` answers each press. `path` is where the worker window is when the run starts.
 */
function archiveRun(
  states: ArchiveState[],
  {
    mode = 'get',
    press = (): ArchivePressResult => ({ outcome: 'done', state: 'preparing', message: '' }),
    path = '/home',
  }: { mode?: ArchiveMode; press?: () => ArchivePressResult; path?: string } = {},
) {
  const reads = [...states];
  const commands: ActorCommand[] = [];
  const logs: string[] = [];
  const ctx = {
    job: {
      id: 'a',
      accountId: ACCOUNT,
      archive: mode,
      phase: '',
      stats: { matched: 0, done: 0, skipped: 0, failed: 0, scanned: 0 },
    } as Partial<Job> as Job,
    handle: 'me',
    notes: [] as string[],
    checkpoint: vi.fn(),
    status: vi.fn(),
    setPhase: vi.fn(async (phase: string) => {
      ctx.job.phase = phase;
    }),
    save: vi.fn(async () => {}),
    log: vi.fn(async (_level: string, _action: string, message: string) => {
      logs.push(message);
    }),
    openPage: vi.fn(async () => page({ path: '/settings/download_your_data' })),
    verifyPage: vi.fn(async () => {}),
    xTab: {
      ping: vi.fn(async () => page({ path })),
      send: vi.fn(async (command: ActorCommand) => {
        commands.push(command);
        if (command.cmd === 'archiveState') return reads.length > 1 ? reads.shift() : reads[0];
        if (command.cmd === 'archivePress') return press();
        throw new Error(`unexpected ${command.cmd}`);
      }),
    },
  };
  const presses = () => commands.flatMap((c) => (c.cmd === 'archivePress' ? [c.button] : []));
  return { ctx, logs, presses, run: () => runArchive(ctx as unknown as JobContext) };
}

describe('the archive job (#186)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks X for the archive when the person asked, and remembers the request once X makes it', async () => {
    const { ctx, run, presses, logs } = archiveRun(['request', 'preparing']);
    await run();

    expect(ctx.openPage).toHaveBeenCalledWith(ARCHIVE_PAGE_URL);
    expect(ctx.verifyPage).toHaveBeenCalled();
    expect(presses()).toEqual(['request']);
    expect(ctx.job.stats.done).toBe(1);
    expect(ctx.job.phase).toBe('preparing');
    expect(await archiveRequest(ACCOUNT)).toEqual({ requestedAt: NOW, checkedAt: NOW, downloadedAt: null });
    expect(ctx.notes).toEqual([ARCHIVE_PREPARING]);
    expect(logs).toContain('Pressed “Request archive” on X’s archive page');
  });

  it('waits for the person when X asks for the password, and never presses anything then', async () => {
    const { run, presses } = archiveRun(['identity']);
    const err = await run().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NeedsYou);
    expect(err).toMatchObject({ need: 'identity', message: needMessage('identity', 'me') });
    expect(presses()).toEqual([]);
  });

  it('waits for the person when X asks for the password after Request, instead of failing', async () => {
    const { run } = archiveRun(['request'], {
      press: () => ({ outcome: 'refused', state: 'identity', message: 'X asks you to confirm it’s you first' }),
    });
    await expect(run()).rejects.toMatchObject({ need: 'identity' });
  });

  it('stays on X’s archive page after the person typed the password, so X doesn’t ask again', async () => {
    const { ctx, run } = archiveRun(['preparing'], { path: '/settings/download_your_data/' });
    await run();
    expect(ctx.openPage).not.toHaveBeenCalled();
  });

  it('keeps the first request time while X is still making the archive', async () => {
    const asked: ArchiveRequest = { requestedAt: NOW - 2 * DAY, checkedAt: NOW - 8 * HOUR, downloadedAt: null };
    await saveArchiveRequest(ACCOUNT, asked);
    const { run, presses } = archiveRun(['preparing'], { mode: 'look' });
    await run();
    expect(presses()).toEqual([]);
    expect(await archiveRequest(ACCOUNT)).toEqual({ ...asked, checkedAt: NOW });
  });

  it('presses Download once X has made the archive, and remembers it', async () => {
    await saveArchiveRequest(ACCOUNT, { requestedAt: NOW - DAY, checkedAt: NOW - HOUR, downloadedAt: null });
    const { ctx, run, presses } = archiveRun(['ready'], { mode: 'look' });
    await run();
    expect(presses()).toEqual(['download']);
    expect(await archiveRequest(ACCOUNT)).toEqual({ requestedAt: NOW - DAY, checkedAt: NOW, downloadedAt: NOW });
    expect(ctx.notes).toEqual([ARCHIVE_DOWNLOADING]);
  });

  it('counts a new archive from now once the last one was downloaded', async () => {
    await saveArchiveRequest(ACCOUNT, {
      requestedAt: NOW - 40 * DAY,
      checkedAt: NOW - 39 * DAY,
      downloadedAt: NOW - 39 * DAY,
    });
    const { run } = archiveRun(['request', 'preparing']);
    await run();
    expect(await archiveRequest(ACCOUNT)).toEqual({ requestedAt: NOW, checkedAt: NOW, downloadedAt: null });
  });

  it('never asks X for a new archive on its own look, and stops looking when X shows none (expired)', async () => {
    await saveArchiveRequest(ACCOUNT, { requestedAt: NOW - 3 * DAY, checkedAt: NOW - 7 * HOUR, downloadedAt: null });
    const { ctx, run, presses } = archiveRun(['request'], { mode: 'look' });
    await run();
    expect(presses()).toEqual([]);
    expect(await archiveRequest(ACCOUNT)).toBeNull();
    expect(ctx.notes).toEqual([ARCHIVE_NOTHING_ON_X]);
  });

  it('pauses, pressing nothing, on a page it doesn’t recognize', async () => {
    const { run, presses } = archiveRun(['unknown']);
    await expect(run()).rejects.toEqual(new Stop('paused', UNKNOWN_ARCHIVE_PAGE));
    expect(presses()).toEqual([]);
  });

  it('pauses when a press doesn’t work, and presses nothing else', async () => {
    const { run, presses, logs } = archiveRun(['request'], {
      press: () => ({ outcome: 'failed', state: 'request', message: 'X’s page didn’t show the archive being made' }),
    });
    await expect(run()).rejects.toEqual(new Stop('paused', pressFailed('request')));
    expect(presses()).toEqual(['request']);
    expect(logs.at(-1)).toBe('Did not press “Request archive”: X’s page didn’t show the archive being made');
    expect(await archiveRequest(ACCOUNT)).toBeNull();
  });

  it('presses Request at most once a run, pausing when X keeps offering a new archive', async () => {
    const { run, presses } = archiveRun(['request'], {
      press: () => ({ outcome: 'done', state: 'request', message: '' }),
    });
    await expect(run()).rejects.toEqual(new Stop('paused', UNKNOWN_ARCHIVE_PAGE));
    expect(presses()).toEqual(['request']);
  });
});

describe('when Xomoni looks again for the archive (#186)', () => {
  const asked = (over: Partial<ArchiveRequest> = {}): ArchiveRequest => ({
    requestedAt: NOW,
    checkedAt: NOW,
    downloadedAt: null,
    ...over,
  });

  it('looks a day after asking, then every six hours', () => {
    expect(nextArchiveLook(asked(), NOW)).toBe(NOW + FIRST_LOOK_AFTER_MS);
    const later = asked({ requestedAt: NOW - 2 * DAY, checkedAt: NOW - HOUR });
    expect(nextArchiveLook(later, NOW)).toBe(NOW - HOUR + LOOK_EVERY_MS);
  });

  it('doesn’t look without a request, after the download, or after two weeks', () => {
    expect(nextArchiveLook(null, NOW)).toBeNull();
    expect(nextArchiveLook(asked({ downloadedAt: NOW }), NOW)).toBeNull();
    const old = asked({ requestedAt: NOW - STOP_LOOKING_AFTER_MS - 1 });
    expect(nextArchiveLook(old, NOW)).toBeNull();
    expect(archiveOverdue(old, NOW)).toBe(true);
    expect(archiveOverdue(asked(), NOW)).toBe(false);
    expect(archiveOverdue(asked({ requestedAt: NOW - 20 * DAY, downloadedAt: NOW - 19 * DAY }), NOW)).toBe(false);
  });

  it('ignores a stored request that isn’t one', async () => {
    await db.kv.put({ key: `archiveRequest:${ACCOUNT}`, value: { nonsense: true } });
    expect(await archiveRequest(ACCOUNT)).toBeNull();
  });
});

describe('where X’s archive is saved (#196)', () => {
  const ARCHIVE = 'twitter-2026-11-15-0a1b2c3d.zip';
  const asked = (over: Partial<ArchiveRequest> = {}): ArchiveRequest => ({
    requestedAt: NOW - HOUR,
    checkedAt: NOW - HOUR,
    downloadedAt: null,
    ...over,
  });

  beforeEach(async () => {
    await db.kv.clear();
  });

  it('expects an archive while one is asked for, for 12 hours after the download, or with the folder chosen', () => {
    expect(expectsArchive([], false, NOW)).toBe(false);
    expect(expectsArchive([asked()], false, NOW)).toBe(true);
    expect(expectsArchive([asked({ downloadedAt: NOW - IMPORT_WINDOW_MS })], false, NOW)).toBe(true);
    expect(expectsArchive([asked({ downloadedAt: NOW - IMPORT_WINDOW_MS - 1 })], false, NOW)).toBe(false);
    expect(expectsArchive([], true, NOW)).toBe(true);
  });

  it('saves only a file named like X’s archive in the Xomoni folder, and only while expected', () => {
    expect(archiveDownloadPath(ARCHIVE, true)).toBe(`${ARCHIVE_FOLDER}/${ARCHIVE}`);
    expect(archiveDownloadPath(`C:\\Users\\me\\Downloads\\${ARCHIVE}`, true)).toBe(`Xomoni/${ARCHIVE}`);
    expect(archiveDownloadPath(ARCHIVE, false)).toBeNull();
    expect(archiveDownloadPath('invoice.zip', true)).toBeNull();
    expect(archiveDownloadPath(`${ARCHIVE}.crdownload`, true)).toBeNull();
  });

  it('reads what it expects from the database, for every account', async () => {
    expect(await expectingArchive(NOW)).toBe(false);
    await saveArchiveRequest('acct-2', asked());
    expect(await expectingArchive(NOW)).toBe(true);
    await saveArchiveRequest('acct-2', asked({ downloadedAt: NOW - 2 * DAY }));
    expect(await expectingArchive(NOW)).toBe(false);
    await setArchiveFolderChosen(true);
    expect(await expectingArchive(NOW)).toBe(true);
  });

  it('answers the service worker without reading the database for other downloads', async () => {
    const read = vi.spyOn(db.kv, 'where');
    expect(await archiveDownloadTarget({ filename: '/tmp/report.pdf' }, 'own', NOW)).toBeNull();
    expect(read).not.toHaveBeenCalled();
    await saveArchiveRequest('acct-2', asked());
    expect(await archiveDownloadTarget({ filename: `/tmp/${ARCHIVE}` }, 'own', NOW)).toEqual({
      filename: `Xomoni/${ARCHIVE}`,
      conflictAction: 'uniquify',
    });
    read.mockRestore();
  });

  it('places Xomoni’s own note in the folder, since Chrome forgets the name it was given', async () => {
    const note = { filename: 'download.txt', url: FOLDER_NOTE_URL, byExtensionId: 'own' };
    expect(await archiveDownloadTarget(note, 'own', NOW)).toEqual({
      filename: `Xomoni/${FOLDER_NOTE}`,
      conflictAction: 'overwrite',
    });
    // The same address from anyone else, or another file of Xomoni's, is left alone.
    expect(await archiveDownloadTarget({ ...note, byExtensionId: 'other' }, 'own', NOW)).toBeNull();
    expect(await archiveDownloadTarget({ ...note, url: 'data:text/plain,hi' }, 'own', NOW)).toBeNull();
    expect(decodeURIComponent(FOLDER_NOTE_URL)).toContain('Xomoni saves X’s archive here');
  });
});

describe('archiveJob (#186)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });

  it('keeps one archive job per account, the person’s own request winning over a look', async () => {
    const look = await archiveJob(ACCOUNT, 'look');
    expect(look).toMatchObject({ kind: 'archive', archive: 'look', title: ARCHIVE_TITLE.look, state: 'queued' });

    const get = await archiveJob(ACCOUNT, 'get');
    expect(get.id).toBe(look.id);
    expect(get).toMatchObject({ archive: 'get', title: ARCHIVE_TITLE.get });
    expect((await archiveJob(ACCOUNT, 'look')).archive).toBe('get');
    expect(await db.jobs.count()).toBe(1);

    await db.jobs.update(look.id, { finishedAt: Date.now(), state: 'completed' });
    expect((await archiveJob(ACCOUNT, 'look')).id).not.toBe(look.id);
  });
});

describe('JobContext.openPage (#186)', () => {
  /** A job context over fake ports whose worker shows `info` after loading a page. */
  function context(info = page()) {
    const navigate = vi.fn(async () => info);
    const ports = {
      xTab: { navigate, ping: vi.fn(async () => info), send: vi.fn() },
      notifier: { notify: vi.fn(), clear: vi.fn() },
      presence: { away: vi.fn(), keepDisplayOn: vi.fn() },
    } as unknown as EnginePorts;
    const job = {
      id: 'j',
      accountId: ACCOUNT,
      stats: { matched: 0, done: 0, skipped: 0, failed: 0, scanned: 0 },
    } as Job;
    const ctx = new JobContext(job, new AbortController().signal, { status: () => {}, attention: () => {} }, ports);
    ctx.settings = DEFAULT_SETTINGS;
    ctx.limiter = new Limiter(DEFAULT_SETTINGS, ACCOUNT, new AbortController().signal, () => {});
    vi.spyOn(ctx.limiter, 'before').mockResolvedValue(undefined);
    return { ctx, navigate, before: vi.mocked(ctx.limiter.before) };
  }

  it('loads the page at the reading pace, without waiting for posts', async () => {
    const { ctx, navigate, before } = context(page({ path: '/settings/download_your_data' }));
    expect(await ctx.openPage(ARCHIVE_PAGE_URL)).toMatchObject({ path: '/settings/download_your_data' });
    expect(before).toHaveBeenCalledWith('read', 'userTimeline');
    expect(navigate).toHaveBeenCalledWith(ARCHIVE_PAGE_URL, ctx.signal);
  });

  it('waits for the person when X asks for the password, and never closes X’s form', async () => {
    const { ctx } = context(page({ asksIdentity: true, obstructed: true }));
    await expect(ctx.openPage(ARCHIVE_PAGE_URL)).rejects.toMatchObject({ need: 'identity' });
    expect(ctx.xTab.send).not.toHaveBeenCalled();
  });
});
