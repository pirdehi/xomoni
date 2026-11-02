// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { CONSENT_VERSION } from '@xomoni/consent';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCleanupJob, runner } from '../../src/engine/runner';
import { db, hasConsent, kvGet, kvSet, recordConsent, recordRisk } from '../../src/shared/db';
import type { CleanupFilter, CleanupOptions } from '../../src/shared/types';
import {
  resumeAnyway,
  startJob,
  toast,
  useActiveAccount,
  useConsentRequest,
  usePace,
  useRisk,
  useRunner,
  useToasts,
  useWorkerStatus,
} from '../../src/ui/hooks';
import { WORKER_TAB, stubChrome } from '../support/chrome';
import { ME, account, resetDb } from '../support/fixtures';
import { fakeRunner, logEntry, openWorker, pageInfo } from '../support/shell';

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
const DAY = 86_400_000;

const newJob = (accountId = ME) => createCleanupJob(accountId, 'Delete old posts', FILTER, OPTIONS);

let chrome: ReturnType<typeof stubChrome>;

beforeEach(async () => {
  chrome = stubChrome();
  await resetDb();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useRunner', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useRunner());
    expect(result.current.status).toBe('idle');
    expect(result.current.jobId).toBeNull();
  });

  it('follows the runner as its state changes', () => {
    const fake = fakeRunner();
    const { result } = renderHook(() => useRunner());

    act(() => fake.set({ status: 'running', jobId: 'job-1', message: 'Deleting…' }));
    expect(result.current).toMatchObject({ status: 'running', jobId: 'job-1', message: 'Deleting…' });

    act(() => fake.set({ status: 'idle', jobId: null }));
    expect(result.current.status).toBe('idle');
  });
});

describe('useActiveAccount', () => {
  it('is null while no account is known', async () => {
    const { result } = renderHook(() => useActiveAccount());
    await waitFor(() => {
      expect(result.current).toBeNull();
    });
  });

  it('falls back to the most recently updated account', async () => {
    await db.accounts.bulkPut([
      account({ id: 'old', handle: 'old', updatedAt: 1_000 }),
      account({ id: 'new', handle: 'new', updatedAt: 2_000 }),
    ]);
    const { result } = renderHook(() => useActiveAccount());
    await waitFor(() => {
      expect(result.current?.id).toBe('new');
    });
  });

  it('prefers the account last seen in the worker', async () => {
    await db.accounts.bulkPut([
      account({ id: 'old', handle: 'old', updatedAt: 1_000 }),
      account({ id: 'new', handle: 'new', updatedAt: 2_000 }),
    ]);
    await kvSet('activeAccount', 'old');
    const { result } = renderHook(() => useActiveAccount());
    await waitFor(() => {
      expect(result.current?.id).toBe('old');
    });
  });

  it('ignores an active account that is no longer stored', async () => {
    await db.accounts.put(account({ id: 'kept' }));
    await kvSet('activeAccount', 'deleted');
    const { result } = renderHook(() => useActiveAccount());
    await waitFor(() => {
      expect(result.current?.id).toBe('kept');
    });
  });
});

