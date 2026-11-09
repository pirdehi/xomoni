// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveJob } from '../../src/engine/runner';
import {
  archiveImportedAt,
  archiveRequest,
  db,
  kvSet,
  markArchiveImported,
  recordConsent,
  saveArchiveRequest,
} from '../../src/shared/db';
import { DEFAULT_SETTINGS, nextActiveTime, withinActiveHours } from '../../src/shared/settings';
import { DAY, HOUR } from '../../src/shared/time';
import type { ArchiveRequest } from '../../src/shared/x-archive';
import { IMPORT_WINDOW_MS, type LookRunner, importIfDownloaded, lookIfDue } from '../../src/ui/archive-follow-up';
import { ArchiveFollowUp } from '../../src/ui/components/ArchiveFollowUp';
import type { FolderHandle, FolderStore } from '../../src/ui/downloads-folder';
import type * as Hooks from '../../src/ui/hooks';
import { accountJs, likeJs, tweetsJs } from '../support/cleanup-pages';
import { folderWith } from '../support/folder';
import { ME, account, resetDb } from '../support/fixtures';
import { zipFile } from '../support/zip';

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('../../src/ui/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof Hooks>()),
  toast: mocks.toast,
}));

/** Noon on a weekday, inside the default active hours (8:00–23:00). */
const NOON = new Date(2026, 10, 9, 12).getTime();

/** A runner stand-in: idle unless told otherwise, recording the jobs it was asked to start. */
function fakeRunner(busy = false): LookRunner & { start: ReturnType<typeof vi.fn> } {
  return { busy, start: vi.fn(() => Promise.resolve()) };
}

const asked = (over: Partial<ArchiveRequest> = {}): ArchiveRequest => ({
  requestedAt: NOON - 2 * DAY,
  checkedAt: NOON - 7 * HOUR,
  downloadedAt: null,
  ...over,
});

/** A folder store holding `folder`. */
const storeWith = (folder: FolderHandle | null): FolderStore => ({
  get: () => Promise.resolve(folder),
  set: () => Promise.resolve(),
});

/** X's archive of this account, as the ZIP lands in Downloads. */
async function archiveZip() {
  return zipFile(
    [
      { path: 'data/account.js', data: await accountJs(ME, 'me').text() },
      {
        path: 'data/tweets.js',
        data: await tweetsJs([
          { id: '1000000001', text: 'From X', createdAt: 'Mon Jan 01 12:00:00 +0000 2018' },
        ]).text(),
      },
      { path: 'data/like.js', data: await likeJs([{ tweetId: '1100000000000000001', fullText: 'Liked' }]).text() },
    ],
    'twitter-2026-11-09-abc.zip',
  );
}

describe('looking again for X’s archive (#186)', () => {
  beforeEach(async () => {
    await resetDb();
    await recordConsent(ME);
  });

  it('starts a look when one is due, remembering it first', async () => {
    await saveArchiveRequest(ME, asked());
    const runner = fakeRunner();
    const job = await lookIfDue(ME, runner, NOON);
    expect(job).toMatchObject({ kind: 'archive', archive: 'look' });
    expect(runner.start).toHaveBeenCalledWith(job!.id);
    expect((await archiveRequest(ME))?.checkedAt).toBe(NOON);
    // Remembered: a minute later nothing starts again.
    expect(await lookIfDue(ME, runner, NOON + 60_000)).toBeNull();
    expect(runner.start).toHaveBeenCalledOnce();
  });

  it('never starts while a job runs, before a look is due, or without a request', async () => {
    await saveArchiveRequest(ME, asked());
    expect(await lookIfDue(ME, fakeRunner(true), NOON)).toBeNull();
    await saveArchiveRequest(ME, asked({ requestedAt: NOON - HOUR, checkedAt: NOON - HOUR }));
    expect(await lookIfDue(ME, fakeRunner(), NOON)).toBeNull();
    await saveArchiveRequest(ME, null);
    expect(await lookIfDue(ME, fakeRunner(), NOON)).toBeNull();
    expect(await db.jobs.count()).toBe(0);
  });

  it('never starts outside the person’s active hours', async () => {
    await saveArchiveRequest(ME, asked());
    const night = new Date(2026, 10, 10, 3).getTime();
    expect(await lookIfDue(ME, fakeRunner(), night)).toBeNull();
    await kvSet('settings', { ...DEFAULT_SETTINGS, activeHours: { enabled: false, start: 8, end: 23 } });
    expect(await lookIfDue(ME, fakeRunner(), night)).not.toBeNull();
  });

  it('never asks for consent: without it, nothing starts', async () => {
    await db.consents.clear();
    await saveArchiveRequest(ME, asked());
    expect(await lookIfDue(ME, fakeRunner(), NOON)).toBeNull();
  });

  it('resumes the person’s own archive job rather than adding a look', async () => {
    await saveArchiveRequest(ME, asked());
    const own = await archiveJob(ME, 'get');
    const runner = fakeRunner();
    expect((await lookIfDue(ME, runner, NOON))?.id).toBe(own.id);
    expect(runner.start).toHaveBeenCalledWith(own.id);
  });

  it('keeps going when the runner refuses the start', async () => {
    await saveArchiveRequest(ME, asked());
    const runner = { busy: false, start: vi.fn(() => Promise.reject(new Error('Another Xomoni tab is running'))) };
    expect(await lookIfDue(ME, runner, NOON)).not.toBeNull();
  });

  it('finds the next moment inside the active hours (#186)', () => {
    const hours = { enabled: true, start: 8, end: 23 };
    const noon = new Date(2026, 10, 9, 12).getTime();
    expect(nextActiveTime(hours, noon)).toBe(noon);
    expect(nextActiveTime(hours, new Date(2026, 10, 9, 3).getTime())).toBe(new Date(2026, 10, 9, 8).getTime());
    expect(nextActiveTime(hours, new Date(2026, 10, 9, 23, 30).getTime())).toBe(new Date(2026, 10, 10, 8).getTime());
    expect(nextActiveTime({ ...hours, enabled: false }, new Date(2026, 10, 9, 3).getTime())).toBe(
      new Date(2026, 10, 9, 3).getTime(),
    );
  });

  it('knows the active hours, across midnight too', () => {
    const at = (hour: number) => new Date(2026, 10, 9, hour, 30);
    expect(withinActiveHours({ enabled: true, start: 8, end: 23 }, at(12))).toBe(true);
    expect(withinActiveHours({ enabled: true, start: 8, end: 23 }, at(23))).toBe(false);
    expect(withinActiveHours({ enabled: true, start: 22, end: 6 }, at(2))).toBe(true);
    expect(withinActiveHours({ enabled: true, start: 22, end: 6 }, at(12))).toBe(false);
    expect(withinActiveHours({ enabled: false, start: 8, end: 9 }, at(3))).toBe(true);
    expect(withinActiveHours({ enabled: true, start: 8, end: 8 }, at(3))).toBe(true);
  });
});

