// What Home says first (#201): whether all is well, what runs now and the one thing to do next, and how far a new
// person got with getting started. Pure, so every case is tested without drawing the page.
import type { RunnerState } from '../engine/runner';
import type { RiskAssessment } from '../shared/risk';
import type { Job } from '../shared/types';
import { fmtDuration } from './format';

/** How far a cleanup got, 0 to 100, from what X settled of what matched; null for jobs that don't count that way. */
export function jobPercent(job: Pick<Job, 'kind' | 'stats'>): number | null {
  const { matched, done, skipped, failed } = job.stats;
  if (job.kind !== 'cleanup' || matched <= 0) return null;
  return Math.min(100, Math.round(((done + skipped + failed) / matched) * 100));
}

/** The one thing Home's status offers to do. */
export type HomeAction =
  | { kind: 'open-x'; label: string }
  | { kind: 'resume'; label: string; jobId: string }
  | { kind: 'jobs'; label: string };

/** Home's status: a tone, a title, one sentence and at most one action. */
export interface HomeStatus {
  tone: 'good' | 'accent' | 'warn' | 'critical';
  title: string;
  text: string;
  action?: HomeAction;
}

/** What Home's status is made from: this tab's runner, the open jobs (newest first) and the risk ladder. */
export interface HomeStatusInput {
  run: Pick<RunnerState, 'status' | 'jobId' | 'need'>;
  openJobs: readonly Job[];
  risk: Pick<RiskAssessment, 'level' | 'reason' | 'resumeAt' | 'fullStop'> | undefined;
  now: number;
}

const progressOf = (job: Job) => {
  const pct = jobPercent(job);
  return pct == null ? '' : ` ${pct}% done.`;
};

/**
 * Home's status, the most pressing first:
 * 1. X needs the person;
 * 2. the risk ladder stopped everything;
 * 3. a job runs;
 * 4. Xomoni rests after X's warning;
 * 5. a job is paused;
 * 6. all is quiet.
 */
export function homeStatus({ run, openJobs, risk, now }: HomeStatusInput): HomeStatus {
  const running = run.jobId ? openJobs.find((j) => j.id === run.jobId) : undefined;
  if (run.status === 'attention') {
    return {
      tone: 'warn',
      title: run.need === 'hidden' ? 'Keep the X window on screen' : 'X needs you',
      text:
        run.need === 'hidden'
          ? 'Chrome pauses the X window while it is hidden. Show it, or run hidden, and the job carries on by itself.'
          : 'Finish what X asks in the X window. The job carries on by itself; Xomoni never sees what you type.',
      action: { kind: 'open-x', label: 'Open X window' },
    };
  }
  if (risk?.fullStop) {
    return {
      tone: 'critical',
      title: 'Stopped to keep your account safe',
      text: `${risk.reason}. Xomoni won’t carry on by itself: check X, then decide in Jobs.`,
      action: { kind: 'jobs', label: 'Go to Jobs' },
    };
  }
  if (run.status !== 'idle') {
    return {
      tone: 'accent',
      title: running ? `Working on “${running.title}”` : 'Working',
      text: `${running ? progressOf(running).trim() : ''} Xomoni goes at a careful pace and stops by itself if X objects.`.trim(),
      action: { kind: 'jobs', label: 'See progress' },
    };
  }
  if (risk && risk.level > 0 && risk.resumeAt != null && risk.resumeAt > now) {
    return {
      tone: 'warn',
      title: 'Resting after a warning from X',
      text: `${risk.reason}. Xomoni can carry on in ${fmtDuration(risk.resumeAt - now)}, at a slower pace.`,
    };
  }
  const paused = openJobs.find((j) => j.state === 'paused' || j.state === 'blocked' || j.state === 'waiting');
  if (paused) {
    return {
      tone: 'accent',
      title: `“${paused.title}” is paused`,
      text: `${progressOf(paused).trim()} It carries on from where it stopped.`.trim(),
      action: { kind: 'resume', label: 'Resume', jobId: paused.id },
    };
  }
  return {
    tone: 'good',
    title: 'All is well',
    text:
      risk && risk.level > 0
        ? `Nothing is running. Xomoni goes slower for now. ${risk.reason}.`
        : 'Nothing is running, and X has raised no warning.',
  };
}

/** One step of getting started, and whether it is done, under way or still to do. */
export interface StartStep {
  id: 'sign-in' | 'archive' | 'cleanup';
  title: string;
  state: 'done' | 'current' | 'next';
}

/**
 * The steps of getting started (#201), or null once all are done: sign in to X (done, since Home needs an account),
 * get X's archive (under way once asked for), and a first cleanup. The first step not done is the current one.
 */
export function gettingStarted(progress: {
  archiveImported: boolean;
  archiveAsked: boolean;
  hasCleanup: boolean;
}): StartStep[] | null {
  if (progress.archiveImported && progress.hasCleanup) return null;
  const done: Record<StartStep['id'], boolean> = {
    'sign-in': true,
    archive: progress.archiveImported,
    cleanup: progress.hasCleanup,
  };
  const titles: Record<StartStep['id'], string> = {
    'sign-in': 'Sign in to X',
    archive: progress.archiveAsked && !progress.archiveImported ? 'X is making your archive' : 'Get your archive',
    cleanup: 'Your first cleanup',
  };
  let current = false;
  return (['sign-in', 'archive', 'cleanup'] as const).map((id) => {
    if (done[id]) return { id, title: titles[id], state: 'done' };
    const state = current ? 'next' : 'current';
    current = true;
    return { id, title: titles[id], state };
  });
}
