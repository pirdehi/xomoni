// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveReleaseNews } from '../../src/cloud/release';
import { useToasts } from '../../src/ui/hooks';
import { OneClickUpdate, UpdateRecovery, UpdatesCard, stepText } from '../../src/ui/components/OneClickUpdate';
import { UpdateNotice } from '../../src/ui/components/UpdateNotice';
import type * as OwnFolderModule from '../../src/update/own-folder';
import { kvOwnFolderStore, pickOwnFolder } from '../../src/update/own-folder';
import { problemText } from '../../src/update/problems';
import type * as UpdateModule from '../../src/update/update';
import {
  UPDATE_LOCK,
  type UpdateResult,
  type UpdateStep,
  oneClickState,
  putBackUnfinished,
  updateOutcome,
  updateTo,
} from '../../src/update/update';
import { kvJournal } from '../../src/update/write';
import { stubChrome } from '../support/chrome';
import { resetDb } from '../support/fixtures';
import { memoryFolder } from '../support/own-folder';
import { fakeRunner } from '../support/shell';

// The update's own steps are tested in tests/update*.test.ts; here they answer as each case needs.
vi.mock('../../src/update/update', async (importOriginal) => ({
  ...(await importOriginal<typeof UpdateModule>()),
  oneClickState: vi.fn(),
  updateTo: vi.fn(),
  putBackUnfinished: vi.fn(),
  updateOutcome: vi.fn(),
}));
vi.mock('../../src/update/own-folder', async (importOriginal) => ({
  ...(await importOriginal<typeof OwnFolderModule>()),
  pickOwnFolder: vi.fn(),
}));

const folder = memoryFolder('xomoni-extension');