describe('useWorkerStatus', () => {
  it('reports no worker while none is open', async () => {
    const { result } = renderHook(() => useWorkerStatus(60_000));
    await waitFor(() => {
      expect(chrome.storage.session.get).toHaveBeenCalled();
    });
    expect(result.current).toEqual({ open: false, info: null });
    expect(await db.accounts.count()).toBe(0);
  });

  it('registers the signed-in account it reports and makes it the active one', async () => {
    const info = pageInfo({ viewerId: 'acct-new', handle: 'newbie' });
    openWorker(chrome, info);
    const { result } = renderHook(() => useWorkerStatus(60_000));

    await waitFor(() => {
      expect(result.current).toEqual({ open: true, info });
    });
    await waitFor(async () => {
      expect(await kvGet('activeAccount', null)).toBe('acct-new');
    });
    expect((await db.accounts.get('acct-new'))?.handle).toBe('newbie');
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(WORKER_TAB.id, { type: 'actor', command: { cmd: 'ping' } });
  });

  it('leaves a known account as it is', async () => {
    await db.accounts.put(account({ updatedAt: 1_000 }));
    await kvSet('activeAccount', 'someone-else');
    openWorker(chrome, pageInfo({ viewerId: ME, handle: 'me' }));
    renderHook(() => useWorkerStatus(60_000));

    await waitFor(async () => {
      expect(await kvGet('activeAccount', null)).toBe(ME);
    });
    expect((await db.accounts.get(ME))?.updatedAt).toBe(1_000);
  });

  it('updates the handle when the person renamed their account, keeping the rest', async () => {
    await db.accounts.put(account({ handle: 'old-name', name: 'Me' }));
    openWorker(chrome, pageInfo({ viewerId: ME, handle: 'new-name' }));
    renderHook(() => useWorkerStatus(60_000));

    await waitFor(async () => {
      expect((await db.accounts.get(ME))?.handle).toBe('new-name');
    });
    expect((await db.accounts.get(ME))?.name).toBe('Me');
  });

  it('registers nobody while the worker is loading or signed out', async () => {
    openWorker(chrome, null);
    const { result, rerender } = renderHook(({ ms }) => useWorkerStatus(ms), { initialProps: { ms: 60_000 } });
    await waitFor(() => {
      expect(result.current).toEqual({ open: true, info: null });
    });

    const signedOut = pageInfo({ viewerId: null, handle: null, loggedIn: false });
    openWorker(chrome, signedOut);
    rerender({ ms: 60_001 });
    await waitFor(() => {
      expect(result.current).toEqual({ open: true, info: signedOut });
    });
    expect(await db.accounts.count()).toBe(0);
    expect(await kvGet('activeAccount', null)).toBeNull();
  });

  it('polls the worker again at every interval', async () => {
    const { result } = renderHook(() => useWorkerStatus(20));
    await waitFor(() => {
      expect(chrome.storage.session.get).toHaveBeenCalled();
    });

    const info = pageInfo();
    openWorker(chrome, info);
    await waitFor(() => {
      expect(result.current).toEqual({ open: true, info });
    });

    chrome.tabs.get.mockRejectedValue(new Error('No tab with id'));
    chrome.storage.session.get.mockResolvedValue({});
    await waitFor(() => {
      expect(result.current).toEqual({ open: false, info: null });
    });
  });

  it('reports the worker closed when its tab goes away during the ping', async () => {
    openWorker(chrome, pageInfo());
    const { result, rerender } = renderHook(({ ms }) => useWorkerStatus(ms), { initialProps: { ms: 60_000 } });
    await waitFor(() => {
      expect(result.current.open).toBe(true);
    });

    // The tab is still there when the poll starts and closes while the ping is on its way.
    let closed = false;
    chrome.tabs.get.mockImplementation(() =>
      closed ? Promise.reject(new Error('No tab with id')) : Promise.resolve(WORKER_TAB),
    );
    chrome.tabs.sendMessage.mockImplementation(() => {
      closed = true;
      return Promise.reject(new Error('Receiving end does not exist'));
    });
    rerender({ ms: 60_001 });

    await waitFor(() => {
      expect(result.current).toEqual({ open: false, info: null });
    });
  });

  it('keeps the last status when a poll fails for another reason', async () => {
    const info = pageInfo();
    openWorker(chrome, info);
    const { result, rerender } = renderHook(({ ms }) => useWorkerStatus(ms), { initialProps: { ms: 60_000 } });
    await waitFor(() => {
      expect(result.current).toEqual({ open: true, info });
    });

    chrome.tabs.get.mockRejectedValue(new Error('No tab with id'));
    chrome.storage.session.remove.mockRejectedValue(new Error('Storage is unavailable'));
    rerender({ ms: 60_001 });

    await waitFor(() => {
      expect(chrome.storage.session.remove).toHaveBeenCalled();
    });
    await db.kv.count();
    expect(result.current).toEqual({ open: true, info });
  });

  it('stops polling when unmounted', async () => {
    const set = vi.spyOn(globalThis, 'setInterval');
    const clear = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = renderHook(() => useWorkerStatus(1234));
    const call = set.mock.calls.findIndex(([, ms]) => ms === 1234);
    expect(call).toBeGreaterThanOrEqual(0);
    const id = set.mock.results[call]!.value as ReturnType<typeof setInterval>;

    unmount();
    expect(clear).toHaveBeenCalledWith(id);
  });
});

describe('toasts', () => {
  it('shows a message for 5 seconds', () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const { result } = renderHook(() => useToasts());

    act(() => toast('Saved'));
    expect(result.current).toContainEqual(expect.objectContaining({ text: 'Saved', tone: 'neutral' }));

    act(() => {
      vi.advanceTimersByTime(4_999);
    });
    expect(result.current.map((t) => t.text)).toContain('Saved');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.map((t) => t.text)).not.toContain('Saved');
  });

  it('keeps several messages with their tones, each on its own timer', () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const { result } = renderHook(() => useToasts());

    act(() => toast('First failed', 'critical'));
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    act(() => toast('Second worked', 'good'));
    expect(result.current).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: 'First failed', tone: 'critical' }),
        expect.objectContaining({ text: 'Second worked', tone: 'good' }),
      ]),
    );

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(result.current.map((t) => t.text)).toEqual(expect.not.arrayContaining(['First failed']));
    expect(result.current.map((t) => t.text)).toContain('Second worked');
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current.map((t) => t.text)).not.toContain('Second worked');
  });
});

