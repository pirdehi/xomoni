// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, kvGet } from '../../src/shared/db';
import { exportData, importNotice } from '../../src/shared/move';
import { MAX_MOVE_BYTES, MOVE_PROBLEMS, checkMoveText } from '../../src/shared/move-file';
import { App } from '../../src/ui/App';
import { useToasts } from '../../src/ui/hooks';
import { MoveDataCard, MoveOffer, describeResult, exportFileName } from '../../src/ui/components/MoveData';
import { stubChrome } from '../support/chrome';
import { resetDb } from '../support/fixtures';
import { fmtDate } from '../../src/ui/format';
import { MOVER, NOW, THEN, holdRunnerLock, moverJob, moverLog, seedEverything } from '../support/move';
import { captureDownloads, fakeRunner } from '../support/shell';

/** `MOVER`'s whole database as the Xomoni being left exports it, then an empty database, as in the new Xomoni. */
async function exportedFile(edit: (text: string) => string = (t) => t) {
  await seedEverything();
  const { text } = await exportData({ app: '0.4.1', now: THEN });
  await resetDb();
  return new File([edit(text)], 'xomoni-export-2026-11-20.json', { type: 'application/json' });
}

const fileInput = () => screen.getByTestId('move-file');

/** Picks `file` in the import's file picker and waits for the confirmation. */
async function choose(file: File) {
  await userEvent.upload(fileInput(), file);
}