// stubChrome's manifest says this browser runs 0.3.0.
beforeEach(async () => {
  stubChrome();
  await resetDb();
  vi.mocked(oneClickState).mockResolvedValue({ ready: true, folder: 'xomoni-extension' });
  vi.mocked(updateTo).mockResolvedValue({ ok: true, written: 6 });
  vi.mocked(updateOutcome).mockResolvedValue(null);
  vi.mocked(putBackUnfinished).mockResolvedValue('restored');
  vi.mocked(pickOwnFolder).mockResolvedValue({ folder });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the one-click update in the notice (#305)', () => {
  it('offers to set up one-click updates until Xomoni’s folder is chosen', async () => {
    vi.mocked(oneClickState).mockResolvedValueOnce({ ready: true, folder: null });
    render(<OneClickUpdate version="0.5.0" />);

    const setUp = await screen.findByRole('button', { name: 'Set up one-click updates' });
    expect(screen.getByText(/choose the folder you loaded Xomoni from/)).toBeInTheDocument();
    await userEvent.click(setUp);
    expect(pickOwnFolder).toHaveBeenCalledWith(kvOwnFolderStore, { name: undefined, version: '0.3.0' });
    // Chosen: the next look finds the folder, and the button updates.
    expect(await screen.findByRole('button', { name: 'Update now' })).toBeEnabled();
  });

  it('says why the folder chosen isn’t Xomoni’s', async () => {
    vi.mocked(oneClickState).mockResolvedValue({ ready: true, folder: null });
    vi.mocked(pickOwnFolder).mockResolvedValue({ problem: '“Downloads” isn’t Xomoni’s folder.' });
    render(<OneClickUpdate version="0.5.0" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Set up one-click updates' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('“Downloads” isn’t Xomoni’s folder.');
  });

  it('updates in one click, saying each step, and leaves the page to the reload', async () => {
    let step: (s: UpdateStep) => void = () => undefined;
    let finish: (r: UpdateResult) => void = () => undefined;
    vi.mocked(updateTo).mockImplementation((_, onStep = () => undefined) => {
      step = onStep;
      return new Promise((resolve) => (finish = resolve));
    });
    render(<OneClickUpdate version="0.5.0" />);

    const button = await screen.findByRole('button', { name: 'Update now' });
    await userEvent.click(button);
    expect(updateTo).toHaveBeenCalledWith('0.5.0', expect.any(Function));
    for (const s of ['download', 'verify', 'write', 'reload'] as const) {
      act(() => step(s));
      expect(await screen.findByText(stepText(s, '0.5.0'))).toBeInTheDocument();
      expect(button).toBeDisabled();
    }
    await act(async () => finish({ ok: true, written: 6 }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // Chrome is reloading Xomoni: no second update.
    expect(button).toBeDisabled();
    expect(updateTo).toHaveBeenCalledTimes(1);
  });

  it('can’t start a second update while Chrome’s prompts are open', async () => {
    let finish: (r: UpdateResult) => void = () => undefined;
    vi.mocked(updateTo).mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    render(<OneClickUpdate version="0.5.0" />);
    const button = await screen.findByRole('button', { name: 'Update now' });
    await userEvent.click(button);
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(updateTo).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: false, problem: 'download-denied' }));
    expect(button).toBeEnabled();
  });

  it.each([
    'bad-signature',
    'unsigned',
    'download-failed',
    'busy',
    'write-failed',
    'new-identity',
    'new-permissions',
    'old-browser',
    'unfinished',
    'needs-click',
  ] as const)('says why it stopped (%s), with nothing changed', async (problem) => {
    vi.mocked(updateTo).mockResolvedValue({ ok: false, problem });
    render(<OneClickUpdate version="0.5.0" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Update now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(problemText(problem, '0.5.0', '0.3.0'));
    // The button is back, to try again.
    expect(screen.getByRole('button', { name: 'Update now' })).toBeEnabled();
  });

  it('offers to choose the folder again when it isn’t Xomoni’s any more', async () => {
    vi.mocked(updateTo).mockResolvedValue({ ok: false, problem: 'wrong-folder' });
    render(<OneClickUpdate version="0.5.0" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Update now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('doesn’t hold Xomoni 0.3.0 any more');
    await userEvent.click(screen.getByRole('button', { name: 'Choose Xomoni’s folder again' }));
    expect(pickOwnFolder).toHaveBeenCalled();
  });

  it('says so when the update fails unexpectedly', async () => {
    vi.mocked(updateTo).mockRejectedValue(new Error('IndexedDB is gone'));
    render(<OneClickUpdate version="0.5.0" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Update now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t update: IndexedDB is gone.');
  });

  it('waits while a job runs in this tab', async () => {
    const fake = fakeRunner({ status: 'running', jobId: 'job-1' });
    render(<OneClickUpdate version="0.5.0" />);
    expect(await screen.findByRole('button', { name: 'Update now' })).toBeDisabled();
    expect(screen.getByText('Xomoni updates only while no job runs.')).toBeInTheDocument();
    act(() => fake.set({ status: 'idle', jobId: null }));
    expect(screen.getByRole('button', { name: 'Update now' })).toBeEnabled();
  });

  it('shows nothing for a store install, and one line where it can’t check a release', async () => {
    vi.mocked(oneClickState).mockResolvedValue({ ready: false, why: 'not-zip' });
    const { container } = render(<OneClickUpdate version="0.5.0" />);
    await waitFor(() => expect(oneClickState).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    cleanup();

    for (const why of ['no-key', 'unsupported'] as const) {
      vi.mocked(oneClickState).mockResolvedValue({ ready: false, why });
      render(<OneClickUpdate version="0.5.0" />);
      expect(await screen.findByText(problemText(why, '0.5.0', '0.3.0'))).toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      cleanup();
    }
  });

  it('sits in the notice that a newer version is out, beside the manual download', async () => {
    await saveReleaseNews({ latest: '0.5.0', security: false });
    render(<UpdateNotice />);
    expect(await screen.findByText('Xomoni 0.5.0 is out')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Update now' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Download 0\.5\.0/ })).toBeInTheDocument();
  });
});

describe('Settings › Updates (#305)', () => {
  it('names the folder chosen, and forgets it', async () => {
    const set = vi.spyOn(kvOwnFolderStore, 'set').mockResolvedValue();
    render(<UpdatesCard />);
    expect(screen.getByText('This browser runs Xomoni 0.3.0.')).toBeInTheDocument();
    expect(await screen.findByText(/Xomoni’s folder: “xomoni-extension”/)).toBeInTheDocument();
    vi.mocked(oneClickState).mockResolvedValue({ ready: true, folder: null });
    await userEvent.click(screen.getByRole('button', { name: 'Forget the folder' }));
    expect(set).toHaveBeenCalledWith(null);
    expect(await screen.findByRole('button', { name: 'Choose Xomoni’s folder' })).toBeInTheDocument();
    expect(screen.queryByText(/Xomoni’s folder: “/)).not.toBeInTheDocument();
  });

  it('chooses the folder, and says why one isn’t Xomoni’s', async () => {
    vi.mocked(oneClickState).mockResolvedValue({ ready: true, folder: null });
    vi.mocked(pickOwnFolder).mockResolvedValueOnce({ problem: '“old” holds Xomoni 0.2.0, but this one is 0.3.0.' });
    render(<UpdatesCard />);
    await userEvent.click(await screen.findByRole('button', { name: 'Choose Xomoni’s folder' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('“old” holds Xomoni 0.2.0');

    const toasts = renderHook(() => useToasts());
    await userEvent.click(screen.getByRole('button', { name: 'Choose Xomoni’s folder' }));
    await waitFor(() =>
      expect(toasts.result.current).toContainEqual(
        expect.objectContaining({ text: 'Xomoni will update itself in “xomoni-extension”.', tone: 'good' }),
      ),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says a store install updates by itself, and why one-click can’t work here', async () => {
    vi.mocked(oneClickState).mockResolvedValue({ ready: false, why: 'not-zip' });
    render(<UpdatesCard />);
    expect(await screen.findByText('This Xomoni came from a store, which updates it by itself.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says one-click updates can’t work when the browser can’t be asked', async () => {
    vi.mocked(oneClickState).mockRejectedValue(new Error('no'));
    render(<UpdatesCard />);
    expect(await screen.findByText(/can’t check the signature of a release/)).toBeInTheDocument();
  });
});

describe('after an update (#305)', () => {
  it('says once that the new version runs', async () => {
    vi.mocked(updateOutcome).mockResolvedValue({ took: true, version: '0.5.0' });
    const toasts = renderHook(() => useToasts());
    render(<UpdateRecovery />);
    await waitFor(() =>
      expect(toasts.result.current).toContainEqual(
        expect.objectContaining({ text: 'Xomoni updated to 0.5.0. Your data is all here.', tone: 'good' }),
      ),
    );
  });

  it('says when Chrome still runs the old version, and where to choose the folder', async () => {
    vi.mocked(updateOutcome).mockResolvedValue({ took: false, version: '0.5.0', running: '0.4.0' });
    const toasts = renderHook(() => useToasts());
    render(<UpdateRecovery />);
    await waitFor(() =>
      expect(toasts.result.current).toContainEqual(
        expect.objectContaining({
          text: 'Xomoni 0.5.0 was written, but Chrome still runs 0.4.0: it loads Xomoni from another folder. Choose that folder in Settings › Updates.',
          tone: 'critical',
        }),
      ),
    );
  });

  it('offers to put back the old version when an update didn’t finish', async () => {
    await kvJournal.set({ from: '0.4.0', to: '0.5.0', at: 1, backups: [] });
    render(<UpdateRecovery />);
    expect(await screen.findByText('The update to Xomoni 0.5.0 didn’t finish')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Put back 0.4.0' }));
    expect(putBackUnfinished).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    ['failed', 'Some files couldn’t be put back.'],
    ['busy', 'A job is running.'],
    ['no-folder', 'Xomoni’s folder was forgotten.'],
    ['needs-click', 'Press Put back 0.4.0 again.'],
    ['folder-denied', 'Chrome didn’t let Xomoni change its folder'],
  ] as const)('says why it couldn’t put it back (%s)', async (result, words) => {
    vi.mocked(putBackUnfinished).mockResolvedValue(result);
    await kvJournal.set({ from: '0.4.0', to: '0.5.0', at: 1, backups: [] });
    render(<UpdateRecovery />);
    await userEvent.click(await screen.findByRole('button', { name: 'Put back 0.4.0' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(words);
  });

  it('shows nothing while an update writes, in this tab or another: its journal is no sign of trouble', async () => {
    await kvJournal.set({ from: '0.4.0', to: '0.5.0', at: 1, backups: [] });
    let finish: () => void = () => undefined;
    const writing = navigator.locks.request(UPDATE_LOCK, () => new Promise<void>((resolve) => (finish = resolve)));
    const { container } = render(<UpdateRecovery />);
    await waitFor(() => expect(updateOutcome).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(container).toBeEmptyDOMElement();

    // The update stopped with its journal kept: now it is one cut short.
    finish();
    await writing;
    expect(await screen.findByText('The update to Xomoni 0.5.0 didn’t finish')).toBeInTheDocument();
  });

  it('forgets a journal that doesn’t apply to the Xomoni running, instead of putting it back', async () => {
    const actual = await vi.importActual<typeof UpdateModule>('../../src/update/update');
    vi.mocked(putBackUnfinished).mockImplementation(actual.putBackUnfinished);
    const toasts = renderHook(() => useToasts());

    // stubChrome runs 0.3.0: an update to 0.3.0 had finished.
    await kvJournal.set({ from: '0.2.0', to: '0.3.0', at: 1, backups: [] });
    render(<UpdateRecovery />);
    await userEvent.click(await screen.findByRole('button', { name: 'Put back 0.2.0' }));
    await waitFor(() =>
      expect(toasts.result.current).toContainEqual(
        expect.objectContaining({ text: 'The update to Xomoni 0.3.0 had finished: nothing needed putting back.' }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: /Put back/ })).not.toBeInTheDocument());
    expect(await kvJournal.get()).toBeNull();
    cleanup();

    // A journal between two other versions: putting it back would mix them.
    await kvJournal.set({ from: '0.4.0', to: '0.5.0', at: 2, backups: [] });
    const later = renderHook(() => useToasts());
    render(<UpdateRecovery />);
    await userEvent.click(await screen.findByRole('button', { name: 'Put back 0.4.0' }));
    await waitFor(() =>
      expect(later.result.current).toContainEqual(
        expect.objectContaining({ text: expect.stringContaining('Xomoni didn’t put back 0.4.0'), tone: 'critical' }),
      ),
    );
    expect(await kvJournal.get()).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows nothing when there is nothing to say', async () => {
    const { container } = render(<UpdateRecovery />);
    await waitFor(() => expect(updateOutcome).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
