import { useLiveQuery } from 'dexie-react-hooks';
import { Ban, Clock, Play, Pause, ScanSearch, Sparkles, Trash2 } from 'lucide-react';
import { runner } from '../../engine/runner';
import { workerTab } from '../../engine/worker-tab';
import { db, getSettings } from '../../shared/db';
import { actionFor, estimateDuration } from '../../shared/filter';
import type { Job } from '../../shared/types';
import { JOB_STATE, fmtAgo, fmtDuration, fmtNumber } from '../format';
import { startJob, useRunner } from '../hooks';
import { Badge, Button, cx, useNow } from './ui';

const RESUMABLE = new Set(['queued', 'paused', 'blocked', 'failed']);
const TERMINAL = new Set(['completed', 'cancelled']);

/**
 * One job with its state, progress, time estimate and controls. While the runner in this tab is
 * executing the job, its live status replaces the stored state. Resume is offered at once for
 * `blocked` (stopped for safety) and `failed` jobs.
 */
export function JobCard({ job, compact = false }: { job: Job; compact?: boolean }) {
  const run = useRunner();
  const now = useNow(1000);
  const active = run.jobId === job.id && run.status !== 'idle';
  const settings = useLiveQuery(getSettings, []);
  const state = !active
    ? JOB_STATE[job.state]
    : run.status === 'attention'
      ? JOB_STATE.waiting
      : { label: run.status === 'waiting' ? 'Waiting' : run.status === 'stopping' ? 'Stopping' : 'Running', tone: 'accent' as const };

  const { matched, done, skipped, failed, scanned } = job.stats;
  const settled = done + skipped + failed;
  const pct = job.kind === 'cleanup' && matched > 0 ? Math.min(100, (settled / matched) * 100) : null;
  const remaining = Math.max(0, matched - settled);
  const eta =
    job.kind === 'cleanup' && job.filter && settings && remaining > 0
      ? estimateDuration(remaining, settings.pacing[actionFor(job.filter.target, job.options?.ghostLikes)])
      : null;

  return (
    <div className={cx('rounded-xl border border-line bg-surface', compact ? 'p-4' : 'p-5')}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-2">
            {job.kind === 'scan' ? <ScanSearch size={15} /> : <Sparkles size={15} />}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold">{job.title}</span>
              <Badge tone={state.tone}>{state.label}</Badge>
            </div>
            <div className="mt-0.5 text-xs text-muted">
              Created {fmtAgo(job.createdAt, now)}
              {job.phase && ` · phase: ${job.phase}`}
            </div>
          </div>
        </div>
        <JobControls job={job} active={active} />
      </div>

      {job.kind === 'cleanup' ? (
        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-accent-soft">
            <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct ?? 0}%` }} />
          </div>
          <div className="tabular mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
            <span>
              <span className="font-semibold text-ink">{fmtNumber(done)}</span> removed
            </span>
            <span>{fmtNumber(skipped)} skipped</span>
            {failed > 0 && <span className="text-critical">{fmtNumber(failed)} failed</span>}
            <span>{fmtNumber(remaining)} remaining</span>
            {eta != null && !TERMINAL.has(job.state) && (
              <span className="inline-flex items-center gap-1">
                <Clock size={11} /> ≈ {fmtDuration(eta)} at your pacing
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="tabular mt-3 text-xs text-ink-2">
          <span className="font-semibold text-ink">{fmtNumber(scanned)}</span> posts looked at
        </div>
      )}

      {active && run.message && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-2">
          <span className="truncate">{run.message}</span>
          {run.waitUntil && <span className="tabular shrink-0 font-medium text-ink">{fmtDuration(run.waitUntil - now)}</span>}
          {run.status === 'attention' && (
            <button type="button" className="shrink-0 font-medium text-accent hover:underline" onClick={() => void workerTab.focus()}>
              Open X window
            </button>
          )}
        </div>
      )}
      {!active && job.stateReason && job.state !== 'completed' && (
        <p className={cx('mt-3 text-xs', job.state === 'blocked' || job.state === 'failed' ? 'text-critical' : 'text-ink-2')}>{job.stateReason}</p>
      )}
    </div>
  );
}

function JobControls({ job, active }: { job: Job; active: boolean }) {
  const run = useRunner();
  if (active) {
    return (
      <div className="flex shrink-0 gap-2">
        <Button size="sm" icon={<Pause size={13} />} onClick={() => runner.pause()} disabled={run.status === 'stopping'}>
          Pause
        </Button>
        <Button size="sm" variant="ghost" icon={<Ban size={13} />} onClick={() => runner.cancel()} disabled={run.status === 'stopping'}>
          Cancel
        </Button>
      </div>
    );
  }
  return (
    <div className="flex shrink-0 gap-2">
      {RESUMABLE.has(job.state) && (
        <Button size="sm" variant="primary" icon={<Play size={13} />} onClick={() => startJob(job.id)} disabled={run.status !== 'idle'}>
          {job.state === 'queued' ? 'Start' : 'Resume'}
        </Button>
      )}
      {!TERMINAL.has(job.state) && job.state !== 'running' && job.state !== 'waiting' && (
        <Button size="sm" variant="ghost" icon={<Ban size={13} />} onClick={() => db.jobs.update(job.id, { state: 'cancelled', finishedAt: Date.now() })}>
          Cancel
        </Button>
      )}
      {TERMINAL.has(job.state) && (
        <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => db.jobs.delete(job.id)} title="Remove from the list (the activity log is kept)">
          Remove
        </Button>
      )}
    </div>
  );
}
