import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Interrupted, type JobContext, NeedsYou, Stop } from '../src/engine/context';
import {
  type RunnerState,
  createCleanupJob,
  createScanJob,
  recoverInterruptedJobs,
  runner,
} from '../src/engine/runner';
import { Aborted } from '../src/engine/timers';
import type * as Timers from '../src/engine/timers';
import { NotReady, PageError, WorkerGone } from '../src/engine/worker-tab';
import type * as WorkerTabModule from '../src/engine/worker-tab';
import { NEED_TITLE } from '../src/shared/attention';
import { db, kvSet, recordConsent, upsertAccount } from '../src/shared/db';
import { healthReport } from '../src/shared/health';
import type { ActorCommand, PageInfo } from '../src/shared/messages';
import { ATTENTION_ID, FINISHED_ID } from '../src/shared/notify';
import type * as Notify from '../src/shared/notify';
import { assessRisk } from '../src/shared/risk';
import type { CleanupFilter, CleanupOptions, Job, JobState } from '../src/shared/types';
import { ACCOUNT, page, stubLocks, untilAborted } from './support/engine';
import { resetDb } from './support/fixtures';

const { runCleanup, runScan, worker, notify, clearNotification } = vi.hoisted(() => ({
  runCleanup: vi.fn<(ctx: JobContext) => Promise<void>>(),
  runScan: vi.fn<(ctx: JobContext) => Promise<void>>(),
  worker: {
    current: vi.fn<() => Promise<number | null>>(),
    open: vi.fn<() => Promise<number>>(),
    keepLoaded: vi.fn<() => Promise<void>>(),
    waitReady: vi.fn<(signal: AbortSignal, notBootId?: string) => Promise<PageInfo>>(),
    ping: vi.fn<() => Promise<PageInfo | null>>(),
    send: vi.fn<(command: ActorCommand) => Promise<unknown>>(),
    discarded: vi.fn<() => Promise<boolean>>(),
    navigate: vi.fn<(url: string, signal: AbortSignal) => Promise<PageInfo>>(),
  },
  notify: vi.fn<typeof Notify.notify>(),
  clearNotification: vi.fn<typeof Notify.clearNotification>(),
}));

// The job's steps and the worker tab are mocked, so no X page is needed: these tests are about the runner.
vi.mock('../src/engine/cleanup', () => ({ runCleanup }));
vi.mock('../src/engine/scan', () => ({ runScan }));
vi.mock('../src/engine/worker-tab', async (importOriginal) => ({
  ...(await importOriginal<typeof WorkerTabModule>()),
  workerTab: worker,
}));
vi.mock('../src/shared/notify', async (importOriginal) => ({
  ...(await importOriginal<typeof Notify>()),
  notify,
  clearNotification,
}));
// The real sleep runs on a Web Worker, which tests don't have; here it moves the fake clock forward instead.
vi.mock('../src/engine/timers', async (importOriginal) => {
  const actual = await importOriginal<typeof Timers>();
  return {
    ...actual,
    sleep: async (ms: number, signal?: AbortSignal) => {
      if (signal?.aborted) throw new actual.Aborted();
      vi.setSystemTime(Date.now() + Math.max(0, ms));
    },
  };
});

const MINUTE = 60_000;
/** Local noon, inside the default active hours. */
const NOW = new Date(2026, 10, 2, 12, 0, 0).getTime();
const TITLE = 'Delete old posts';
const HEALTHY = 'Healthy: no warnings from X.';
const NOTHING_DONE = '0 done, 0 skipped, 0 failed';
const LOGGED_OUT = page({ loggedIn: false, viewerId: null, path: '/i/flow/login' });
const LOGIN = 'Log in to X as @me in the Xomoni window (including 2FA).';
const IDLE: RunnerState = {
  jobId: null,
  status: 'idle',
  message: '',
  waitUntil: null,
  need: null,
  busyElsewhere: false,
};

