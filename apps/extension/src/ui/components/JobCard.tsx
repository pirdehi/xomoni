import {
  Badge,
  Body1Strong,
  Button,
  Caption1,
  Card,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  ProgressBar,
  Text,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowRedo16Regular,
  CheckmarkCircle16Regular,
  Clock16Regular,
  Delete16Regular,
  Archive20Regular,
  DocumentSearch20Regular,
  ErrorCircle16Regular,
  HourglassHalf16Regular,
  Open16Regular,
  Pause16Regular,
  Play16Regular,
  Prohibited16Regular,
  ShieldCheckmark16Regular,
  ShieldError16Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, useState } from 'react';
import { runner } from '../../engine/platform';
import { workerTab } from '../../engine/worker-tab';
import { db, getSettings } from '../../shared/db';
import { actionFor, estimateDuration } from '../../shared/filter';
import type { JobHealth } from '../../shared/health';
import { RISK_LABELS } from '../../shared/risk';
import type { Job } from '../../shared/types';
import { scaleRule } from '../../shared/x-limits';
import { JOB_STATE, errorMessage, fmtAgo, fmtDuration, fmtFinish, fmtNumber } from '../format';
import { resumeAnyway, startJob, toast, usePace, useRisk, useRunner } from '../hooks';
import { ProgressRing } from './ProgressRing';
import { BADGE_COLOR, useNow } from './ui';

const RESUMABLE = new Set(['queued', 'paused', 'blocked', 'failed']);
const TERMINAL = new Set(['completed', 'cancelled']);

