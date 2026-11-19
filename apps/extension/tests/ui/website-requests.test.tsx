// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as PlatformModule from '../../src/engine/platform';
import type { RunnerState } from '../../src/engine/runner';
import { db, recordConsent, upsertAccount } from '../../src/shared/db';
import { HOUR } from '../../src/shared/time';
import type { Job, JobState } from '../../src/shared/types';
import {
  CANCELLED_FROM_WEBSITE,
  PAUSED_FROM_WEBSITE,
  pendingAsk,
  pendingStop,
  requestResume,
  requestStop,
} from '../../src/shared/website-requests';
import { WebsiteRequests } from '../../src/ui/components/WebsiteRequests';
import { stubChrome } from '../support/chrome';
import { ME, account, resetDb } from '../support/fixtures';

/** A stand-in for the `runner` singleton, so no job runs on X; the test sets its state. */
const fake = vi.hoisted(() => {
  const IDLE: RunnerState = {
    jobId: null,
    status: 'idle',
    message: '',
    waitUntil: null,
    waitFrom: null,
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

vi.mock('../../src/engine/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof PlatformModule>()),
  runner: fake.runner,
}));

function job(state: JobState, id = 'job-1'): Job {
  return {
    id,
    accountId: ME,
    kind: 'cleanup',
    title: 'Delete posts before 2019',
    filter: null,
    options: null,
    scan: null,
    state,
    phase: '',
    stateReason: '',
    stats: { matched: 0, done: 0, skipped: 0, failed: 0, scanned: 0 },
    createdAt: 1,
    startedAt: null,
    finishedAt: null,
    updatedAt: 1,
  };
}

const dialog = () => screen.findByRole('dialog', { name: 'xomoni.com asks to resume a job' });

describe('WebsiteRequests (ADR-0027, #251)', () => {
  beforeEach(async () => {
    stubChrome();
    fake.reset();
    vi.clearAllMocks();
    await resetDb();
    await upsertAccount(account());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('a stop', () => {
    it('pauses the job this tab runs, once, and clears the request', async () => {
      fake.set({ jobId: 'job-1', status: 'running' });
      await requestStop({ jobId: 'job-1', state: 'paused', at: Date.now() });
      render(<WebsiteRequests />);
      await waitFor(() => expect(fake.runner.pause).toHaveBeenCalledWith(PAUSED_FROM_WEBSITE));
      await waitFor(async () => expect(await pendingStop()).toBeNull());
      expect(fake.runner.pause).toHaveBeenCalledTimes(1);
      expect(fake.runner.cancel).not.toHaveBeenCalled();
    });

    it('cancels with the website’s reason', async () => {
      fake.set({ jobId: 'job-1', status: 'waiting' });
      await requestStop({ jobId: 'job-1', state: 'cancelled', at: Date.now() });
      render(<WebsiteRequests />);
      await waitFor(() => expect(fake.runner.cancel).toHaveBeenCalledWith(CANCELLED_FROM_WEBSITE));
    });

    it('leaves a job another tab runs, and an old request, alone', async () => {
      fake.set({ jobId: 'job-2', status: 'running' });
      await requestStop({ jobId: 'job-1', state: 'paused', at: Date.now() });
      const { unmount } = render(<WebsiteRequests />);
      await act(() => new Promise((r) => setTimeout(r, 50)));
      expect(fake.runner.pause).not.toHaveBeenCalled();
      await expect(pendingStop()).resolves.not.toBeNull();
      unmount();

      fake.set({ jobId: 'job-1', status: 'running' });
      await requestStop({ jobId: 'job-1', state: 'paused', at: Date.now() - 2 * HOUR });
      render(<WebsiteRequests />);
      await act(() => new Promise((r) => setTimeout(r, 50)));
      expect(fake.runner.pause).not.toHaveBeenCalled();
    });
  });

  describe('a resume', () => {
    it('asks the person, and starts the job only when they choose Resume', async () => {
      await recordConsent(ME);
      await db.jobs.put(job('paused'));
      await requestResume({ jobId: 'job-1', at: Date.now() });
      render(<WebsiteRequests />);
      await dialog();
      expect(screen.getByText('Delete posts before 2019')).toBeTruthy();
      await screen.findByText('@me');
      expect(screen.getByText(/Nothing runs on X until you choose Resume here/)).toBeTruthy();
      expect(fake.runner.start).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
      await waitFor(() => expect(fake.runner.start).toHaveBeenCalledWith('job-1'));
      await waitFor(async () => expect(await pendingAsk()).toBeNull());
    });

    it('starts nothing on Not now, and forgets the ask', async () => {
      await db.jobs.put(job('paused'));
      await requestResume({ jobId: 'job-1', at: Date.now() });
      render(<WebsiteRequests />);
      await dialog();
      await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(fake.runner.start).not.toHaveBeenCalled();
      await expect(pendingAsk()).resolves.toBeNull();
    });

    it('offers no Resume while another job runs, or the risk ladder holds the account', async () => {
      await db.jobs.put(job('paused'));
      await requestResume({ jobId: 'job-1', at: Date.now() });
      fake.set({ jobId: 'job-2', status: 'running' });
      const { unmount } = render(<WebsiteRequests />);
      await dialog();
      expect(screen.getByText(/Another job is running/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
      unmount();

      fake.reset();
      await db.risk.add({ accountId: ME, kind: 'automation_flag', at: Date.now() - HOUR });
      render(<WebsiteRequests />);
      await dialog();
      await screen.findByText(/holding this account back|stopped this account’s jobs/);
      expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    });

    it('says when the job has already ended', async () => {
      await db.jobs.put(job('completed'));
      await requestResume({ jobId: 'job-1', at: Date.now() });
      render(<WebsiteRequests />);
      await dialog();
      expect(screen.getByText(/already ended/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    });
  });
});
