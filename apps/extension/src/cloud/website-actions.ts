// xomoni.com's actions on this browser's jobs and pages (ADR-0027). The service worker hears them; this module decides.
// An action is taken only when this extension is signed in to Xomoni and connected as the device the page named, which
// the page knows only from its own account's devices: another account in this browser gets `other_account`.
// - Pause and cancel stop work, so they apply at once: a running job is stopped by the dashboard tab that runs it
//   (`requestStop`); a job that isn't running is cancelled here.
// - Resume never runs anything: it opens Xomoni with its own confirmation (`requestResume`), and only the person's yes
//   there starts the job, with the consent and safety checks every start has.
// Every action taken is written to the job's log.
import type { ActionAnswer, JobMessage, OpenMessage, XomoniPage } from '@xomoni/bridge';
import { addLog, db } from '../shared/db';
import { runnerLockHeld } from '../shared/runner-lock';
import type { Job } from '../shared/types';
import { CANCELLED_FROM_WEBSITE, requestResume, requestStop } from '../shared/website-requests';
import { accessRefusal } from './website-access';
import { syncOnce } from './sync';

/** What the service worker lends: opening Xomoni's dashboard on a page, focusing a tab that is already open. */
export interface ActionPorts {
  openDashboard(page: XomoniPage): Promise<void>;
}

/** States a job can't leave: nothing to pause, cancel or resume. */
const ENDED: ReadonlySet<Job['state']> = new Set(['completed', 'cancelled']);

function note(job: Job, message: string) {
  return addLog({
    accountId: job.accountId,
    jobId: job.id,
    level: 'info',
    action: 'system',
    targetId: null,
    outcome: null,
    message,
  });
}

/** Answers `xomoni-job`: pauses or cancels a job, or asks the person in Xomoni to resume it. Never starts one. */
export async function answerJob(message: JobMessage, ports: ActionPorts, now = Date.now()): Promise<ActionAnswer> {
  const refused = await accessRefusal(message.deviceId);
  if (refused) return { ok: false, reason: refused };
  const job = await db.jobs.get(message.jobId);
  if (!job) return { ok: false, reason: 'no_job' };
  if (ENDED.has(job.state)) return { ok: false, reason: 'finished' };
  const running = (job.state === 'running' || job.state === 'waiting') && (await runnerLockHeld());
  switch (message.action) {
    case 'pause':
      if (!running) return { ok: false, reason: 'not_running' };
      await requestStop({ jobId: job.id, state: 'paused', at: now });
      await note(job, 'xomoni.com asked to pause this job.');
      return { ok: true, outcome: 'stopping' };
    case 'cancel':
      if (running) {
        await requestStop({ jobId: job.id, state: 'cancelled', at: now });
        await note(job, 'xomoni.com asked to cancel this job.');
        return { ok: true, outcome: 'stopping' };
      }
      await db.jobs.update(job.id, {
        state: 'cancelled',
        stateReason: CANCELLED_FROM_WEBSITE,
        finishedAt: now,
        updatedAt: now,
      });
      await note(job, CANCELLED_FROM_WEBSITE);
      // No dashboard may be open to report it, so xomoni.com hears of it now.
      void syncOnce().catch(() => undefined);
      return { ok: true, outcome: 'cancelled' };
    case 'resume':
      if (running) {
        await ports.openDashboard('activity');
        return { ok: true, outcome: 'opened' };
      }
      await requestResume({ jobId: job.id, at: now });
      await note(job, 'xomoni.com asked to resume this job. It waits for your answer in Xomoni.');
      await ports.openDashboard('activity');
      return { ok: true, outcome: 'asked' };
  }
}

/** Answers `xomoni-open`: opens one of Xomoni's pages. */
export async function answerOpen(message: OpenMessage, ports: ActionPorts): Promise<ActionAnswer> {
  const refused = await accessRefusal(message.deviceId);
  if (refused) return { ok: false, reason: refused };
  await ports.openDashboard(message.page);
  return { ok: true, outcome: 'opened' };
}
