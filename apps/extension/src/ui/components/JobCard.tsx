import { useLiveQuery } from 'dexie-react-hooks';
import { Ban, Clock, Play, Pause, ScanSearch, ShieldAlert, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { runner } from '../../engine/runner';
import { workerTab } from '../../engine/worker-tab';
import { db, getSettings } from '../../shared/db';
import { actionFor, estimateDuration } from '../../shared/filter';
import type { JobHealth } from '../../shared/health';
import type { Job } from '../../shared/types';
import { JOB_STATE, errorMessage, fmtAgo, fmtDuration, fmtNumber } from '../format';
import { resumeAnyway, startJob, toast, usePace, useRisk, useRunner } from '../hooks';
import { scaleRule } from '../../shared/x-limits';
import { RISK_LABELS } from '../../shared/risk';
import { Badge, Button, Modal, cx, useNow } from './ui';

const RESUMABLE = new Set(['queued', 'paused', 'blocked', 'failed']);
const TERMINAL = new Set(['completed', 'cancelled']);

/**
 * One job with its state, progress, time estimate and controls. While the runner in this tab is
 * executing the job, its live status replaces the stored state. While the risk ladder holds the account back
 * (a resume lock or a full stop), Resume waits and only a typed "Resume anyway" goes ahead. After a run, it
 * shows the account health report from the end of that run.
 */
export function JobCard({ job, compact = false }: { job: Job; compact?: boolean }) {
  const run = useRunner();
  const now = useNow(1000);
  const active = run.jobId === job.id && run.status !== 'idle';
  const settings = useLiveQuery(getSettings, []);
  const pace = usePace(job.accountId);
  // A finished job with a note (such as posts Xomoni couldn't see) is not reported as all clear.
  const finishedWithNote = job.state === 'completed' && !!job.stateReason;
  const state = !active
    ? finishedWithNote
      ? { label: 'Finished with a warning', tone: 'warn' as const }
      : JOB_STATE[job.state]
    : run.status === 'attention'
      ? JOB_STATE.waiting
      : {
          label: run.status === 'waiting' ? 'Waiting' : run.status === 'stopping' ? 'Stopping' : 'Running',
          tone: 'accent' as const,
        };

  const { matched, done, skipped, failed, scanned } = job.stats;
  const settled = done + skipped + failed;
  const pct = job.kind === 'cleanup' && matched > 0 ? Math.min(100, (settled / matched) * 100) : null;
  const remaining = Math.max(0, matched - settled);
  const eta =
    job.kind === 'cleanup' && job.filter && settings && remaining > 0
      ? estimateDuration(
          remaining,
          // At the pace a run would use now: warm-up and the risk ladder slow it down.
          scaleRule(settings.pacing[actionFor(job.filter.target, job.options?.ghostLikes)], pace?.factor ?? 1),
        )
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
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${pct ?? 0}%` }}
            />
          </div>
          <div className="tabular mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
            <span>
              <span className="font-semibold text-ink">{fmtNumber(done)}</span> removed
            </span>
            <span>
              {fmtNumber(skipped)} skipped
              {!!job.stats.unavailable && (
                <span title="Reposts and likes of posts X no longer shows: deleted, or from a suspended or protected account">
                  {' '}
                  ({fmtNumber(job.stats.unavailable)} unavailable on X)
                </span>
              )}
            </span>
            {failed > 0 && <span className="text-critical">{fmtNumber(failed)} failed</span>}
            <span>{fmtNumber(remaining)} remaining</span>
            {eta != null && !TERMINAL.has(job.state) && (
              <span className="inline-flex items-center gap-1">
                <Clock size={11} /> ≈ {fmtDuration(eta)} at the current pace
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
          {run.waitUntil && (
            <span className="tabular shrink-0 font-medium text-ink">{fmtDuration(run.waitUntil - now)}</span>
          )}
          {run.status === 'attention' && (
            <button
              type="button"
              className="shrink-0 font-medium text-accent hover:underline"
              onClick={() => void workerTab.focus()}
            >
              Open X window
            </button>
          )}
        </div>
      )}
      {!active && job.stateReason && (
        <p
          className={cx(
            'mt-3 text-xs',
            job.state === 'blocked' || job.state === 'failed' ? 'text-critical' : 'text-ink-2',
          )}
        >
          {job.stateReason}
        </p>
      )}
      {!active && job.health && <HealthNote health={job.health} />}
    </div>
  );
}

/** The account health report from the end of the job's last run (#25): quiet when healthy, colored otherwise. */
function HealthNote({ health }: { health: JobHealth }) {
  const healthy = health.level === 0 && !health.notice && Object.keys(health.signals).length === 0;
  const serious = health.level >= 3 || !!health.notice;
  return (
    <div
      role="status"
      className={cx(
        'mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
        healthy
          ? 'border-line bg-surface-2'
          : serious
            ? 'border-critical/40 bg-critical/10'
            : 'border-warn/40 bg-warn/10',
      )}
    >
      {healthy ? (
        <ShieldCheck size={14} className="mt-px shrink-0 text-good" aria-hidden />
      ) : (
        <ShieldAlert size={14} className={cx('mt-px shrink-0', serious ? 'text-critical' : 'text-warn')} aria-hidden />
      )}
      <p className="text-ink-2">
        <span className="font-medium text-ink">Account health: </span>
        {health.summary}
      </p>
    </div>
  );
}

function JobControls({ job, active }: { job: Job; active: boolean }) {
  const run = useRunner();
  const risk = useRisk(job.accountId);
  const now = useNow(1000);
  const [confirming, setConfirming] = useState(false);
  const heldUntil = risk?.resumeAt && risk.resumeAt > now ? risk.resumeAt : null;
  const held = !!risk && (risk.fullStop || heldUntil != null);
  if (active) {
    return (
      <div className="flex shrink-0 gap-2">
        <Button
          size="sm"
          icon={<Pause size={13} />}
          onClick={() => runner.pause()}
          disabled={run.status === 'stopping'}
        >
          Pause
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Ban size={13} />}
          onClick={() => runner.cancel()}
          disabled={run.status === 'stopping'}
        >
          Cancel
        </Button>
      </div>
    );
  }
  return (
    <div className="flex shrink-0 gap-2">
      {RESUMABLE.has(job.state) && !held && (
        <Button
          size="sm"
          variant="primary"
          icon={<Play size={13} />}
          onClick={() => void startJob(job.id)}
          disabled={run.status !== 'idle'}
        >
          {job.state === 'queued' ? 'Start' : 'Resume'}
        </Button>
      )}
      {RESUMABLE.has(job.state) && held && (
        <>
          <Button size="sm" variant="primary" icon={<Clock size={13} />} disabled>
            {heldUntil ? `Resume in ${fmtDuration(heldUntil - now)}` : 'Stopped for safety'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<ShieldAlert size={14} />}
            onClick={() => setConfirming(true)}
            aria-label="Resume anyway…"
            title="Resume anyway…"
          />
          {/* Mounted only while open, so the confirmation starts empty every time. */}
          {confirming && (
            <ResumeAnywayModal
              open
              onClose={() => setConfirming(false)}
              onConfirm={() => {
                setConfirming(false);
                resumeAnyway(job.id, job.accountId).catch((err: unknown) => toast(errorMessage(err), 'critical'));
              }}
              level={risk.level}
              reason={risk.reason}
              fullStop={risk.fullStop}
            />
          )}
        </>
      )}
      {!TERMINAL.has(job.state) && job.state !== 'running' && job.state !== 'waiting' && (
        <Button
          size="sm"
          variant="ghost"
          icon={<Ban size={13} />}
          onClick={() => void db.jobs.update(job.id, { state: 'cancelled', finishedAt: Date.now() })}
        >
          Cancel
        </Button>
      )}
      {TERMINAL.has(job.state) && (
        <Button
          size="sm"
          variant="ghost"
          icon={<Trash2 size={13} />}
          onClick={() => void db.jobs.delete(job.id)}
          title="Remove from the list (the activity log is kept)"
        >
          Remove
        </Button>
      )}
    </div>
  );
}

/**
 * Asks the person to type RESUME before going past the risk ladder. Going ahead records an `override` event;
 * the pace then stays at a quarter of Xomoni's share for 48 hours.
 */
function ResumeAnywayModal({
  open,
  onClose,
  onConfirm,
  level,
  reason,
  fullStop,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  level: keyof typeof RISK_LABELS;
  reason: string;
  fullStop: boolean;
}) {
  const [typed, setTyped] = useState('');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Risk level ${level}: ${RISK_LABELS[level]}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep waiting
          </Button>
          <Button variant="danger" disabled={typed.trim() !== 'RESUME'} onClick={onConfirm}>
            Resume anyway
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-ink-2">
        <p>
          <span className="font-medium text-ink">Why Xomoni is holding back:</span> {reason}.
        </p>
        <p>
          {fullStop
            ? 'This is a full stop. X has escalated against this account, and continuing now risks a suspension.'
            : 'X is likely watching this account more closely right now. Waiting is the safer choice.'}{' '}
          If you resume anyway, Xomoni runs at a quarter of its usual share for the next 48 hours, and any new warning
          from X stops it again.
        </p>
        <label className="block">
          <span className="text-xs text-muted">Type RESUME to continue at your own risk</span>
          <input
            className="field mt-1"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </div>
    </Modal>
  );
}
