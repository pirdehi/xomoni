// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type RunnerState, archiveJob } from '../../src/engine/runner';
import { db, markArchiveImported, saveArchiveRequest } from '../../src/shared/db';
import { DAY, HOUR } from '../../src/shared/time';
import type { Job } from '../../src/shared/types';
import type { ArchiveRequest } from '../../src/shared/x-archive';
import { ARCHIVE_STEPS, XArchiveCard, archiveLine, archiveProgress } from '../../src/ui/components/XArchiveCard';
import { FOLDER_NOT_CHOSEN, type FolderHandle, type FolderStore, wrongFolder } from '../../src/ui/downloads-folder';
import type * as Hooks from '../../src/ui/hooks';
import type { ArchiveStatus } from '../../src/ui/queries';
import { folderWith } from '../support/folder';
import { ME, account, resetDb } from '../support/fixtures';

const mocks = vi.hoisted(() => {
  const run: { current: Pick<RunnerState, 'jobId' | 'status' | 'need' | 'message'> } = {
    current: { jobId: null, status: 'idle', need: null, message: '' },
  };
  return {
    run,
    consent: vi.fn((_accountId: string) => Promise.resolve(true)),
    startJob: vi.fn((_jobId: string) => Promise.resolve()),
    toast: vi.fn(),
    focus: vi.fn(() => Promise.resolve()),
  };
});

vi.mock('../../src/ui/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof Hooks>()),
  ensureConsent: mocks.consent,
  startJob: mocks.startJob,
  toast: mocks.toast,
  useRunner: (): RunnerState => ({ waitUntil: null, waitFrom: null, busyElsewhere: false, ...mocks.run.current }),
}));
vi.mock('../../src/engine/worker-tab', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  workerTab: { focus: mocks.focus },
}));

const NOW = Date.now();
const asked = (over: Partial<ArchiveRequest> = {}): ArchiveRequest => ({
  requestedAt: NOW - 2 * HOUR,
  checkedAt: NOW - 2 * HOUR,
  downloadedAt: null,
  ...over,
});
const status = (over: Partial<ArchiveStatus> = {}): ArchiveStatus => ({
  request: null,
  imported: false,
  importedAt: null,
  openJob: null,
  ...over,
});
const idle = { jobId: null, status: 'idle', need: null, message: '' } as const;

/** Stands in for making Downloads/Xomoni with `chrome.downloads`. */
const makeFolder = vi.fn(() => Promise.resolve(true));

/** A folder store in memory, holding `folder`. */
function memoryStore(folder: FolderHandle | null = null): FolderStore & { set: ReturnType<typeof vi.fn> } {
  let current = folder;
  return {
    get: () => Promise.resolve(current),
    set: vi.fn((next: FolderHandle | null) => {
      current = next;
      return Promise.resolve();
    }),
  };
}

/** A browser with the folder picker, which answers `chosen`. */
const pickerHost = (chosen: FolderHandle | null) => ({
  showDirectoryPicker: vi.fn(() =>
    chosen ? Promise.resolve(chosen) : Promise.reject(new DOMException('closed', 'AbortError')),
  ),
});