describe('importing the archive Xomoni downloaded (#186)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('imports the ZIP from Downloads once the job pressed Download, and only once', async () => {
    await saveArchiveRequest(ME, asked({ downloadedAt: NOON - 60_000 }));
    const folder = folderWith([await archiveZip()]);
    const found = await importIfDownloaded(account(), storeWith(folder), NOON);
    expect(found?.result).toEqual({ tweets: 1, likes: 1 });
    expect(await archiveImportedAt(ME)).not.toBeNull();
    expect(await importIfDownloaded(account(), storeWith(folder), NOON)).toBeNull();
  });

  it('does nothing before Download, long after it, or once imported', async () => {
    const folder = folderWith([await archiveZip()]);
    await saveArchiveRequest(ME, asked());
    expect(await importIfDownloaded(account(), storeWith(folder), NOON)).toBeNull();
    await saveArchiveRequest(ME, asked({ downloadedAt: NOON - IMPORT_WINDOW_MS - 1 }));
    expect(await importIfDownloaded(account(), storeWith(folder), NOON)).toBeNull();
    await saveArchiveRequest(ME, asked({ downloadedAt: Date.now() - 60_000 }));
    await markArchiveImported(ME);
    expect(await importIfDownloaded(account(), storeWith(folder), Date.now())).toBeNull();
    expect(await db.items.count()).toBe(0);
  });

  it('needs a folder the person chose, readable without asking', async () => {
    await saveArchiveRequest(ME, asked({ downloadedAt: NOON - 60_000 }));
    expect(await importIfDownloaded(account(), storeWith(null), NOON)).toBeNull();
    const asking = folderWith([await archiveZip()], 'prompt');
    expect(await importIfDownloaded(account(), storeWith(asking), NOON)).toBeNull();
    expect(asking.requestPermission).not.toHaveBeenCalled();
  });
});

describe('ArchiveFollowUp (#186)', () => {
  beforeEach(async () => {
    await resetDb();
    await recordConsent(ME);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('starts a due look by itself, on any page', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOON);
    await saveArchiveRequest(ME, asked());
    const run = fakeRunner();
    const { container } = render(
      <ArchiveFollowUp account={account()} libraryOpen={false} run={run} store={storeWith(null)} lookEveryMs={20} />,
    );
    expect(container).toBeEmptyDOMElement();
    await waitFor(() => expect(run.start).toHaveBeenCalledOnce());
  });

  it('imports the downloaded archive and says so, unless the Library does it itself', async () => {
    await saveArchiveRequest(ME, asked({ requestedAt: Date.now() - DAY, downloadedAt: Date.now() - 60_000 }));
    const store = storeWith(folderWith([await archiveZip()]));
    const props = { account: account(), run: fakeRunner(), store, lookEveryMs: 60_000, importEveryMs: 20 };

    const library = render(<ArchiveFollowUp {...props} libraryOpen />);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(mocks.toast).not.toHaveBeenCalled();
    library.unmount();

    render(<ArchiveFollowUp {...props} libraryOpen={false} />);
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith('Imported X’s archive from Downloads: 1 posts and 1 likes', 'good'),
    );
  });

  it('says why an archive in Downloads was not imported', async () => {
    await saveArchiveRequest(ME, asked({ requestedAt: Date.now() - DAY, downloadedAt: Date.now() - 60_000 }));
    const broken = new File(['PK\u0003\u0004 not really'], 'twitter-2026-11-09-bad.zip', { lastModified: 5 });
    render(
      <ArchiveFollowUp
        account={account()}
        libraryOpen={false}
        run={fakeRunner()}
        store={storeWith(folderWith([broken]))}
        importEveryMs={20}
      />,
    );
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(expect.stringMatching(/^twitter-2026-11-09-bad\.zip: /), 'critical'),
    );
  });
});