describe('startJob and consent', () => {
  it('asks before an account’s first job and starts nothing when the person declines', async () => {
    const start = vi.spyOn(runner, 'start').mockResolvedValue(undefined);
    const job = await newJob();
    const { result } = renderHook(() => useConsentRequest());
    expect(result.current).toBeNull();

    const started = startJob(job.id);
    await waitFor(() => {
      expect(result.current?.accountId).toBe(ME);
    });
    act(() => result.current!.answer(false));
    await started;

    expect(start).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
    expect(await hasConsent(ME)).toBe(false);
  });

  it('starts the job once the person agreed', async () => {
    const start = vi.spyOn(runner, 'start').mockResolvedValue(undefined);
    const job = await newJob();
    const { result } = renderHook(() => useConsentRequest());

    const started = startJob(job.id);
    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });
    act(() => result.current!.answer(true));
    await started;

    expect(start).toHaveBeenCalledWith(job.id);
    expect(result.current).toBeNull();
  });

  it('starts at once when the account already consented', async () => {
    const start = vi.spyOn(runner, 'start').mockResolvedValue(undefined);
    const job = await newJob();
    await recordConsent(ME);
    const { result } = renderHook(() => useConsentRequest());

    await startJob(job.id);

    expect(start).toHaveBeenCalledWith(job.id);
    expect(result.current).toBeNull();
  });

  it('asks again when the consent was given to an older version of the text', async () => {
    const start = vi.spyOn(runner, 'start').mockResolvedValue(undefined);
    const job = await newJob();
    await db.consents.put({ accountId: ME, version: CONSENT_VERSION - 1, at: Date.now() });
    const { result } = renderHook(() => useConsentRequest());

    const started = startJob(job.id);
    await waitFor(() => {
      expect(result.current?.accountId).toBe(ME);
    });
    expect(start).not.toHaveBeenCalled();
    act(() => result.current!.answer(false));
    await started;
    expect(start).not.toHaveBeenCalled();
  });

  it('asks per account: consent for one account does not cover another', async () => {
    const start = vi.spyOn(runner, 'start').mockResolvedValue(undefined);
    await recordConsent(ME);
    const job = await newJob('other-account');
    const { result } = renderHook(() => useConsentRequest());

    const started = startJob(job.id);
    await waitFor(() => {
      expect(result.current?.accountId).toBe('other-account');
    });
    act(() => result.current!.answer(false));
    await started;
    expect(start).not.toHaveBeenCalled();
  });

  it('declines an open request when another one replaces it', async () => {
    const start = vi.spyOn(runner, 'start').mockResolvedValue(undefined);
    const first = await newJob(ME);
    const second = await newJob('other-account');
    const { result } = renderHook(() => useConsentRequest());

    const firstStarted = startJob(first.id);
    await waitFor(() => {
      expect(result.current?.accountId).toBe(ME);
    });
    const secondStarted = startJob(second.id);
    await waitFor(() => {
      expect(result.current?.accountId).toBe('other-account');
    });
    await firstStarted;
    expect(start).not.toHaveBeenCalled();

    act(() => result.current!.answer(true));
    await secondStarted;
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(second.id);
  });

  it('shows why the runner refused to start', async () => {
    vi.spyOn(runner, 'start').mockRejectedValue(new Error('A job is already running.'));
    const job = await newJob();
    await recordConsent(ME);
    const toasts = renderHook(() => useToasts());

    await startJob(job.id);

    await waitFor(() => {
      expect(toasts.result.current).toContainEqual(
        expect.objectContaining({ text: 'A job is already running.', tone: 'critical' }),
      );
    });
  });

  it('leaves a job that no longer exists to the runner, which refuses it', async () => {
    const start = vi.spyOn(runner, 'start');
    const toasts = renderHook(() => useToasts());

    await startJob('no-such-job');

    expect(start).toHaveBeenCalledWith('no-such-job');
    await waitFor(() => {
      expect(toasts.result.current).toContainEqual(
        expect.objectContaining({ text: 'Job not found.', tone: 'critical' }),
      );
    });
    expect(runner.getState().status).toBe('idle');
  });
});