describe('where getting X’s archive stands (#186)', () => {
  it('counts the steps done, and which one is under way', () => {
    expect(archiveProgress(status(), NOW)).toEqual({ done: 0, busy: false });
    expect(archiveProgress(status({ openJob: { id: 'j' } as Job }), NOW)).toEqual({ done: 0, busy: true });
    expect(archiveProgress(status({ request: asked() }), NOW)).toEqual({ done: 1, busy: true });
    expect(archiveProgress(status({ request: asked({ requestedAt: NOW - 15 * DAY }) }), NOW)).toEqual({
      done: 0,
      busy: false,
    });
    expect(archiveProgress(status({ request: asked({ downloadedAt: NOW - 60_000 }) }), NOW)).toEqual({
      done: 3,
      busy: true,
    });
    expect(archiveProgress(status({ request: asked({ downloadedAt: NOW - 60_000 }), importedAt: NOW }), NOW)).toEqual({
      done: 4,
      busy: false,
    });
  });

  it('says what X needs from the person while the job waits, with the way to the X window', () => {
    const openJob = { id: 'j', stateReason: '' } as Job;
    const line = archiveLine(status({ openJob }), {
      now: NOW,
      run: { jobId: 'j', status: 'attention', need: 'identity', message: 'X asks…' },
      folder: true,
      lookAt: null,
    });
    expect(line).toEqual({
      tone: 'attention',
      action: 'open-x',
      text: 'X asks you to confirm it’s you. Type your password on X’s page in the Xomoni window; Xomoni never sees it.',
    });
    const login = archiveLine(status({ openJob }), {
      now: NOW,
      run: { jobId: 'j', status: 'attention', need: 'login', message: 'Log in to X' },
      folder: true,
      lookAt: null,
    });
    expect(login).toMatchObject({ text: 'Log in to X', action: 'open-x' });
    expect(
      archiveLine(status({ openJob }), {
        now: NOW,
        run: { ...idle, jobId: 'j', status: 'running' },
        folder: true,
        lookAt: null,
      }),
    ).toEqual({ tone: 'info', text: 'Xomoni is on X’s archive page.' });
  });

  it('offers to continue a job that stopped, saying why', () => {
    const openJob = { id: 'j', stateReason: 'Paused by you.' } as Job;
    expect(archiveLine(status({ openJob }), { now: NOW, run: idle, folder: true, lookAt: null })).toEqual({
      tone: 'info',
      action: 'continue',
      text: 'Stopped: Paused by you.',
    });
  });

  it('says when Xomoni looks again, while it is open, and asks for Downloads when it can’t import', () => {
    const at = new Date(NOW);
    at.setDate(at.getDate() + 1);
    at.setHours(8, 0, 0, 0);
    const line = archiveLine(status({ request: asked() }), {
      now: NOW,
      run: idle,
      folder: false,
      lookAt: at.getTime(),
    });
    expect(line?.text).toMatch(
      /^Asked X 2h ago\. X is making it; Xomoni looks again around 08:00( tomorrow)?, while Xomoni is open, and downloads it\. Choose the Xomoni folder below so it comes in by itself\.$/,
    );
    const soon = archiveLine(status({ request: asked() }), { now: NOW, run: idle, folder: true, lookAt: NOW });
    expect(soon?.text).toBe(
      'Asked X 2h ago. X is making it; Xomoni looks again soon, while Xomoni is open, and downloads it.',
    );
  });

  it('follows the download until it is imported', () => {
    const downloaded = status({ request: asked({ downloadedAt: NOW - 5 * 60_000 }) });
    expect(archiveLine(downloaded, { now: NOW, run: idle, folder: true, lookAt: null })?.text).toBe(
      'Downloaded from X 5m ago. Xomoni imports it from Downloads › Xomoni as soon as Chrome has saved it.',
    );
    expect(archiveLine(downloaded, { now: NOW, run: idle, folder: false, lookAt: null })?.text).toBe(
      'Downloaded from X 5m ago into Downloads › Xomoni. Choose that folder below, or drop the ZIP, to import it.',
    );
    expect(
      archiveLine({ ...downloaded, importedAt: NOW }, { now: NOW, run: idle, folder: true, lookAt: null }),
    ).toBeNull();
    expect(archiveLine(status(), { now: NOW, run: idle, folder: true, lookAt: null })).toBeNull();
  });
});