/** Picks `file`, then confirms it in *Import this data?*. */
async function importFile(file: File) {
  await choose(file);
  const dialog = await screen.findByRole('dialog', { name: 'Import this data?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
}

/** The result of an import of `exportedFile()`'s file, as it reads on screen. */
const IMPORTED = /^Your data is hereImported from Xomoni 0\.4\.1\. Added \d+ records and updated 0 with newer copies\./;

beforeEach(async () => {
  stubChrome();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetDb();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Move your data in Settings (#300)', () => {
  it('explains the move: export in the old Xomoni, import in the new one, the file staying on the computer', () => {
    render(<MoveDataCard />);

    expect(screen.getByRole('heading', { name: 'Move your data' })).toBeInTheDocument();
    const steps = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(steps[0]).toHaveTextContent('In the Xomoni you’re leaving, choose Export everything');
    expect(steps[1]).toHaveTextContent('In the new Xomoni, choose Import from a file');
    expect(screen.getByText(/Xomoni never sends it anywhere/)).toBeInTheDocument();
    expect(screen.getByText(/import only a file you exported yourself/)).toBeInTheDocument();
  });

  it('saves everything as one dated file with a checksum, which an import accepts', async () => {
    await seedEverything();
    const toasts = renderHook(() => useToasts());
    render(<MoveDataCard />);
    const downloads = captureDownloads();

    await userEvent.click(screen.getByRole('button', { name: 'Export everything' }));

    await waitFor(() => expect(downloads).toHaveLength(1));
    const file = downloads[0]!;
    expect(file.name).toBe(exportFileName(NOW));
    expect(file.name).toMatch(/^xomoni-export-\d{4}-\d{2}-\d{2}\.json$/);
    expect(file.type).toBe('application/json');
    const checked = await checkMoveText(await file.text(), NOW);
    expect(checked.ok && checked.summary).toMatchObject({ app: '0.3.0', accounts: [{ id: MOVER, handle: 'mover' }] });
    await waitFor(() =>
      expect(toasts.result.current.map((t) => t.text)).toContain(
        `Saved ${file.name}. It stays on your computer: Xomoni never sends it anywhere.`,
      ),
    );
  });

  it('says when damaged records had to be left out of the file', async () => {
    await seedEverything();
    await db.logs.add(moverLog({ level: 'loud' as never }));
    const toasts = renderHook(() => useToasts());
    render(<MoveDataCard />);
    captureDownloads();

    await userEvent.click(screen.getByRole('button', { name: 'Export everything' }));

    await waitFor(() =>
      expect(toasts.result.current.map((t) => t.text)).toContain('1 damaged record was left out of the file.'),
    );
  });

  it('checks the chosen file, shows what it holds, and imports it only once confirmed', async () => {
    const file = await exportedFile();
    render(<MoveDataCard />);

    await choose(file);

    const dialog = await screen.findByRole('dialog', { name: 'Import this data?' });
    // The export's day on this computer's calendar: Nov 20, 2026 in most time zones (#414).
    expect(dialog).toHaveTextContent(`From Xomoni 0.4.1, exported ${fmtDate(THEN)}`);
    expect(dialog).toHaveTextContent('its checksum matches');
    expect(within(dialog).getByRole('list', { name: 'Accounts in the file' })).toHaveTextContent(
      '@mover: 3 posts, replies and reposts · 1 likes · 3 jobs · 2 log entries',
    );
    expect(dialog).toHaveTextContent('nothing is deleted');
    expect(dialog).toHaveTextContent('nothing starts on X');
    expect(await db.items.count()).toBe(0);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Import' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Your data is here');
    expect(status).toHaveTextContent('Nothing was replaced with less or deleted, and nothing started on X.');
    expect(await db.items.count()).toBe(4);
    expect(await db.accounts.get(MOVER)).toBeDefined();
    expect((await db.logs.toArray()).some((l) => l.message.startsWith('Moved in from Xomoni 0.4.1'))).toBe(true);
  });

  it('writes nothing when the person cancels', async () => {
    const file = await exportedFile();
    render(<MoveDataCard />);
    await choose(file);

    const dialog = await screen.findByRole('dialog', { name: 'Import this data?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await db.items.count()).toBe(0);
    expect(await db.logs.count()).toBe(0);
  });

  it('refuses a file changed after it was exported, says why, and writes nothing', async () => {
    const file = await exportedFile((text) => text.replace('"post 1000000001"', '"changed"'));
    render(<MoveDataCard />);

    await choose(file);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Not imported');
    expect(alert).toHaveTextContent(MOVE_PROBLEMS.changed);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await db.items.count()).toBe(0);
  });

  it('refuses a file that isn’t Xomoni’s export', async () => {
    render(<MoveDataCard />);
    await choose(new File(['{"hello":"world"}'], 'notes.json', { type: 'application/json' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MOVE_PROBLEMS['not-xomoni']);
  });

  it('refuses a file larger than 256 MB without reading it', async () => {
    const huge = new File(['{}'], 'huge.json', { type: 'application/json' });
    Object.defineProperty(huge, 'size', { value: MAX_MOVE_BYTES + 1 });
    const text = vi.spyOn(huge, 'text');
    render(<MoveDataCard />);

    await choose(huge);

    expect(await screen.findByRole('alert')).toHaveTextContent(MOVE_PROBLEMS['too-big']);
    expect(text).not.toHaveBeenCalled();
  });

  it('waits while a job runs in this tab', async () => {
    const fake = fakeRunner({ status: 'running', jobId: 'job-1' });
    render(<MoveDataCard />);

    expect(screen.getByRole('button', { name: 'Import from a file' })).toBeDisabled();
    expect(screen.getByText('Import waits until no job runs: pause it first.')).toBeInTheDocument();
    // Export only reads, so it stays available.
    expect(screen.getByRole('button', { name: 'Export everything' })).toBeEnabled();

    act(() => fake.set({ status: 'idle', jobId: null }));
    expect(screen.getByRole('button', { name: 'Import from a file' })).toBeEnabled();
  });

  it('refuses, writing nothing, when a job runs in another tab', async () => {
    const file = await exportedFile();
    render(<MoveDataCard />);
    await choose(file);
    const dialog = await screen.findByRole('dialog', { name: 'Import this data?' });

    const runner = await holdRunnerLock();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Import' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A job is running. Pause it, then import.');
    expect(await db.items.count()).toBe(0);
    await runner.release();
  });

  it('says when everything in the file was already here', () => {
    const none = {
      accounts: 0,
      items: 0,
      jobs: 0,
      logs: 0,
      limits: 0,
      reads: 0,
      risk: 0,
      checks: 0,
      daily: 0,
      incoming: 0,
      kv: 0,
      vaultImports: 0,
      analyticsPosts: 0,
      analyticsDays: 0,
      accountEvents: 0,
      labelMonths: 0,
    };
    expect(describeResult({ added: none, updated: none })).toBe(
      'Everything in the file was already here. Nothing was replaced with less or deleted, and nothing started on X.',
    );
    expect(describeResult({ added: { ...none, items: 1 }, updated: { ...none, jobs: 2 } })).toBe(
      'Added 1 record and updated 2 with newer copies. Nothing was replaced with less or deleted, and nothing started on X.',
    );
  });
});

describe('The import’s result in Settings (#357)', () => {
  it('stays until the person dismisses it, even after leaving Settings and coming back', async () => {
    const file = await exportedFile();
    const { unmount } = render(<MoveDataCard />);
    await importFile(file);
    expect(await screen.findByRole('status')).toHaveTextContent(IMPORTED);

    // Leaving Settings and coming back: the result is still there, long after the toast has gone.
    unmount();
    render(<MoveDataCard />);
    expect(await screen.findByRole('status')).toHaveTextContent(IMPORTED);

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(await importNotice()).toBeNull();
    // Another file can still be imported.
    expect(screen.getByRole('button', { name: 'Import from a file' })).toBeEnabled();
  });

  it('gives way to the next import: a refused file shows only why', async () => {
    const file = await exportedFile();
    render(<MoveDataCard />);
    await importFile(file);
    expect(await screen.findByRole('status')).toHaveTextContent('Your data is here');

    await choose(new File(['{"hello":"world"}'], 'notes.json', { type: 'application/json' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(MOVE_PROBLEMS['not-xomoni']);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // The result is still kept: only the refusal is on screen meanwhile.
    expect(await importNotice()).not.toBeNull();
  });

  it('says so, and stays, when it can’t be dismissed', async () => {
    const file = await exportedFile();
    const toasts = renderHook(() => useToasts());
    render(<MoveDataCard />);
    await importFile(file);
    await screen.findByRole('status');
    vi.spyOn(db.kv, 'delete').mockRejectedValue(new Error('The disk is full.'));

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => expect(toasts.result.current.map((t) => t.text)).toContain('The disk is full.'));
    expect(screen.getByRole('status')).toHaveTextContent('Your data is here');
  });
});

describe('The offer on a new install (#300)', () => {
  it('asks whether the person comes from another Xomoni, and goes away for good with Not now', async () => {
    const { unmount } = render(<MoveOffer />);

    const offer = await screen.findByRole('region', { name: 'Move your data' });
    expect(within(offer).getByRole('heading', { name: 'Coming from another Xomoni?' })).toBeInTheDocument();
    expect(within(offer).getByRole('button', { name: 'Import your data' })).toBeInTheDocument();

    await userEvent.click(within(offer).getByRole('button', { name: 'Not now' }));

    await waitFor(() => expect(screen.queryByRole('region', { name: 'Move your data' })).not.toBeInTheDocument());
    expect(await kvGet('moveOffer', null)).toBe('dismissed');
    unmount();
    render(<MoveOffer />);
    // Wait for the live query to answer, then make sure it said no.
    await act(async () => {
      await kvGet('moveOffer', null);
    });
    expect(screen.queryByRole('region', { name: 'Move your data' })).not.toBeInTheDocument();
  });

  it('isn’t shown once Xomoni has done something here', async () => {
    await db.jobs.put(moverJob('job-1'));
    render(<MoveOffer />);
    await act(async () => {
      await db.jobs.count();
    });
    expect(screen.queryByRole('region', { name: 'Move your data' })).not.toBeInTheDocument();
  });

  it('imports from the offer, and its result takes the offer’s place until dismissed (#357)', async () => {
    const file = await exportedFile();
    render(<MoveOffer />);
    const offer = await screen.findByRole('region', { name: 'Move your data' });

    await userEvent.click(within(offer).getByRole('button', { name: 'Import your data' }));
    await importFile(file);

    expect(await screen.findByRole('status')).toHaveTextContent(IMPORTED);
    expect(await db.items.count()).toBe(4);
    // The import ended the offer: once the offer's live query has seen it, only its result is left, with Dismiss.
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Coming from another Xomoni?' })).not.toBeInTheDocument(),
    );
    const result = screen.getByRole('region', { name: 'Move your data' });
    expect(within(result).getByRole('status')).toHaveTextContent(IMPORTED);
    expect(within(result).queryByRole('button', { name: 'Not now' })).not.toBeInTheDocument();

    await userEvent.click(within(result).getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => expect(screen.queryByRole('region', { name: 'Move your data' })).not.toBeInTheDocument());
    expect(await importNotice()).toBeNull();
  });

  it('shows a result still waiting from an earlier import, though the offer is over', async () => {
    const file = await exportedFile();
    render(<MoveDataCard />);
    await importFile(file);
    await screen.findByRole('status');
    cleanup();

    render(<MoveOffer />);

    const result = await screen.findByRole('region', { name: 'Move your data' });
    expect(within(result).getByRole('status')).toHaveTextContent(IMPORTED);
  });
});

describe('Importing from onboarding’s offer (#357)', () => {
  it('keeps the result on Home, where the dashboard turns once the data is in, until the person dismisses it', async () => {
    const file = await exportedFile();
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeInTheDocument();
    const offer = await screen.findByRole('region', { name: 'Move your data' });

    await userEvent.click(within(offer).getByRole('button', { name: 'Import your data' }));
    await importFile(file);

    // The file's account is known now, so the dashboard turns to Home at once: the result is waiting there.
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' }, { timeout: 10_000 })).toBeInTheDocument();
    const result = await screen.findByRole('region', { name: 'Move your data' });
    expect(within(result).getByRole('status')).toHaveTextContent(IMPORTED);

    // Settings and back: it stays until the person dismisses it.
    window.location.hash = '#/settings';
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    window.location.hash = '#/overview';
    const back = await screen.findByRole('region', { name: 'Move your data' });
    expect(within(back).getByRole('status')).toHaveTextContent(IMPORTED);

    await userEvent.click(within(back).getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => expect(screen.queryByRole('region', { name: 'Move your data' })).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    expect(await importNotice()).toBeNull();
  }, 30_000);
});