describe('risk and pace', () => {
  it('assesses an account without events as normal', async () => {
    const { result } = renderHook(() => useRisk(ME));
    await waitFor(() => {
      expect(result.current).toMatchObject({ level: 0, capFactor: 1, fullStop: false });
    });
  });

  it('assesses no account as normal', async () => {
    const { result } = renderHook(() => useRisk(undefined));
    await waitFor(() => {
      expect(result.current?.level).toBe(0);
    });
  });

  it('assesses the events already stored', async () => {
    await db.risk.add({ accountId: ME, kind: 'automation_flag', at: Date.now() - 60_000 });
    const { result } = renderHook(() => useRisk(ME));
    await waitFor(() => {
      expect(result.current).toMatchObject({ level: 2, capFactor: 0.5 });
    });
    expect(result.current?.resumeAt).toBeGreaterThan(Date.now());
  });

  it('shows a new risk event at once', async () => {
    const { result } = renderHook(() => useRisk(ME));
    await waitFor(() => {
      expect(result.current?.level).toBe(0);
    });

    await recordRisk(ME, 'automation_flag');
    await waitFor(() => {
      expect(result.current).toMatchObject({ level: 2, capFactor: 0.5 });
    });
  });

  it('re-evaluates every 30 seconds, so resume locks open on time', async () => {
    // A refused write locks resuming for 12 hours (risk.ts); this one ends 10 seconds from now.
    const HOUR_MS = 3_600_000;
    await db.risk.add({ accountId: ME, kind: 'restricted', at: Date.now() - 12 * HOUR_MS + 10_000 });
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const { result } = renderHook(() => useRisk(ME));
    await vi.waitFor(() => {
      expect(result.current?.resumeAt).toBeGreaterThan(Date.now());
    });

    // Nothing changes in the database; only time passes, and the next 30-second tick opens the lock.
    vi.setSystemTime(Date.now() + 30_000);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    await vi.waitFor(() => {
      expect(result.current?.resumeAt ?? 0).toBeLessThanOrEqual(Date.now());
    });
  });

  it('resumes anyway: records the override, then starts the job', async () => {
    const start = vi.spyOn(runner, 'start').mockResolvedValue(undefined);
    const job = await newJob();
    await recordConsent(ME);

    await resumeAnyway(job.id, ME);

    const events = await db.risk.toArray();
    expect(events.map((e) => [e.accountId, e.kind])).toEqual([[ME, 'override']]);
    expect(start).toHaveBeenCalledWith(job.id);
  });

  it('resuming anyway still needs consent', async () => {
    const start = vi.spyOn(runner, 'start').mockResolvedValue(undefined);
    const job = await newJob();
    const { result } = renderHook(() => useConsentRequest());

    const resumed = resumeAnyway(job.id, ME);
    await waitFor(() => {
      expect(result.current?.accountId).toBe(ME);
    });
    act(() => result.current!.answer(false));
    await resumed;
    expect(start).not.toHaveBeenCalled();
  });

  it('has no pace without an account', async () => {
    const { result } = renderHook(() => usePace(undefined));
    await db.logs.count();
    expect(result.current).toBeUndefined();
  });

  it('starts a new account at a quarter of the one-fifth allowances', async () => {
    const { result } = renderHook(() => usePace(ME));
    await waitFor(() => {
      expect(result.current).toMatchObject({ step: { day: 1, days: 4, factor: 0.25 }, factor: 0.25 });
    });
  });

  it('warms up with each earlier day that spent X’s quota', async () => {
    const now = Date.now();
    await db.logs.bulkAdd([
      logEntry({ ts: now - 2 * DAY, action: 'delete', outcome: 'done', level: 'success' }),
      logEntry({ ts: now - 3 * DAY, action: 'delete', outcome: 'rate_limited', level: 'warn' }),
      // Not counted: skipped items, page loads, job events and other accounts.
      logEntry({ ts: now - 4 * DAY, action: 'delete', outcome: 'skipped' }),
      logEntry({ ts: now - 5 * DAY, action: 'read', outcome: 'done' }),
      logEntry({ ts: now - 6 * DAY, action: 'system', outcome: 'done' }),
      logEntry({ ts: now - 7 * DAY, accountId: 'other', action: 'delete', outcome: 'done' }),
    ]);
    const { result } = renderHook(() => usePace(ME));

    await waitFor(() => {
      expect(result.current?.step).toEqual({ day: 3, days: 4, factor: 0.75 });
    });
    expect(result.current?.factor).toBe(0.75);
  });

  it('slows down with the risk ladder and drops back a warm-up step after a warning', async () => {
    const now = Date.now();
    await db.logs.bulkAdd([1, 2, 3, 4].map((d) => logEntry({ ts: now - d * DAY, action: 'unlike', outcome: 'done' })));
    await recordRisk(ME, 'automation_flag');
    const { result } = renderHook(() => usePace(ME));

    await waitFor(() => {
      expect(result.current?.step.day).toBe(3);
    });
    expect(result.current?.risk.capFactor).toBe(0.5);
    expect(result.current?.factor).toBe(0.375);
  });

  it('never lets the pace above one fifth', async () => {
    const now = Date.now();
    await db.logs.bulkAdd(
      [1, 2, 3, 4, 5, 6].map((d) => logEntry({ ts: now - d * DAY, action: 'delete', outcome: 'done' })),
    );
    const { result } = renderHook(() => usePace(ME));

    await waitFor(() => {
      expect(result.current?.step.day).toBe(4);
    });
    expect(result.current?.factor).toBe(1);
  });
});