describe('XArchiveCard (#186)', () => {
  beforeEach(async () => {
    await resetDb();
    mocks.run.current = idle;
    mocks.consent.mockResolvedValue(true);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the four steps before anything started', async () => {
    render(<XArchiveCard account={account()} store={memoryStore()} host={{}} />);
    const steps = await screen.findByRole('list', { name: 'Getting X’s archive' });
    expect(within(steps).getAllByRole('listitem')).toHaveLength(ARCHIVE_STEPS.length);
    expect(steps.querySelector('[aria-current="step"]')).toBeNull();
  });

  it('makes Downloads › Xomoni and asks for it in the same click, then starts the archive job, staying here', async () => {
    const xomoni = folderWith([]);
    const store = memoryStore();
    const host = pickerHost(xomoni);
    render(<XArchiveCard account={account()} store={store} host={host} makeFolder={makeFolder} />);
    expect(
      await screen.findByText(/Chrome then opens your Downloads once: open the Xomoni folder there and press Select/),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Get my archive' }));

    await waitFor(() => expect(mocks.startJob).toHaveBeenCalledOnce());
    expect(mocks.consent).toHaveBeenCalledWith(ME);
    expect(makeFolder).toHaveBeenCalledOnce();
    expect(makeFolder.mock.invocationCallOrder[0]).toBeLessThan(host.showDirectoryPicker.mock.invocationCallOrder[0]!);
    expect(host.showDirectoryPicker).toHaveBeenCalledWith({ id: 'downloads', startIn: 'downloads', mode: 'read' });
    expect(store.set).toHaveBeenCalledWith(xomoni);
    expect(mocks.toast).not.toHaveBeenCalled();
    const [job] = await db.jobs.toArray();
    expect(job).toMatchObject({ kind: 'archive', archive: 'get' });
    expect(mocks.startJob).toHaveBeenCalledWith(job!.id);
  });

  it('starts nothing, and asks for no folder, when the person doesn’t accept the risks', async () => {
    mocks.consent.mockResolvedValue(false);
    const host = pickerHost(folderWith([]));
    render(<XArchiveCard account={account()} store={memoryStore()} host={host} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Get my archive' }));
    await waitFor(() => expect(mocks.consent).toHaveBeenCalled());
    expect(host.showDirectoryPicker).not.toHaveBeenCalled();
    expect(await db.jobs.count()).toBe(0);
    expect(mocks.startJob).not.toHaveBeenCalled();
  });

  it('starts the job even when the folder picker is closed, and doesn’t ask again once a folder is chosen', async () => {
    const closed = pickerHost(null);
    const store = memoryStore();
    render(<XArchiveCard account={account()} store={store} host={closed} makeFolder={makeFolder} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Get my archive' }));
    await waitFor(() => expect(mocks.startJob).toHaveBeenCalledOnce());
    expect(store.set).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(FOLDER_NOT_CHOSEN, 'neutral');
    cleanup();
    await db.jobs.clear();

    const chosen = pickerHost(folderWith([]));
    render(
      <XArchiveCard account={account()} store={memoryStore(folderWith([]))} host={chosen} makeFolder={makeFolder} />,
    );
    await waitFor(() => expect(screen.queryByText(/Chrome then opens your Downloads/)).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Get my archive' }));
    await waitFor(() => expect(mocks.startJob).toHaveBeenCalledTimes(2));
    expect(chosen.showDirectoryPicker).not.toHaveBeenCalled();
  });

  it('refuses another folder in the same click, saying why, and still starts the job (#196)', async () => {
    const store = memoryStore();
    const host = pickerHost(folderWith([], 'granted', 'Downloads'));
    render(<XArchiveCard account={account()} store={store} host={host} makeFolder={makeFolder} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Get my archive' }));

    await waitFor(() => expect(mocks.startJob).toHaveBeenCalledOnce());
    expect(store.set).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(wrongFolder('Downloads'), 'critical');
    expect(await screen.findByRole('button', { name: 'Choose the Xomoni folder' })).toBeInTheDocument();
  });

  it('waits while another job runs, and says so', async () => {
    mocks.run.current = { jobId: 'other', status: 'running', need: null, message: '' };
    render(<XArchiveCard account={account()} store={memoryStore()} host={{}} />);
    expect(await screen.findByRole('button', { name: 'Get my archive' })).toBeDisabled();
    expect(
      screen.getByText('Another job is running; Get my archive waits until it finishes or you pause it.'),
    ).toBeInTheDocument();
  });

  it('shows X making the archive as the current step, with no button to press until a look is due', async () => {
    await saveArchiveRequest(ME, asked());
    render(<XArchiveCard account={account()} store={memoryStore(folderWith([]))} host={{}} />);
    expect(await screen.findByRole('status')).toHaveTextContent(/^Asked X 2h ago\. X is making it/);
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('X makes it');
    expect(screen.queryByRole('button', { name: 'Get my archive' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Look now' })).not.toBeInTheDocument();
  });

  it('offers a look once one is due', async () => {
    await saveArchiveRequest(ME, asked({ requestedAt: NOW - 25 * HOUR, checkedAt: NOW - 25 * HOUR }));
    const host = pickerHost(folderWith([]));
    render(<XArchiveCard account={account()} store={memoryStore()} host={host} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Look now' }));
    await waitFor(() => expect(mocks.startJob).toHaveBeenCalledOnce());
    expect((await db.jobs.toArray())[0]).toMatchObject({ kind: 'archive', archive: 'look' });
    expect(host.showDirectoryPicker).not.toHaveBeenCalled();
  });

  it('opens the way to import by hand when the download has no Downloads folder to come in from', async () => {
    await saveArchiveRequest(ME, asked({ downloadedAt: NOW - 60_000 }));
    render(<XArchiveCard account={account()} store={memoryStore()} host={pickerHost(null)} />);
    expect(await screen.findByText('Drop your X archive here (twitter-….zip)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Already have the ZIP?' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Import');
    expect(screen.queryByRole('button', { name: 'Get my archive' })).not.toBeInTheDocument();
  });

  it('folds the way to import by hand where Xomoni can watch Downloads', async () => {
    render(<XArchiveCard account={account()} store={memoryStore()} host={pickerHost(null)} />);
    const toggle = await screen.findByRole('button', { name: 'Already have the ZIP?' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Drop your X archive here (twitter-….zip)')).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Drop your X archive here (twitter-….zip)')).toBeInTheDocument();
  });

  it('brings up the X window when X asks for the password', async () => {
    const job = await archiveJob(ME, 'get');
    mocks.run.current = { jobId: job.id, status: 'attention', need: 'identity', message: '' };
    render(<XArchiveCard account={account()} store={memoryStore()} host={{}} />);
    expect(await screen.findByRole('status')).toHaveTextContent(/^X asks you to confirm it’s you\./);
    await userEvent.click(screen.getByRole('button', { name: 'Open X window' }));
    expect(mocks.focus).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Get my archive' })).not.toBeInTheDocument();
  });

  it('continues a job that stopped', async () => {
    const job = await archiveJob(ME, 'get');
    await db.jobs.update(job.id, { state: 'paused', stateReason: 'Paused by you.' });
    render(<XArchiveCard account={account()} store={memoryStore()} host={{}} />);
    expect(await screen.findByRole('status')).toHaveTextContent('Stopped: Paused by you.');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(mocks.startJob).toHaveBeenCalledWith(job.id);
  });

  it('ticks every step once the archive Xomoni downloaded is imported', async () => {
    await saveArchiveRequest(ME, asked({ downloadedAt: NOW - HOUR }));
    await markArchiveImported(ME);
    render(<XArchiveCard account={account()} store={memoryStore()} host={{}} />);
    await waitFor(() => expect(screen.getAllByLabelText('Done:')).toHaveLength(4));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText(/^Last imported /)).toBeInTheDocument();
  });
});
