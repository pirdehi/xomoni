// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as RunnerModule from '../../src/engine/runner';
import type { RunnerState } from '../../src/engine/runner';
import { workerTab } from '../../src/engine/worker-tab';
import { db, recordConsent } from '../../src/shared/db';
import { estimateDuration } from '../../src/shared/filter';
import type { JobHealth } from '../../src/shared/health';
import type { RiskEventKind } from '../../src/shared/risk';
import { PRESETS } from '../../src/shared/settings';
import { HOUR, MINUTE } from '../../src/shared/time';
import type { CleanupFilter, CleanupOptions, Job } from '../../src/shared/types';
import { scaleRule } from '../../src/shared/x-limits';
import { JobCard } from '../../src/ui/components/JobCard';
import { fmtDuration } from '../../src/ui/format';
import { useConsentRequest, useToasts } from '../../src/ui/hooks';
import { stubChrome } from '../support/chrome';
import { ME, resetDb } from '../support/fixtures';

/**
 * A stand-in for the `runner` singleton: its state is set by the test, and start, pause and cancel are mocks,
 * so no job runs on X. The dashboard hooks (`useRunner`, `startJob`) read the same object.
 */
const fake = vi.hoisted(() => {
  const IDLE: RunnerState = {
    jobId: null,
    status: 'idle',
    message: '',
    waitUntil: null,
    need: null,
    busyElsewhere: false,
  };
  let state = IDLE;
  const listeners = new Set<() => void>();
  return {
    runner: {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      getState: () => state,
      start: vi.fn((_jobId: string) => Promise.resolve()),
      pause: vi.fn(),
      cancel: vi.fn(),
    },
    set(patch: Partial<RunnerState>) {
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    reset() {
      state = IDLE;
    },
  };
});

vi.mock('../../src/engine/runner', async (importOriginal) => ({
  ...(await importOriginal<typeof RunnerModule>()),
  runner: fake.runner,
}));

const FILTER: CleanupFilter = {
  target: 'post',
  before: Date.UTC(2018, 0, 1),
  after: null,
  keepMinLikes: null,
  keepKeywords: [],
  keepIds: [],
  skipSelfReplies: true,
};
const OPTIONS: CleanupOptions = { sweep: false, deep: true, ghostLikes: false };

function job(over: Partial<Job> = {}): Job {
  const now = Date.now();
  return {
    id: 'job-1',
    accountId: ME,
    kind: 'cleanup',
    title: 'Delete posts older than Jan 1, 2018',
    filter: FILTER,
    options: OPTIONS,
    scan: null,
    state: 'queued',
    phase: '',
    stateReason: '',
    stats: { matched: 0, done: 0, skipped: 0, failed: 0, scanned: 0 },
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    updatedAt: now,
    ...over,
  };
}

function health(over: Partial<JobHealth> = {}): JobHealth {
  return {
    at: Date.now(),
    level: 0,
    signals: {},
    checks: { applied: 0, notApplied: 0, unclear: 0, pending: 0 },
    notice: null,
    restHours: 0,
    summary: 'Healthy: no warnings from X.',
    ...over,
  };
}

/** What the app shell does with a consent request: a dialog to agree or decline. */
function ConsentProbe() {
  const request = useConsentRequest();
  if (!request) return null;
  return (
    <div role="alertdialog" aria-label="Consent">
      Consent for {request.accountId}
      <button type="button" onClick={() => request.answer(true)}>
        I agree
      </button>
      <button type="button" onClick={() => request.answer(false)}>
        Decline
      </button>
    </div>
  );
}

/** What the app shell does with toasts. */
function ToastProbe() {
  const toasts = useToasts();
  return (
    <ul aria-label="Toasts">
      {toasts.map((t) => (
        <li key={t.id}>{t.text}</li>
      ))}
    </ul>
  );
}

/** Stores the job (Cancel and Remove write to the database) and renders its card with the shell's probes. */
async function show(j: Job, compact?: boolean) {
  await db.jobs.put(j);
  return render(
    <>
      <JobCard job={j} compact={compact} />
      <ConsentProbe />
      <ToastProbe />
    </>,
  );
}

const risk = (kind: RiskEventKind, ago: number) => db.risk.add({ accountId: ME, kind, at: Date.now() - ago });
const badge = (label: string) => screen.findByText(label, { selector: 'span.rounded-full' });
const progressBar = (container: HTMLElement) => container.querySelector<HTMLElement>('.bg-accent-soft > div');

describe('JobCard', () => {
  beforeEach(async () => {
    stubChrome();
    fake.reset();
    vi.clearAllMocks();
    await resetDb();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('a job that is not running in this tab', () => {
    it('offers Start and Cancel for a queued job', async () => {
      await show(job());
      expect(await badge('Ready')).toBeInTheDocument();
      expect(screen.getByText('Delete posts older than Jan 1, 2018')).toBeInTheDocument();
      expect(screen.getByText('Created just now')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
      expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    });

    it('shows the phase a job stopped in', async () => {
      await show(job({ state: 'paused', phase: 'deep' }), true);
      expect(await screen.findByText(/· phase: deep/)).toBeInTheDocument();
    });

    it('offers Resume for a paused job and shows why it paused', async () => {
      await show(job({ state: 'paused', stateReason: 'Paused by you.' }));
      expect(await badge('Paused')).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: 'Resume' })).toBeEnabled();
      expect(screen.getByText('Paused by you.')).not.toHaveClass('text-critical');
    });

    it.each(['blocked', 'failed'] as const)(
      'shows the reason of a %s job as critical and offers Resume',
      async (state) => {
        await show(job({ state, stateReason: 'X refused the action.' }));
        expect(await badge(state === 'blocked' ? 'Stopped for safety' : 'Failed')).toBeInTheDocument();
        expect(screen.getByText('X refused the action.')).toHaveClass('text-critical');
        expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument();
      },
    );

    it('reads "Needs you" for a job waiting for the person, with nothing to start or cancel here', async () => {
      await show(job({ state: 'waiting', stateReason: 'X asks you to confirm it’s you.' }));
      expect(await badge('Needs you')).toBeInTheDocument();
      expect(screen.getByText('X asks you to confirm it’s you.')).toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('offers no control for a job another dashboard tab is running', async () => {
      await show(job({ state: 'running' }));
      expect(await badge('Running')).toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('cancels a job that is not running', async () => {
      await show(job({ state: 'paused' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
      await waitFor(async () => expect((await db.jobs.get('job-1'))?.state).toBe('cancelled'));
      expect((await db.jobs.get('job-1'))?.finishedAt).toEqual(expect.any(Number));
      expect(fake.runner.cancel).not.toHaveBeenCalled();
    });

    it('removes a finished job from the list, without Start or Cancel', async () => {
      await show(job({ state: 'completed', stats: { matched: 3, done: 3, skipped: 0, failed: 0, scanned: 9 } }));
      expect(await badge('Completed')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Start|Resume|Cancel/ })).not.toBeInTheDocument();

      const remove = screen.getByRole('button', { name: 'Remove' });
      expect(remove).toHaveAttribute('title', 'Remove from the list (the activity log is kept)');
      await userEvent.click(remove);
      await waitFor(async () => expect(await db.jobs.get('job-1')).toBeUndefined());
    });

    it('offers Remove for a cancelled job', async () => {
      await show(job({ state: 'cancelled', stateReason: 'Cancelled by you.' }));
      expect(await badge('Cancelled')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    });

    it('does not report a finished job with a note as all clear', async () => {
      await show(job({ state: 'completed', stateReason: '4 posts could not be seen on X.' }));
      expect(await badge('Finished with a warning')).toBeInTheDocument();
      expect(screen.queryByText('Completed')).not.toBeInTheDocument();
      expect(screen.getByText('4 posts could not be seen on X.')).toBeInTheDocument();
    });
  });

  describe('progress', () => {
    it('shows removed, skipped and remaining counts, the bar and the time left at the current pace', async () => {
      const { container } = await show(
        job({ state: 'paused', stats: { matched: 10, done: 4, skipped: 1, failed: 0, scanned: 0 } }),
      );
      // A new account is on day one of the warm-up: a quarter of the one-fifth caps.
      const eta = estimateDuration(5, scaleRule(PRESETS.careful.delete, 0.25));
      expect(await screen.findByText(`≈ ${fmtDuration(eta)} at the current pace`)).toBeInTheDocument();
      expect(screen.getByText('removed')).toHaveTextContent('4 removed');
      expect(screen.getByText('1 skipped')).toBeInTheDocument();
      expect(screen.getByText('5 remaining')).toBeInTheDocument();
      expect(screen.queryByText(/failed/)).not.toBeInTheDocument();
      expect(progressBar(container)).toHaveStyle({ width: '50%' });
    });

    it('estimates likes with the ghost-like pacing when that option is on', async () => {
      await show(
        job({
          filter: { ...FILTER, target: 'like' },
          options: { ...OPTIONS, ghostLikes: true },
          stats: { matched: 40, done: 0, skipped: 0, failed: 0, scanned: 0 },
        }),
      );
      const eta = estimateDuration(40, scaleRule(PRESETS.careful.relike, 0.25));
      expect(await screen.findByText(`≈ ${fmtDuration(eta)} at the current pace`)).toBeInTheDocument();
    });

    it('shows failures and never fills the bar past 100%', async () => {
      const { container } = await show(
        job({ state: 'paused', stats: { matched: 5, done: 4, skipped: 1, failed: 2, scanned: 0 } }),
      );
      expect(await screen.findByText('2 failed')).toHaveClass('text-critical');
      expect(screen.getByText('0 remaining')).toBeInTheDocument();
      expect(screen.queryByText(/at the current pace/)).not.toBeInTheDocument();
      expect(progressBar(container)).toHaveStyle({ width: '100%' });
    });

    it('leaves the bar empty and gives no estimate before anything matched', async () => {
      const { container } = await show(job());
      expect(await screen.findByText('0 remaining')).toBeInTheDocument();
      expect(screen.queryByText(/at the current pace/)).not.toBeInTheDocument();
      expect(progressBar(container)).toHaveStyle({ width: '0%' });
    });

    it('gives no estimate for a finished job', async () => {
      await show(job({ state: 'cancelled', stats: { matched: 10, done: 2, skipped: 0, failed: 0, scanned: 0 } }));
      expect(await screen.findByText('8 remaining')).toBeInTheDocument();
      // Settings and pace load asynchronously; an estimate would have appeared by the time Remove is shown.
      await screen.findByRole('button', { name: 'Remove' });
      await act(async () => {
        await db.kv.toArray();
      });
      expect(screen.queryByText(/at the current pace/)).not.toBeInTheDocument();
    });

    it('shows how many posts a scan looked at, without a progress bar', async () => {
      const { container } = await show(
        job({
          kind: 'scan',
          title: 'Scan: replies',
          filter: null,
          options: null,
          scan: 'replies',
          stats: { matched: 0, done: 0, skipped: 0, failed: 0, scanned: 1234 },
        }),
      );
      expect(await screen.findByText('posts looked at')).toHaveTextContent('1,234 posts looked at');
      expect(screen.queryByText(/removed/)).not.toBeInTheDocument();
      expect(progressBar(container)).toBeNull();
    });
  });

  describe('starting', () => {
    it('starts a queued job once consent was given for the account', async () => {
      await recordConsent(ME);
      await show(job());
      await userEvent.click(await screen.findByRole('button', { name: 'Start' }));
      await waitFor(() => expect(fake.runner.start).toHaveBeenCalledWith('job-1'));
      expect(screen.queryByRole('alertdialog', { name: 'Consent' })).not.toBeInTheDocument();
    });

    it('resumes a paused job', async () => {
      await recordConsent(ME);
      await show(job({ state: 'paused' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Resume' }));
      await waitFor(() => expect(fake.runner.start).toHaveBeenCalledWith('job-1'));
    });

    it('asks for consent before the account’s first job, and starts nothing when declined', async () => {
      await show(job());
      await userEvent.click(await screen.findByRole('button', { name: 'Start' }));
      const consent = await screen.findByRole('alertdialog', { name: 'Consent' });
      expect(consent).toHaveTextContent(`Consent for ${ME}`);
      expect(fake.runner.start).not.toHaveBeenCalled();

      await userEvent.click(within(consent).getByRole('button', { name: 'Decline' }));
      expect(screen.queryByRole('alertdialog', { name: 'Consent' })).not.toBeInTheDocument();
      expect(fake.runner.start).not.toHaveBeenCalled();
    });

    it('starts the job once the person agrees', async () => {
      await show(job());
      await userEvent.click(await screen.findByRole('button', { name: 'Start' }));
      const consent = await screen.findByRole('alertdialog', { name: 'Consent' });
      await userEvent.click(within(consent).getByRole('button', { name: 'I agree' }));
      await waitFor(() => expect(fake.runner.start).toHaveBeenCalledWith('job-1'));
    });

    it('shows why a start failed', async () => {
      await recordConsent(ME);
      fake.runner.start.mockRejectedValueOnce(new Error('Another Xomoni tab is already running a job.'));
      await show(job());
      await userEvent.click(await screen.findByRole('button', { name: 'Start' }));
      const toasts = screen.getByRole('list', { name: 'Toasts' });
      expect(await within(toasts).findByText('Another Xomoni tab is already running a job.')).toBeInTheDocument();
    });

    it('cannot start while this tab runs another job', async () => {
      fake.set({ jobId: 'job-2', status: 'running', message: 'Deleting…' });
      await show(job());
      expect(await badge('Ready')).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: 'Start' })).toBeDisabled();
      // The other job's status is not shown on this card.
      expect(screen.queryByText('Deleting…')).not.toBeInTheDocument();
    });
  });

  describe('while running in this tab', () => {
    it('shows the live status and pauses or cancels through the runner', async () => {
      fake.set({ jobId: 'job-1', status: 'running', message: 'Deleting post 3 of 10…' });
      await show(job({ state: 'running', stateReason: 'old reason', health: health() }));

      expect(await badge('Running')).toBeInTheDocument();
      expect(screen.getByText('Deleting post 3 of 10…')).toBeInTheDocument();
      expect(screen.queryByText('old reason')).not.toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Start|Resume|Remove/ })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
      expect(fake.runner.pause).toHaveBeenCalledOnce();
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(fake.runner.cancel).toHaveBeenCalledOnce();
      expect((await db.jobs.get('job-1'))?.state).toBe('running');
    });

    it('follows the runner’s state as it changes', async () => {
      await show(job({ state: 'paused' }));
      expect(await badge('Paused')).toBeInTheDocument();
      act(() => {
        fake.set({ jobId: 'job-1', status: 'running', message: 'Starting…' });
      });
      expect(await badge('Running')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    });

    it('counts down a wait', async () => {
      fake.set({ jobId: 'job-1', status: 'waiting', message: 'Pacing', waitUntil: Date.now() + 5 * MINUTE });
      await show(job({ state: 'running' }));
      expect(await badge('Waiting')).toBeInTheDocument();
      expect(screen.getByText('Pacing')).toBeInTheDocument();
      expect(screen.getByText(/^(5m 0s|4m 59s)$/)).toBeInTheDocument();
    });

    it('disables Pause and Cancel while stopping', async () => {
      fake.set({ jobId: 'job-1', status: 'stopping', message: 'Finishing the current step…' });
      await show(job({ state: 'running' }));
      expect(await badge('Stopping')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    });

    it('reads "Needs you" when X needs the person, with a way to the X window', async () => {
      const focus = vi.spyOn(workerTab, 'focus').mockResolvedValue(undefined);
      fake.set({ jobId: 'job-1', status: 'attention', message: 'X asks you to log in again.', need: 'login' });
      await show(job({ state: 'running' }));

      expect(await badge('Needs you')).toBeInTheDocument();
      expect(screen.getByText('X asks you to log in again.')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Open X window' }));
      expect(focus).toHaveBeenCalledOnce();
    });

    it('shows no status line without a message', async () => {
      fake.set({ jobId: 'job-1', status: 'running', message: '' });
      await show(job({ state: 'running' }));
      expect(await badge('Running')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Open X window' })).not.toBeInTheDocument();
    });
  });

  describe('when the risk ladder holds the account back', () => {
    it('waits out a resume lock and asks for a typed RESUME to go ahead anyway', async () => {
      await recordConsent(ME);
      await risk('automation_flag', HOUR);
      await show(job({ state: 'blocked' }));

      const waiting = await screen.findByRole('button', { name: /^Resume in (5h 0m|4h 59m)$/ });
      expect(waiting).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Resume anyway…' }));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByRole('heading', { name: 'Risk level 2: Retreat' })).toBeInTheDocument();
      expect(dialog).toHaveTextContent('Why Xomoni is holding back: X flagged the activity as automated (226).');
      expect(dialog).toHaveTextContent('X is likely watching this account more closely right now.');
      expect(dialog).toHaveTextContent('a quarter of its usual share for the next 48 hours');

      const confirm = within(dialog).getByRole('button', { name: 'Resume anyway' });
      const input = within(dialog).getByRole('textbox', { name: /Type RESUME/ });
      expect(confirm).toBeDisabled();
      await userEvent.type(input, 'resume');
      expect(confirm).toBeDisabled();
      await userEvent.clear(input);
      await userEvent.type(input, ' RESUME ');
      expect(confirm).toBeEnabled();

      await userEvent.click(confirm);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await waitFor(() => expect(fake.runner.start).toHaveBeenCalledWith('job-1'));
      const events = await db.risk.toArray();
      expect(events.map((e) => e.kind)).toEqual(['automation_flag', 'override']);
    });

    // The ladder is re-evaluated at the current time when events change, so the override shows at once.
    it('lifts the hold on the card as soon as the person resumes anyway', async () => {
      await recordConsent(ME);
      await risk('automation_flag', HOUR);
      await show(job({ state: 'blocked' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Resume anyway…' }));
      const dialog = screen.getByRole('dialog');
      await userEvent.type(within(dialog).getByRole('textbox', { name: /Type RESUME/ }), 'RESUME');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Resume anyway' }));
      await waitFor(async () => expect(await db.risk.count()).toBe(2));

      expect(await screen.findByRole('button', { name: 'Resume' })).toBeEnabled();
    });

    it('keeps waiting when the person backs out', async () => {
      await risk('automation_flag', HOUR);
      await show(job({ state: 'paused' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Resume anyway…' }));
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep waiting' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(fake.runner.start).not.toHaveBeenCalled();
      expect((await db.risk.toArray()).map((e) => e.kind)).toEqual(['automation_flag']);
    });

    it('asks for RESUME again every time the dialog opens', async () => {
      await risk('automation_flag', HOUR);
      await show(job({ state: 'paused' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Resume anyway…' }));
      await userEvent.type(within(screen.getByRole('dialog')).getByRole('textbox', { name: /Type RESUME/ }), 'RESUME');
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep waiting' }));

      await userEvent.click(screen.getByRole('button', { name: 'Resume anyway…' }));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByRole('textbox', { name: /Type RESUME/ })).toHaveValue('');
      expect(within(dialog).getByRole('button', { name: 'Resume anyway' })).toBeDisabled();
    });

    it('closes the dialog with Escape', async () => {
      await risk('automation_flag', HOUR);
      await show(job({ state: 'paused' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Resume anyway…' }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('stops for safety after a full stop and warns of a suspension', async () => {
      await risk('suspended', HOUR);
      await show(job({ state: 'blocked' }));

      expect(await screen.findByRole('button', { name: 'Stopped for safety' })).toBeDisabled();
      await userEvent.click(screen.getByRole('button', { name: 'Resume anyway…' }));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByRole('heading', { name: 'Risk level 4: Full stop' })).toBeInTheDocument();
      expect(dialog).toHaveTextContent('This is a full stop.');
      expect(dialog).toHaveTextContent('continuing now risks a suspension');
    });

    it('offers a plain Resume once the lock has ended', async () => {
      await risk('automation_flag', 7 * HOUR);
      await show(job({ state: 'paused' }));
      expect(await screen.findByRole('button', { name: 'Resume' })).toBeEnabled();
      expect(screen.queryByRole('button', { name: 'Resume anyway…' })).not.toBeInTheDocument();
    });

    it('does not hold a job that cannot be resumed anyway', async () => {
      await risk('suspended', HOUR);
      await show(job({ state: 'completed' }));
      expect(await screen.findByRole('button', { name: 'Remove' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Stopped for safety|Resume/ })).not.toBeInTheDocument();
    });
  });

  describe('account health report', () => {
    it('is quiet when the account is healthy', async () => {
      await show(job({ state: 'completed', health: health() }));
      const note = await screen.findByRole('status');
      expect(note).toHaveTextContent('Account health: Healthy: no warnings from X.');
      expect(note).toHaveClass('border-line');
    });

    it('warns about signals from X', async () => {
      await show(
        job({
          state: 'completed',
          health: health({ level: 1, signals: { rate_limited: 1 }, summary: 'During this run X sent one rate limit.' }),
        }),
      );
      const note = await screen.findByRole('status');
      expect(note).toHaveTextContent('During this run X sent one rate limit.');
      expect(note).toHaveClass('border-warn/40');
    });

    it('marks signals at level 0 as a warning, not healthy', async () => {
      await show(job({ state: 'paused', health: health({ signals: { rate_limited: 1 } }) }));
      expect(await screen.findByRole('status')).toHaveClass('border-warn/40');
    });

    it.each([
      ['a high risk level', health({ level: 3, summary: 'Risk level 3 (Defensive).' })],
      ['a notice from X', health({ notice: 'Your account is temporarily limited.', summary: 'X showed a notice.' })],
    ])('is serious for %s', async (_, report) => {
      await show(job({ state: 'blocked', health: report }));
      expect(await screen.findByRole('status')).toHaveClass('border-critical/40');
    });
  });
});