const useStyles = makeStyles({
  card: {
    padding: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalM,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusXLarge,
    boxShadow: tokens.shadow4,
  },
  compact: { padding: tokens.spacingHorizontalM },
  header: { display: 'flex', alignItems: 'flex-start', gap: tokens.spacingHorizontalM },
  kindIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    flexShrink: 0,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground2,
  },
  heading: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalXXS, minWidth: 0, flexGrow: 1 },
  titleRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: tokens.spacingHorizontalS },
  title: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' },
  meta: { color: tokens.colorNeutralForeground3 },
  eta: {
    display: 'inline-flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: tokens.spacingHorizontalXS,
    color: tokens.colorNeutralForeground2,
  },
  controls: { display: 'flex', flexShrink: 0, gap: tokens.spacingHorizontalS },
  chips: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    paddingBlock: tokens.spacingVerticalXXS,
    paddingInline: tokens.spacingHorizontalS,
    borderRadius: tokens.borderRadiusCircular,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    fontVariantNumeric: 'tabular-nums',
    backgroundColor: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground2,
  },
  good: { backgroundColor: tokens.colorStatusSuccessBackground1, color: tokens.colorStatusSuccessForeground1 },
  critical: { backgroundColor: tokens.colorStatusDangerBackground1, color: tokens.colorStatusDangerForeground1 },
  strong: { fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground1 },
  status: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalXS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  attention: {
    backgroundColor: tokens.colorStatusWarningBackground1,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorStatusWarningBorder1}`,
  },
  statusRow: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, minWidth: 0 },
  statusText: {
    flexGrow: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
  },
  /** What X needs from the person is read in full: it says where to type, and that Xomoni never sees it. */
  statusTextFull: { whiteSpace: 'normal', overflow: 'visible', color: tokens.colorNeutralForeground1 },
  noWrap: { flexShrink: 0, whiteSpace: 'nowrap' },
  countdown: {
    flexShrink: 0,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase200,
  },
  reason: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2, margin: 0 },
  reasonCritical: { color: tokens.colorStatusDangerForeground1 },
  health: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusLarge,
    fontSize: tokens.fontSizeBase200,
    backgroundColor: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground2,
  },
  healthWarn: { backgroundColor: tokens.colorStatusWarningBackground1 },
  healthSerious: { backgroundColor: tokens.colorStatusDangerBackground1 },
  healthIcon: { flexShrink: 0, marginTop: '1px', color: tokens.colorStatusSuccessForeground1 },
  healthIconWarn: { color: tokens.colorStatusWarningForeground1 },
  healthIconSerious: { color: tokens.colorStatusDangerForeground1 },
  dialogText: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
  pulse: {
    animationName: { '0%': { opacity: 1 }, '50%': { opacity: 0.45 }, '100%': { opacity: 1 } },
    animationDuration: '1.6s',
    animationIterationCount: 'infinite',
    '@media (prefers-reduced-motion: reduce)': { animationName: 'none' },
  },
});

/**
 * One job with its state, progress, time estimate and controls, drawn with Fluent UI (ADR-0019). Cleanups show a
 * progress ring, the counts as colored chips and when the job should end; scans show how many posts were looked at.
 * While the runner in this tab is executing the job, its live status replaces the stored state, with a countdown
 * while it waits. While the risk ladder holds the account back (a resume lock or a full stop), Resume waits and only
 * a typed "Resume anyway" goes ahead. After a run, it shows the account health report from the end of that run.
 */
export function JobCard({ job, compact = false }: { job: Job; compact?: boolean }) {
  const styles = useStyles();
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
  const pct = job.kind === 'cleanup' && matched > 0 ? Math.min(100, (settled / matched) * 100) : 0;
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
    <Card className={mergeClasses(styles.card, compact && styles.compact)}>
      <div className={styles.header}>
        {job.kind === 'cleanup' ? (
          <ProgressRing value={pct} label={`${fmtNumber(settled)} of ${fmtNumber(matched)} settled`} />
        ) : (
          <div className={styles.kindIcon}>
            {job.kind === 'archive' ? <Archive20Regular /> : <DocumentSearch20Regular />}
          </div>
        )}
        <div className={styles.heading}>
          <div className={styles.titleRow}>
            <Body1Strong className={styles.title}>{job.title}</Body1Strong>
            <Badge
              appearance="tint"
              color={BADGE_COLOR[state.tone]}
              className={active && run.status === 'running' ? styles.pulse : undefined}
              data-status=""
            >
              {state.label}
            </Badge>
          </div>
          <Caption1 className={styles.meta}>
            Created {fmtAgo(job.createdAt, now)}
            {job.phase && ` · phase: ${job.phase}`}
          </Caption1>
          {eta != null && !TERMINAL.has(job.state) && (
            <Caption1 className={styles.eta}>
              <Clock16Regular aria-hidden />
              <span>≈ {fmtDuration(eta)} at the current pace</span>
              <span>· ends {fmtFinish(eta, now)}</span>
            </Caption1>
          )}
        </div>
        <JobControls job={job} active={active} />
      </div>

      {job.kind === 'cleanup' ? (
        <div className={styles.chips}>
          <span className={mergeClasses(styles.chip, done > 0 && styles.good)}>
            <CheckmarkCircle16Regular aria-hidden />
            <span className={styles.strong}>{fmtNumber(done)}</span> removed
          </span>
          <span className={styles.chip}>
            <ArrowRedo16Regular aria-hidden />
            {fmtNumber(skipped)} skipped
            {!!job.stats.unavailable && (
              <Tooltip
                relationship="description"
                content="Reposts and likes of posts X no longer shows: deleted, or from a suspended or protected account"
              >
                <span> ({fmtNumber(job.stats.unavailable)} unavailable on X)</span>
              </Tooltip>
            )}
          </span>
          {failed > 0 && (
            <span className={mergeClasses(styles.chip, styles.critical)} data-tone="critical">
              <ErrorCircle16Regular aria-hidden />
              {fmtNumber(failed)} failed
            </span>
          )}
          <span className={styles.chip}>
            <HourglassHalf16Regular aria-hidden />
            {fmtNumber(remaining)} remaining
          </span>
        </div>
      ) : job.kind === 'archive' ? null : (
        <Caption1>
          <span className={styles.strong}>{fmtNumber(scanned)}</span> posts looked at
        </Caption1>
      )}

      {active && run.message && <LiveStatus now={now} />}
      {!active && job.stateReason && (
        <p
          className={mergeClasses(
            styles.reason,
            (job.state === 'blocked' || job.state === 'failed') && styles.reasonCritical,
          )}
          data-tone={job.state === 'blocked' || job.state === 'failed' ? 'critical' : 'neutral'}
        >
          {job.stateReason}
        </p>
      )}
      {!active && job.health && <HealthNote health={job.health} />}
    </Card>
  );
}

/**
 * The runner's live line for the job it is executing: what it is doing, and while it waits, a countdown with a bar
 * that fills toward the end of the wait. When X needs the person, it offers the way to the X window.
 */
function LiveStatus({ now }: { now: number }) {
  const styles = useStyles();
  const run = useRunner();
  const wait = run.waitUntil ? { until: run.waitUntil, from: run.waitFrom ?? now } : null;
  const attention = run.status === 'attention';
  return (
    <div className={mergeClasses(styles.status, attention && styles.attention)}>
      <div className={styles.statusRow}>
        {attention ? <Warning16Regular aria-hidden /> : <Clock16Regular aria-hidden />}
        <span className={mergeClasses(styles.statusText, attention && styles.statusTextFull)} title={run.message}>
          {run.message}
        </span>
        {wait && <span className={styles.countdown}>{fmtDuration(wait.until - now)}</span>}
        {attention && (
          <Button
            size="small"
            appearance="primary"
            icon={<Open16Regular />}
            className={styles.noWrap}
            onClick={() => void workerTab.focus()}
          >
            Open X window
          </Button>
        )}
      </div>
      {wait && (
        <ProgressBar
          thickness="medium"
          shape="rounded"
          value={Math.min(1, Math.max(0, (now - wait.from) / Math.max(1, wait.until - wait.from)))}
          aria-label="Time left in this wait"
        />
      )}
    </div>
  );
}

/** The account health report from the end of the job's last run (#25): quiet when healthy, colored otherwise. */
function HealthNote({ health }: { health: JobHealth }) {
  const styles = useStyles();
  const healthy = health.level === 0 && !health.notice && Object.keys(health.signals).length === 0;
  const serious = health.level >= 3 || !!health.notice;
  return (
    <div
      role="status"
      className={mergeClasses(styles.health, !healthy && (serious ? styles.healthSerious : styles.healthWarn))}
      data-tone={healthy ? 'good' : serious ? 'critical' : 'warn'}
    >
      {healthy ? (
        <ShieldCheckmark16Regular className={styles.healthIcon} aria-hidden />
      ) : (
        <ShieldError16Regular
          className={mergeClasses(styles.healthIcon, serious ? styles.healthIconSerious : styles.healthIconWarn)}
          aria-hidden
        />
      )}
      <Text size={200}>
        <span className={styles.strong}>Account health: </span>
        {health.summary}
      </Text>
    </div>
  );
}

function JobControls({ job, active }: { job: Job; active: boolean }) {
  const styles = useStyles();
  const run = useRunner();
  const risk = useRisk(job.accountId);
  const now = useNow(1000);
  const [confirming, setConfirming] = useState(false);
  const heldUntil = risk?.resumeAt && risk.resumeAt > now ? risk.resumeAt : null;
  const held = !!risk && (risk.fullStop || heldUntil != null);
  if (active) {
    return (
      <div className={styles.controls}>
        <Button
          size="small"
          icon={<Pause16Regular />}
          onClick={() => runner.pause()}
          disabled={run.status === 'stopping'}
        >
          Pause
        </Button>
        <Button
          size="small"
          appearance="subtle"
          icon={<Prohibited16Regular />}
          onClick={() => runner.cancel()}
          disabled={run.status === 'stopping'}
        >
          Cancel
        </Button>
      </div>
    );
  }
  return (
    <div className={styles.controls}>
      {RESUMABLE.has(job.state) && !held && (
        <Button
          size="small"
          appearance="primary"
          icon={<Play16Regular />}
          onClick={() => void startJob(job.id)}
          disabled={run.status !== 'idle'}
        >
          {job.state === 'queued' ? 'Start' : 'Resume'}
        </Button>
      )}
      {RESUMABLE.has(job.state) && held && (
        <>
          <Button size="small" appearance="primary" icon={<Clock16Regular />} disabled>
            {heldUntil ? `Resume in ${fmtDuration(heldUntil - now)}` : 'Stopped for safety'}
          </Button>
          <Tooltip content="Resume anyway…" relationship="label">
            <Button
              size="small"
              appearance="subtle"
              icon={<ShieldError16Regular />}
              onClick={() => setConfirming(true)}
            />
          </Tooltip>
          {/* Mounted only while open, so the confirmation starts empty every time. */}
          {confirming && (
            <ResumeAnywayDialog
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
          size="small"
          appearance="subtle"
          icon={<Prohibited16Regular />}
          onClick={() => void db.jobs.update(job.id, { state: 'cancelled', finishedAt: Date.now() })}
        >
          Cancel
        </Button>
      )}
      {TERMINAL.has(job.state) && (
        <Button
          size="small"
          appearance="subtle"
          icon={<Delete16Regular />}
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
function ResumeAnywayDialog({
  onClose,
  onConfirm,
  level,
  reason,
  fullStop,
}: {
  onClose: () => void;
  onConfirm: () => void;
  level: keyof typeof RISK_LABELS;
  reason: string;
  fullStop: boolean;
}): ReactNode {
  const styles = useStyles();
  const [typed, setTyped] = useState('');
  return (
    <Dialog open onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{`Risk level ${level}: ${RISK_LABELS[level]}`}</DialogTitle>
          <DialogContent className={styles.dialogText}>
            <Text>
              <span className={styles.strong}>Why Xomoni is holding back:</span> {reason}.
            </Text>
            <Text>
              {fullStop
                ? 'This is a full stop. X has escalated against this account, and continuing now risks a suspension.'
                : 'X is likely watching this account more closely right now. Waiting is the safer choice.'}{' '}
              If you resume anyway, Xomoni runs at a quarter of its usual share for the next 48 hours, and any new
              warning from X stops it again.
            </Text>
            <Field label="Type RESUME to continue at your own risk">
              <Input value={typed} onChange={(_, data) => setTyped(data.value)} autoComplete="off" spellCheck={false} />
            </Field>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>
              Keep waiting
            </Button>
            <Button appearance="primary" disabled={typed.trim() !== 'RESUME'} onClick={onConfirm}>
              Resume anyway
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
