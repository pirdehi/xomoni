// Runs one job at a time from the dashboard page. A Web Lock makes sure only
// one open dashboard tab drives the worker.
import { NEED_TITLE, type Need } from '../shared/attention';
import { db, recordRisk } from '../shared/db';
import { ATTENTION_ID, FINISHED_ID, clearNotification, notify } from '../shared/notify';
import type { CleanupFilter, CleanupOptions, Job, JobState, ScanTarget } from '../shared/types';
import { runCleanup } from './cleanup';
import { Interrupted, JobContext, NeedsYou, Stop } from './context';
import { runScan } from './scan';
import { Aborted } from './timers';
import { NotReady, PageError, WorkerGone } from './worker-tab';

const LOCK = 'xomoni-runner';

/** What the dashboard shows about the runner in this tab; read with `runner.subscribe` and `runner.getState`. */
export interface RunnerState {
  /** The job this tab is running, or null when idle. */
  jobId: string | null;
  /** waiting = pacing / limits; attention = waiting for the person (see `need`). */
  status: 'idle' | 'running' | 'waiting' | 'attention' | 'stopping';
  message: string;
  /** When the current wait ends (epoch ms), while `status` is `waiting`. */
  waitUntil: number | null;
  /** What X needs from the person, while `status` is `attention`. */
  need: Need | null;
  /** The last start failed because another dashboard tab holds the runner lock. */
  busyElsewhere: boolean;
}

const IDLE: RunnerState = {
  jobId: null,
  status: 'idle',
  message: '',
  waitUntil: null,
  need: null,
  busyElsewhere: false,
};

type StopRequest = { state: Extract<JobState, 'paused' | 'cancelled'>; reason: string };

class Runner {
  private state: RunnerState = IDLE;
  private listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private stopRequest: StopRequest | null = null;

  /** Registers a state listener (for `useSyncExternalStore`); returns the unsubscribe function. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.state;

  private set(patch: Partial<RunnerState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  get busy() {
    return this.controller != null;
  }

  /**
   * Runs a job until it completes, pauses or stops, holding the Web Lock the whole time. Rejects if this tab
   * or another dashboard tab is already running a job.
   */
  async start(jobId: string) {
    if (this.controller) throw new Error('A job is already running.');
    const job = await db.jobs.get(jobId);
    if (!job) throw new Error('Job not found.');
    await navigator.locks.request(LOCK, { ifAvailable: true }, async (lock) => {
      if (!lock) {
        this.set({ busyElsewhere: true });
        throw new Error('Another Xomoni tab is already running a job. Use that tab, or close it.');
      }
      this.set({ busyElsewhere: false });
      await this.execute(job);
    });
  }

  /**
   * Aborts the current run: waits end at once, and an action already sent to the worker finishes first. The
   * job becomes `paused`.
   */
  pause(reason = 'Paused by you.') {
    this.request({ state: 'paused', reason });
  }

  /** Like `pause`, but the job ends as `cancelled`. */
  cancel() {
    this.request({ state: 'cancelled', reason: 'Cancelled by you.' });
  }

  private request(req: StopRequest) {
    if (!this.controller) return;
    this.stopRequest = req;
    this.set({ status: 'stopping', message: 'Finishing the current step…', waitUntil: null });
    this.controller.abort();
  }