const FILTER: CleanupFilter = {
  target: 'post',
  before: NOW,
  after: null,
  keepMinLikes: null,
  keepKeywords: [],
  keepIds: [],
  skipSelfReplies: false,
};
const OPTIONS: CleanupOptions = { sweep: true, deep: true, ghostLikes: false };

let locks: ReturnType<typeof stubLocks>;
/** Every state the runner published during the test, in order. */
let states: RunnerState[];
let unsubscribe: () => void;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  locks = stubLocks();
  await resetDb();
  await recordConsent(ACCOUNT);
  await upsertAccount({ id: ACCOUNT, handle: 'me' });

  worker.current.mockResolvedValue(7);
  worker.open.mockResolvedValue(7);
  worker.keepLoaded.mockResolvedValue();
  worker.waitReady.mockResolvedValue(page());
  worker.ping.mockResolvedValue(page());
  worker.discarded.mockResolvedValue(false);
  worker.navigate.mockResolvedValue(page());
  worker.send.mockResolvedValue({ clear: true, what: '' });
  runCleanup.mockResolvedValue();
  runScan.mockResolvedValue();
  notify.mockResolvedValue();

  states = [];
  unsubscribe = runner.subscribe(() => {
    states.push(runner.getState());
  });
});

afterEach(() => {
  unsubscribe();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const newCleanup = () => createCleanupJob(ACCOUNT, TITLE, FILTER, OPTIONS);

async function stored(id: string): Promise<Job> {
  return (await db.jobs.get(id))!;
}

/** Runs the job to its end and returns it as stored. */
async function run(job: Job): Promise<Job> {
  await runner.start(job.id);
  return stored(job.id);
}

/** The job's activity log as [level, message] pairs, oldest first. */
async function logLines(jobId: string) {
  const rows = await db.logs.where('jobId').equals(jobId).sortBy('seq');
  return rows.map((row) => [row.level, row.message]);
}

/** Makes the cleanup steps run until the person pauses or cancels; resolves once they started. */
function runUntilStopped(): Promise<void> {
  return new Promise((started) => {
    runCleanup.mockImplementation((ctx) => {
      started();
      return untilAborted(ctx.signal, () => new Aborted());
    });
  });
}

/** Whether a desktop notification about the job's end was shown. */
const finishedNotified = () => notify.mock.calls.some(([id]) => id === FINISHED_ID);

describe('runner: a run that ends by itself', () => {
  it('completes a cleanup job, logs a summary and the health report, and notifies', async () => {
    const job = await newCleanup();
    let during: Job | undefined;
    runCleanup.mockImplementation(async (ctx) => {
      during = await db.jobs.get(ctx.job.id);
      Object.assign(ctx.job.stats, { done: 3, skipped: 1 });
    });

    const done = await run(job);

    expect(during).toMatchObject({ state: 'running', stateReason: '', startedAt: NOW, finishedAt: null });
    expect(runCleanup).toHaveBeenCalledOnce();
    expect(runScan).not.toHaveBeenCalled();
    expect(done).toMatchObject({
      state: 'completed',
      stateReason: '',
      startedAt: NOW,
      finishedAt: NOW,
      stats: { done: 3, skipped: 1, failed: 0 },
    });
    expect(done.health).toMatchObject({ level: 0, summary: HEALTHY });
    expect(await logLines(job.id)).toEqual([
      ['info', `Started “${TITLE}”`],
      ['success', `Finished “${TITLE}” — 3 done, 1 skipped, 0 failed`],
      ['info', `Account health: ${HEALTHY}`],
    ]);
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      FINISHED_ID,
      `Xomoni: Finished “${TITLE}”`,
      `3 done, 1 skipped, 0 failed. ${HEALTHY}`,
    );
    expect(clearNotification).toHaveBeenCalledWith(ATTENTION_ID);
  });

  it('publishes its progress and waits, then goes back to idle', async () => {
    const job = await newCleanup();
    let busyDuring = false;
    runCleanup.mockImplementation(async (ctx) => {
      busyDuring = runner.busy;
      ctx.status('Deleting: “hello”');
      await ctx.limiter.cooldown(NOW + 5 * MINUTE, 'X rate limit — waiting for the window to reset');
    });

    await run(job);

    expect(busyDuring).toBe(true);
    expect(states).toContainEqual(expect.objectContaining({ jobId: job.id, status: 'running', message: 'Starting…' }));
    expect(states).toContainEqual(
      expect.objectContaining({ jobId: job.id, status: 'running', message: 'Deleting: “hello”', waitUntil: null }),
    );
    expect(states).toContainEqual(
      expect.objectContaining({
        status: 'waiting',
        message: 'X rate limit — waiting for the window to reset',
        waitUntil: NOW + 5 * MINUTE,
      }),
    );
    expect(runner.getState()).toEqual(IDLE);
    expect(runner.busy).toBe(false);
    expect(locks.held.size).toBe(0);
  });

  it('keeps the first start time when a paused job is resumed', async () => {
    const job = await newCleanup();
    await db.jobs.update(job.id, { state: 'paused', stateReason: 'Paused by you.', startedAt: NOW - 3 * MINUTE });

    const done = await run(job);

    expect(done).toMatchObject({ state: 'completed', stateReason: '', startedAt: NOW - 3 * MINUTE });
  });

  it('finishes with what the person should know, such as posts Xomoni could not see', async () => {
    const job = await newCleanup();
    runCleanup.mockImplementation(async (ctx) => {
      await ctx.note('X counts 40 more posts than Xomoni found.');
      await ctx.note('Search missed 3 replies.');
    });

    const done = await run(job);

    const reason = 'X counts 40 more posts than Xomoni found. Search missed 3 replies.';
    expect(done).toMatchObject({ state: 'completed', stateReason: reason });
    const lines = await logLines(job.id);
    expect(lines).toContainEqual(['warn', 'X counts 40 more posts than Xomoni found.']);
    expect(lines).toContainEqual(['success', `Finished “${TITLE}” — ${NOTHING_DONE}. ${reason}`]);
    expect(notify).toHaveBeenCalledWith(FINISHED_ID, `Xomoni: Finished “${TITLE}”`, `${NOTHING_DONE}. ${reason}`);
  });

  it('runs a scan job’s steps and sums it up in posts seen', async () => {
    const job = await createScanJob(ACCOUNT, 'Scan: posts', 'posts');
    runScan.mockImplementation(async (ctx) => {
      ctx.job.stats.scanned = 1234;
    });

    const done = await run(job);

    const seen = `${(1234).toLocaleString()} posts seen`;
    expect(runScan).toHaveBeenCalledOnce();
    expect(runCleanup).not.toHaveBeenCalled();
    expect(done.state).toBe('completed');
    expect(await logLines(job.id)).toContainEqual(['success', `Finished “Scan: posts” — ${seen}`]);
    expect(notify).toHaveBeenCalledWith(FINISHED_ID, 'Xomoni: Finished “Scan: posts”', `${seen}. ${HEALTHY}`);
  });

  it('shows no notification when the person turned notifications off', async () => {
    await kvSet('settings', { notifications: false });
    const job = await newCleanup();
    runCleanup.mockRejectedValue(new Error('Something broke'));

    const done = await run(job);

    expect(done.state).toBe('failed');
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('runner: pause and cancel', () => {
  it('pauses at the person’s request, without a notification', async () => {
    const job = await newCleanup();
    const started = runUntilStopped();
    const running = runner.start(job.id);
    await started;

    runner.pause();
    expect(runner.getState()).toMatchObject({
      jobId: job.id,
      status: 'stopping',
      message: 'Finishing the current step…',
      waitUntil: null,
    });
    await running;

    const done = await stored(job.id);
    expect(done).toMatchObject({ state: 'paused', stateReason: 'Paused by you.', finishedAt: null });
    expect(await logLines(job.id)).toContainEqual(['info', `Paused “${TITLE}” — ${NOTHING_DONE}. Paused by you.`]);
    expect(notify).not.toHaveBeenCalled();
    expect(runner.getState()).toEqual(IDLE);
  });

  it('keeps the reason given for a pause', async () => {
    const job = await newCleanup();
    const started = runUntilStopped();
    const running = runner.start(job.id);
    await started;

    runner.pause('Paused: the computer is going to sleep.');
    await running;

    expect(await stored(job.id)).toMatchObject({
      state: 'paused',
      stateReason: 'Paused: the computer is going to sleep.',
    });
  });

  it('cancels at the person’s request: the job ends, without a notification', async () => {
    const job = await newCleanup();
    const started = runUntilStopped();
    const running = runner.start(job.id);
    await started;

    runner.cancel();
    await running;

    const done = await stored(job.id);
    expect(done).toMatchObject({ state: 'cancelled', stateReason: 'Cancelled by you.', finishedAt: NOW });
    expect(await logLines(job.id)).toContainEqual([
      'info',
      `Cancelled “${TITLE}” — ${NOTHING_DONE}. Cancelled by you.`,
    ]);
    expect(notify).not.toHaveBeenCalled();
  });

  it('ignores pause and cancel while no job runs', () => {
    runner.pause();
    runner.cancel();
    expect(states).toEqual([]);
    expect(runner.getState()).toEqual(IDLE);
  });

  it('shows no more progress once the person asked to stop', async () => {
    const job = await newCleanup();
    runCleanup.mockImplementation(async (ctx) => {
      runner.pause();
      ctx.status('Deleting: “late”');
      throw new Aborted();
    });

    const done = await run(job);

    expect(states.map((s) => s.message)).not.toContain('Deleting: “late”');
    expect(done).toMatchObject({ state: 'paused', stateReason: 'Paused by you.' });
  });

  it('pauses as “Stopped.” when a wait was aborted without a request', async () => {
    const job = await newCleanup();
    runCleanup.mockRejectedValue(new Aborted());

    const done = await run(job);

    expect(done).toMatchObject({ state: 'paused', stateReason: 'Stopped.', finishedAt: null });
    expect(notify).not.toHaveBeenCalled();
  });

  it('pauses while waiting for the person, and takes down the “X needs you” notification', async () => {
    const job = await newCleanup();
    runCleanup.mockRejectedValue(new NeedsYou('login', LOGIN));
    worker.ping.mockResolvedValue(LOGGED_OUT);
    const pauseWhenAsked = runner.subscribe(() => {
      if (runner.getState().status === 'attention') queueMicrotask(() => runner.pause());
    });

    const done = await run(job);
    pauseWhenAsked();

    expect(states).toContainEqual(expect.objectContaining({ status: 'attention', need: 'login', message: LOGIN }));
    expect(done).toMatchObject({ state: 'paused', stateReason: 'Paused by you.' });
    expect(runCleanup).toHaveBeenCalledOnce();
    expect(finishedNotified()).toBe(false);
    expect(clearNotification).toHaveBeenLastCalledWith(ATTENTION_ID);
  });

  it('counts a job whose steps all finished as completed, even if Pause came during the last one', async () => {
    const job = await newCleanup();
    runCleanup.mockImplementation(async () => {
      runner.pause();
    });

    expect((await run(job)).state).toBe('completed');
  });

  // The work finished, so the job is completed; but the person asked to stop, so no notification.
  it('shows no notification when the person paused while the last step finished', async () => {
    const job = await newCleanup();
    runCleanup.mockImplementation(async () => {
      runner.pause();
    });

    await run(job);

    expect(notify).not.toHaveBeenCalled();
  });
});

describe('runner: stops for safety, problems and errors', () => {
  const RESTRICTION = 'X shows a restriction on this account: “Your account is temporarily limited”.';

  it('stops for safety and records the stop’s risk event before the health report', async () => {
    const job = await newCleanup();
    runCleanup.mockRejectedValue(new Stop('blocked', RESTRICTION, 'restricted'));

    const done = await run(job);

    expect(done).toMatchObject({ state: 'blocked', stateReason: RESTRICTION, finishedAt: null });
    expect(await db.risk.toArray()).toEqual([expect.objectContaining({ accountId: ACCOUNT, kind: 'restricted' })]);
    expect(done.health?.signals).toEqual({ restricted: 1 });
    expect(done.health?.level).toBeGreaterThan(0);
    const lines = await logLines(job.id);
    expect(lines).toContainEqual(['error', `Stopped for safety: “${TITLE}” — ${NOTHING_DONE}. ${RESTRICTION}`]);
    expect(lines).toContainEqual(['warn', `Account health: ${done.health?.summary ?? ''}`]);
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      FINISHED_ID,
      `Xomoni: Stopped for safety “${TITLE}”`,
      `${NOTHING_DONE}. ${RESTRICTION}`,
    );
  });

  it('records nothing on the risk ladder for a stop without a risk event', async () => {
    const job = await newCleanup();
    const reason = '2 failures in a row. X may have changed its page. Check it, then resume.';
    runCleanup.mockRejectedValue(new Stop('paused', reason));

    const done = await run(job);

    expect(done).toMatchObject({ state: 'paused', stateReason: reason });
    expect(await db.risk.count()).toBe(0);
    expect(notify).toHaveBeenCalledWith(FINISHED_ID, `Xomoni: Paused “${TITLE}”`, `${NOTHING_DONE}. ${reason}`);
  });

  it('still stops for safety when the risk event can’t be stored', async () => {
    const job = await newCleanup();
    vi.spyOn(db.risk, 'add').mockRejectedValue(new Error('QuotaExceededError'));
    runCleanup.mockRejectedValue(new Stop('blocked', RESTRICTION, 'restricted'));

    expect(await run(job)).toMatchObject({ state: 'blocked', stateReason: RESTRICTION });
  });

  // A safety stop wins over a Pause pressed at the same moment: the risk ladder must hear of it (PLAYBOOK §7).
  it('records the risk event of a safety stop that arrives as the person pauses, and ends blocked', async () => {
    const job = await newCleanup();
    runCleanup.mockImplementation(async () => {
      runner.pause();
      throw new Stop('blocked', RESTRICTION, 'restricted');
    });

    expect(await run(job)).toMatchObject({ state: 'blocked', stateReason: RESTRICTION });
    expect((await db.risk.toArray()).map((e) => e.kind)).toEqual(['restricted']);
  });

  it.each<[string, () => void, string]>([
    [
      'the worker window was closed',
      () => worker.waitReady.mockRejectedValue(new WorkerGone()),
      'The X worker window was closed. Resume to reopen it.',
    ],
    [
      'the X page reported a problem',
      () => runCleanup.mockRejectedValue(new PageError('No post menu')),
      'The X page reported a problem: No post menu. Check the X window, then resume.',
    ],
  ])('pauses and tells the person when %s', async (_, fail, reason) => {
    const job = await newCleanup();
    fail();

    const done = await run(job);

    expect(done).toMatchObject({ state: 'paused', stateReason: reason, finishedAt: null });
    expect(await logLines(job.id)).toContainEqual(['info', `Paused “${TITLE}” — ${NOTHING_DONE}. ${reason}`]);
    expect(notify).toHaveBeenCalledWith(FINISHED_ID, `Xomoni: Paused “${TITLE}”`, `${NOTHING_DONE}. ${reason}`);
  });

  it.each<[string, unknown, string]>([
    ['an Error', new Error('Cannot read the inventory'), 'Cannot read the inventory'],
    ['anything else', 'weird', 'weird'],
  ])('fails on an unexpected error (%s)', async (_, error, reason) => {
    const job = await newCleanup();
    runCleanup.mockRejectedValue(error);

    const done = await run(job);

    expect(done).toMatchObject({ state: 'failed', stateReason: reason, finishedAt: NOW });
    expect(await logLines(job.id)).toContainEqual(['error', `Failed “${TITLE}” — ${NOTHING_DONE}. ${reason}`]);
    expect(notify).toHaveBeenCalledWith(FINISHED_ID, `Xomoni: Failed “${TITLE}”`, `${NOTHING_DONE}. ${reason}`);
  });

  it('refuses to touch X without the person’s consent for the account', async () => {
    await db.consents.clear();
    const job = await newCleanup();

    const done = await run(job);

    expect(done.state).toBe('blocked');
    expect(done.stateReason).toMatch(/^Read the risks for this X account first/);
    expect(worker.waitReady).not.toHaveBeenCalled();
    expect(runCleanup).not.toHaveBeenCalled();
    expect(await db.risk.count()).toBe(0);
  });

  // Settings load before the consent check, so a refused start still respects them.
  it('respects notifications off for a job refused before it started', async () => {
    await kvSet('settings', { notifications: false });
    await db.consents.clear();
    const job = await newCleanup();

    await run(job);

    expect(notify).not.toHaveBeenCalled();
  });

  it('keeps the previous health report when a new one can’t be made', async () => {
    const job = await newCleanup();
    const previous = healthReport({
      risk: assessRisk([], NOW),
      events: [],
      checks: { applied: 0, notApplied: 0, unclear: 0, pending: 0 },
      notice: 'Your account is temporarily limited',
      now: NOW - 60 * MINUTE,
    });
    await db.jobs.update(job.id, { health: previous });
    vi.spyOn(db.risk, 'where').mockImplementation(() => {
      throw new Error('IndexedDB is closed');
    });

    const done = await run(job);

    expect(done).toMatchObject({ state: 'failed', stateReason: 'IndexedDB is closed', health: previous });
    expect(await logLines(job.id)).toContainEqual(['warn', `Account health: ${previous.summary}`]);
  });

  it('goes back to idle and frees the lock when the final state can’t be saved', async () => {
    const job = await newCleanup();
    runCleanup.mockImplementation(async () => {
      vi.spyOn(db.jobs, 'put').mockRejectedValue(new Error('QuotaExceededError'));
    });

    await expect(runner.start(job.id)).rejects.toThrow('QuotaExceededError');

    expect(runner.getState()).toEqual(IDLE);
    expect(runner.busy).toBe(false);
    expect(locks.held.size).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('runner: X needs the person, interruptions', () => {
  it('waits while X needs the person, notifies them, then runs the steps again', async () => {
    const job = await newCleanup();
    runCleanup.mockRejectedValueOnce(new NeedsYou('login', LOGIN));
    worker.ping.mockResolvedValueOnce(LOGGED_OUT).mockResolvedValueOnce(LOGGED_OUT);

    const done = await run(job);

    expect(runCleanup).toHaveBeenCalledTimes(2);
    expect(done.state).toBe('completed');
    expect(states).toContainEqual(
      expect.objectContaining({ status: 'attention', message: LOGIN, need: 'login', waitUntil: null }),
    );
    expect(states).toContainEqual(expect.objectContaining({ status: 'running', message: 'Continuing…', need: null }));
    expect(notify).toHaveBeenCalledWith(
      ATTENTION_ID,
      `Xomoni needs you: ${NEED_TITLE.login}`,
      `${LOGIN} “${TITLE}” continues by itself afterwards.`,
      true,
    );
    expect(clearNotification.mock.calls.filter(([id]) => id === ATTENTION_ID).length).toBeGreaterThanOrEqual(2);
    const lines = await logLines(job.id);
    expect(lines).toContainEqual(['warn', `Waiting for you: ${LOGIN}`]);
    expect(lines).toContainEqual(['success', 'X is ready again — continuing']);
  });

  it('rests 60 to 90 minutes after X checked the account', async () => {
    const job = await newCleanup();
    const verify = 'X wants to confirm it’s you. Complete it in the Xomoni window.';
    runCleanup.mockRejectedValueOnce(new NeedsYou('verify', verify));

    expect((await run(job)).state).toBe('completed');

    const rest = states.find((s) => s.message === 'Resting after X’s check (60–90 min)');
    expect(rest?.status).toBe('waiting');
    expect(rest!.waitUntil! - NOW).toBeGreaterThanOrEqual(60 * MINUTE);
    expect(rest!.waitUntil! - NOW).toBeLessThanOrEqual(91 * MINUTE);
  });

  it('does not notify that X needs the person when notifications are off', async () => {
    await kvSet('settings', { notifications: false });
    const job = await newCleanup();
    runCleanup.mockRejectedValueOnce(new NeedsYou('login', LOGIN));

    expect((await run(job)).state).toBe('completed');
    expect(notify).not.toHaveBeenCalled();
  });

  it('waits out an X outage and runs the steps again without counting a failure', async () => {
    const job = await newCleanup();
    runCleanup.mockRejectedValueOnce(new Interrupted('outage', 'X answered HTTP 503'));

    const done = await run(job);

    expect(runCleanup).toHaveBeenCalledTimes(2);
    expect(done).toMatchObject({ state: 'completed', stats: { failed: 0 } });
    const wait = states.find((s) => s.message === 'X is having trouble — trying again in about 1 min');
    expect(wait?.status).toBe('waiting');
    expect(wait!.waitUntil! - NOW).toBeGreaterThanOrEqual(MINUTE);
    expect(await logLines(job.id)).toContainEqual([
      'warn',
      'X answered HTTP 503. Waiting; nothing is counted as failed',
    ]);
  });

  it('connects again when the worker page did not answer', async () => {
    const job = await newCleanup();
    worker.waitReady.mockRejectedValueOnce(new NotReady('The X worker tab did not finish loading'));

    const done = await run(job);

    expect(done.state).toBe('completed');
    expect(worker.waitReady).toHaveBeenCalledTimes(2);
    expect(runCleanup).toHaveBeenCalledOnce();
    expect(states).toContainEqual(
      expect.objectContaining({
        status: 'waiting',
        message: 'The X page stopped answering — trying again in about 1 min',
      }),
    );
  });
});

describe('runner.start: one job at a time', () => {
  it('rejects a job that does not exist', async () => {
    await expect(runner.start('missing')).rejects.toThrow('Job not found.');
    expect(locks.request).not.toHaveBeenCalled();
  });

  it('refuses while another dashboard tab holds the runner lock, and runs once it is free', async () => {
    const job = await newCleanup();
    const release = locks.holdElsewhere('xomoni-runner');

    await expect(runner.start(job.id)).rejects.toThrow(
      'Another Xomoni tab is already running a job. Use that tab, or close it.',
    );
    expect(runner.getState().busyElsewhere).toBe(true);
    expect((await stored(job.id)).state).toBe('queued');
    expect(runCleanup).not.toHaveBeenCalled();

    release();
    expect((await run(job)).state).toBe('completed');
    expect(states).toContainEqual(expect.objectContaining({ jobId: job.id, busyElsewhere: false }));
  });

  it('refuses a second start made before the first one has set up, without blaming another tab', async () => {
    const first = await newCleanup();
    const second = await newCleanup();
    const started = runUntilStopped();
    const running = runner.start(first.id);
    const twin = runner.start(second.id);

    await expect(twin).rejects.toThrow('A job is already running.');
    await started;
    expect(runner.getState()).toMatchObject({ jobId: first.id, busyElsewhere: false });

    runner.pause();
    await running;
  });

  it('refuses a second job while this tab runs one', async () => {
    const first = await newCleanup();
    const second = await newCleanup();
    const started = runUntilStopped();
    const running = runner.start(first.id);
    await started;

    await expect(runner.start(second.id)).rejects.toThrow('A job is already running.');
    expect(runner.getState().jobId).toBe(first.id);

    runner.pause();
    await running;
    expect((await stored(second.id)).state).toBe('queued');
  });
});

describe('recoverInterruptedJobs', () => {
  const RECOVERED = 'Xomoni was closed while this job was running. Resume to continue.';

  async function jobIn(state: JobState) {
    const job = await newCleanup();
    await db.jobs.update(job.id, { state, stateReason: `was ${state}` });
    return job.id;
  }

  it('pauses the jobs Chrome closed while they ran or waited, and leaves the others', async () => {
    const ids = {
      running: await jobIn('running'),
      waiting: await jobIn('waiting'),
      paused: await jobIn('paused'),
      queued: await jobIn('queued'),
      completed: await jobIn('completed'),
      blocked: await jobIn('blocked'),
    };

    await recoverInterruptedJobs();

    expect(await stored(ids.running)).toMatchObject({ state: 'paused', stateReason: RECOVERED });
    expect(await stored(ids.waiting)).toMatchObject({ state: 'paused', stateReason: RECOVERED });
    expect(await stored(ids.paused)).toMatchObject({ state: 'paused', stateReason: 'was paused' });
    expect(await stored(ids.queued)).toMatchObject({ state: 'queued', stateReason: 'was queued' });
    expect(await stored(ids.completed)).toMatchObject({ state: 'completed', stateReason: 'was completed' });
    expect(await stored(ids.blocked)).toMatchObject({ state: 'blocked', stateReason: 'was blocked' });
  });

  it('leaves the job alone while another dashboard tab runs it', async () => {
    const id = await jobIn('running');
    locks.holdElsewhere('xomoni-runner');

    await recoverInterruptedJobs();

    expect(await stored(id)).toMatchObject({ state: 'running', stateReason: 'was running' });
  });

  it('leaves the job this tab is running alone', async () => {
    const job = await newCleanup();
    const started = runUntilStopped();
    const running = runner.start(job.id);
    await started;

    await recoverInterruptedJobs();
    expect((await stored(job.id)).state).toBe('running');

    runner.pause();
    await running;
  });
});

describe('createCleanupJob and createScanJob', () => {
  it('stores a queued cleanup job without starting it', async () => {
    const job = await newCleanup();

    expect(await stored(job.id)).toEqual({
      id: job.id,
      accountId: ACCOUNT,
      kind: 'cleanup',
      title: TITLE,
      filter: FILTER,
      options: OPTIONS,
      scan: null,
      state: 'queued',
      phase: '',
      stateReason: '',
      stats: { matched: 0, done: 0, skipped: 0, failed: 0, scanned: 0 },
      createdAt: NOW,
      startedAt: null,
      finishedAt: null,
      updatedAt: NOW,
    });
    expect(runCleanup).not.toHaveBeenCalled();
    expect(runner.getState()).toEqual(IDLE);
  });

  it('stores a queued scan job, with its date range only for a range scan', async () => {
    const posts = await createScanJob(ACCOUNT, 'Scan: posts', 'posts');
    const range = { after: NOW - 400 * 24 * 60 * MINUTE, before: NOW };
    const archive = await createScanJob(ACCOUNT, 'Archive 2025', 'range', range);

    expect(await stored(posts.id)).toMatchObject({
      kind: 'scan',
      scan: 'posts',
      filter: null,
      options: null,
      state: 'queued',
    });
    expect('range' in (await stored(posts.id))).toBe(false);
    expect(await stored(archive.id)).toMatchObject({ kind: 'scan', scan: 'range', range, title: 'Archive 2025' });
    expect(posts.id).not.toBe(archive.id);
    expect(runScan).not.toHaveBeenCalled();
  });
});