  private async execute(job: Job) {
    const controller = new AbortController();
    this.controller = controller;
    this.stopRequest = null;
    Object.assign(job, { state: 'running', stateReason: '', startedAt: job.startedAt ?? Date.now(), finishedAt: null });
    this.set({ jobId: job.id, status: 'running', message: 'Starting…', waitUntil: null, need: null });

    const ctx = new JobContext(job, controller.signal, {
      status: (message, waitUntil) => {
        if (this.state.status === 'stopping' || this.state.status === 'attention') return;
        this.set({ status: waitUntil ? 'waiting' : 'running', message, waitUntil: waitUntil ?? null });
      },
      attention: (request) => {
        if (this.state.status === 'stopping') return;
        if (!request) {
          clearNotification(ATTENTION_ID);
          this.set({ status: 'running', message: 'Continuing…', waitUntil: null, need: null });
          return;
        }
        this.set({ status: 'attention', message: request.message, waitUntil: null, need: request.need });
        if (ctx.settings?.notifications !== false) {
          void notify(
            ATTENTION_ID,
            `Xomoni needs you: ${NEED_TITLE[request.need]}`,
            `${request.message} “${job.title}” continues by itself afterwards.`,
            true,
          );
        }
      },
    });

    let final: { state: JobState; reason: string };
    let stoppedByYou = false;
    try {
      await ctx.save();
      await ctx.init();
      await ctx.log('info', 'system', `Started “${job.title}”`);
      await runSteps(ctx);
      final = { state: 'completed', reason: '' };
    } catch (err) {
      stoppedByYou = err instanceof Aborted || controller.signal.aborted;
      if (stoppedByYou) final = this.stopRequest ?? { state: 'paused', reason: 'Stopped.' };
      else if (err instanceof Stop) {
        final = { state: err.state, reason: err.message };
        if (err.risk) await recordRisk(job.accountId, err.risk).catch(() => {});
      } else if (err instanceof WorkerGone)
        final = { state: 'paused', reason: 'The X worker window was closed. Resume to reopen it.' };
      else if (err instanceof PageError)
        final = {
          state: 'paused',
          reason: `The X page reported a problem: ${err.message}. Check the X window, then resume.`,
        };
      else final = { state: 'failed', reason: err instanceof Error ? err.message : String(err) };
    }
    clearNotification(ATTENTION_ID);
    // After the runner recorded the stop's risk event, so the report includes it.
    job.health = await ctx.health().catch(() => job.health);

    try {
      job.state = final.state;
      job.stateReason = final.reason;
      if (final.state === 'completed' || final.state === 'cancelled' || final.state === 'failed')
        job.finishedAt = Date.now();
      await ctx.save();
      const { done, skipped, failed } = job.stats;
      const summary =
        job.kind === 'scan'
          ? `${job.stats.scanned.toLocaleString()} posts seen`
          : `${done} done, ${skipped} skipped, ${failed} failed`;
      await ctx.log(
        final.state === 'completed'
          ? 'success'
          : final.state === 'paused' || final.state === 'cancelled'
            ? 'info'
            : 'error',
        'system',
        `${STATE_VERB[final.state]} “${job.title}” — ${summary}${final.reason ? `. ${final.reason}` : ''}`,
      );
      if (job.health) {
        await ctx.log(
          job.health.level > 0 || job.health.notice ? 'warn' : 'info',
          'system',
          `Account health: ${job.health.summary}`,
        );
      }
      if (!stoppedByYou && ctx.settings?.notifications !== false) {
        void notify(
          FINISHED_ID,
          `Xomoni: ${STATE_VERB[final.state].replace(/:$/, '')} “${job.title}”`,
          `${summary}. ${final.reason || job.health?.summary || ''}`.trim(),
        );
      }
    } finally {
      this.controller = null;
      this.stopRequest = null;
      this.set(IDLE);
    }
  }
}

/**
 * Connects and runs the job's steps. When X needs the person (login, 2FA, a
 * check), waits for them; when the connection, X or the worker page fails,
 * waits that out. Then runs the steps again: jobs are resumable, and
 * everything already handled is skipped.
 */
async function runSteps(ctx: JobContext) {
  for (;;) {
    try {
      await ctx.connect();
      if (ctx.job.kind === 'scan') await runScan(ctx);
      else await runCleanup(ctx);
      return;
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      if (err instanceof NeedsYou) await ctx.waitForYou(err);
      else if (err instanceof Interrupted || err instanceof NotReady) await ctx.waitOut(err);
      else throw err;
    }
  }
}

const STATE_VERB: Record<JobState, string> = {
  queued: 'Queued',
  running: 'Running',
  waiting: 'Waiting for you:',
  paused: 'Paused',
  blocked: 'Stopped for safety:',
  completed: 'Finished',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

/**
 * The runner of this dashboard tab. It runs one job at a time while holding the `xomoni-runner` Web Lock, so
 * only one open dashboard drives the worker.
 */
export const runner = new Runner();

/** A job still marked running with no runner holding the lock was interrupted. */
export async function recoverInterruptedJobs() {
  await navigator.locks.request(LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    await db.jobs
      .where('state')
      .anyOf('running', 'waiting')
      .modify({ state: 'paused', stateReason: 'Xomoni was closed while this job was running. Resume to continue.' });
  });
}

const emptyStats = () => ({ matched: 0, done: 0, skipped: 0, failed: 0, scanned: 0 });

/** Stores a new queued cleanup job and returns it; it does not start it. */
export async function createCleanupJob(
  accountId: string,
  title: string,
  filter: CleanupFilter,
  options: CleanupOptions,
) {
  const now = Date.now();
  const job: Job = {
    id: crypto.randomUUID(),
    accountId,
    kind: 'cleanup',
    title,
    filter,
    options,
    scan: null,
    state: 'queued',
    phase: '',
    stateReason: '',
    stats: emptyStats(),
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    updatedAt: now,
  };
  await db.jobs.put(job);
  return job;
}

/** Stores a new queued scan job and returns it; it does not start it. */
export async function createScanJob(accountId: string, title: string, scan: ScanTarget) {
  const now = Date.now();
  const job: Job = {
    id: crypto.randomUUID(),
    accountId,
    kind: 'scan',
    title,
    filter: null,
    options: null,
    scan,
    state: 'queued',
    phase: '',
    stateReason: '',
    stats: emptyStats(),
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    updatedAt: now,
  };
  await db.jobs.put(job);
  return job;
}
