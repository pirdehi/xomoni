'use client';
// The signed-in dashboard on Fluent UI (ADR-0019), in the look of the extension's job card: a status badge, a
// progress bar, counts as colored chips and relative times.
import {
  Badge,
  type BadgeProps,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  MessageBar,
  MessageBarBody,
  ProgressBar,
  type ProgressBarProps,
  Spinner,
  makeStyles,
  mergeClasses,
  tokens,
  typographyStyles,
} from '@fluentui/react-components';
import {
  ArrowRepeatAll16Regular,
  CheckmarkCircle16Regular,
  DataPie16Regular,
  ErrorCircle16Regular,
  Filter16Regular,
  Laptop24Regular,
  PersonAlert20Regular,
  PlugDisconnected20Regular,
  PuzzlePiece20Regular,
  Search16Regular,
  ShieldError20Regular,
  SignOut20Regular,
  Warning16Filled,
} from '@fluentui/react-icons';
import Image from 'next/image';
import { useEffect, useState, type ReactNode } from 'react';
import { INSTALL_URL } from '@/shared/config/site';
import { ButtonLink, TextLink } from '@/shared/ui/links';
import { isOnline, jobProgress, jobStateView, relativeTime, type Tone } from '../domain/job-status';
import type { DashboardSnapshot, Device, JobSummary } from '../domain/model';
import { RISK_LEVEL, accountRisks, jobsNeedingYou, type AccountRisk } from '../domain/risk';
import type { PairingResult } from '../domain/pairing';
import { PairingPanel } from './pairing-panel';
import { useLiveDashboard } from './use-live-dashboard';

/** Who is signed in, as the dashboard header shows them. */
export interface DashboardViewer {
  /** User id; scopes the live feed. */
  id: string;
  /** Account email. */
  email: string;
  /** Display name. */
  name: string;
  /** Profile picture, if any. */
  avatarUrl: string | null;
}

/** Fluent's badge color for each domain tone; `serious` is Fluent's "severe" orange. */
const BADGE_COLOR: Record<Tone, NonNullable<BadgeProps['color']>> = {
  neutral: 'informative',
  accent: 'brand',
  serious: 'severe',
  warn: 'warning',
  critical: 'danger',
  good: 'success',
};

/**
 * The progress bar's color. The badge already names the state, so the bar stays in the brand color unless the job
 * needs the person (Fluent's warning orange), failed or stopped (red), or finished (green).
 */
const BAR_COLOR: Record<Tone, NonNullable<ProgressBarProps['color']>> = {
  neutral: 'brand',
  accent: 'brand',
  serious: 'warning',
  warn: 'brand',
  critical: 'error',
  good: 'success',
};

const WIDE = '@media (min-width: 640px)';

const useStyles = makeStyles({
  root: { display: 'grid', gap: '40px' },
  card: {
    boxSizing: 'border-box',
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadius2XLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
  },
  padded: { padding: tokens.spacingHorizontalXL },
  paddedLarge: { padding: tokens.spacingHorizontalXXL, [WIDE]: { padding: '32px' } },
  list: { margin: 0, padding: 0, listStyleType: 'none' },
  stack: { display: 'grid', gap: tokens.spacingVerticalM },
  divided: {
    padding: tokens.spacingHorizontalL,
    ':not(:last-child)': { borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}` },
  },
  // Inside an already padded card: rows separated top and bottom only.
  flushRow: { paddingLeft: 0, paddingRight: 0, ':first-child': { paddingTop: 0 }, ':last-child': { paddingBottom: 0 } },
  sectionTitle: {
    ...typographyStyles.subtitle1,
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    margin: 0,
    color: tokens.colorNeutralForeground1,
  },
  sectionIntro: {
    margin: `${tokens.spacingVerticalXS} 0 0`,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
  },
  sectionBody: { marginTop: tokens.spacingVerticalL },
  strong: { margin: 0, color: tokens.colorNeutralForeground1, fontWeight: tokens.fontWeightSemibold },
  meta: {
    margin: `${tokens.spacingVerticalXXS} 0 0`,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
  },
  text: {
    margin: `${tokens.spacingVerticalXS} 0 0`,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
  },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' },
  center: { alignItems: 'center' },
  group: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM, minWidth: 0 },
  top: { alignItems: 'flex-start' },
  minW0: { minWidth: 0 },

  avatar: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '44px',
    height: '44px',
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    fontWeight: tokens.fontWeightSemibold,
    objectFit: 'cover',
  },
  name: { ...typographyStyles.title3, margin: 0, color: tokens.colorNeutralForeground1 },
  live: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalSNudge,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase300,
  },
  dot: {
    display: 'inline-block',
    flexShrink: 0,
    width: '8px',
    height: '8px',
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorNeutralForegroundDisabled,
  },
  dotOn: { backgroundColor: tokens.colorStatusSuccessForeground1 },
  signOut: { margin: 0 },

  eyebrow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    margin: 0,
    color: tokens.colorBrandForeground1,
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
  },
  connectTitle: {
    ...typographyStyles.title3,
    margin: `${tokens.spacingVerticalS} 0 0`,
    color: tokens.colorNeutralForeground1,
  },
  connectText: {
    maxWidth: '672px',
    margin: `${tokens.spacingVerticalS} 0 0`,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase400,
    lineHeight: '1.6',
  },
  steps: { display: 'grid', gap: tokens.spacingVerticalL, margin: `${tokens.spacingVerticalXXL} 0 0`, padding: 0 },
  step: { display: 'flex', gap: tokens.spacingHorizontalM },
  stepNumber: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    fontVariantNumeric: 'tabular-nums',
  },
  stepText: { minWidth: 0, color: tokens.colorNeutralForeground2, lineHeight: '1.6' },
  stepLead: { display: 'block', marginBottom: tokens.spacingVerticalM },
  waiting: { marginTop: tokens.spacingVerticalXXL, justifyContent: 'flex-start' },

  needsYou: { borderLeftWidth: '4px', borderLeftColor: tokens.colorStatusWarningBorderActive },
  warningIcon: { color: tokens.colorStatusWarningForeground1, flexShrink: 0 },
  reason: { margin: `${tokens.spacingVerticalXS} 0 0`, color: tokens.colorNeutralForeground1 },

  riskIcon: { flexShrink: 0, marginTop: '2px', color: tokens.colorNeutralForeground3 },
  riskHigh: { color: tokens.colorStatusDangerForeground1 },
  handleMeta: {
    fontWeight: tokens.fontWeightRegular,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },

  job: { padding: tokens.spacingHorizontalXL },
  jobTitle: { ...typographyStyles.subtitle2, margin: 0, color: tokens.colorNeutralForeground1 },
  progress: { marginTop: tokens.spacingVerticalL },
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: tokens.spacingHorizontalS,
    margin: `${tokens.spacingVerticalM} 0 0`,
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    padding: `${tokens.spacingVerticalXXS} ${tokens.spacingHorizontalS}`,
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
  },
  chipSuccess: { backgroundColor: tokens.colorStatusSuccessBackground1, color: tokens.colorStatusSuccessForeground1 },
  chipDanger: { backgroundColor: tokens.colorStatusDangerBackground1, color: tokens.colorStatusDangerForeground1 },
  chipBrand: { backgroundColor: tokens.colorBrandBackground2, color: tokens.colorBrandForeground1 },
  chipTerm: { display: 'inline-flex', alignItems: 'center', gap: tokens.spacingHorizontalXXS },
  chipValue: { margin: 0, fontWeight: tokens.fontWeightSemibold, fontVariantNumeric: 'tabular-nums' },
  phase: {
    margin: `${tokens.spacingVerticalM} 0 0`,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
  },
  alert: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    margin: `${tokens.spacingVerticalM} 0 0`,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorStatusWarningBorder1}`,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorStatusWarningBackground1,
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase300,
  },
  alertIcon: { flexShrink: 0, marginTop: '2px', color: tokens.colorStatusWarningForeground1 },

  deviceIcon: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    borderRadius: tokens.borderRadiusXLarge,
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground2,
    fontSize: '24px',
  },
  status: { display: 'inline-flex', alignItems: 'center', gap: tokens.spacingHorizontalXS },
  online: { color: tokens.colorStatusSuccessForeground1 },
  pairing: { marginTop: tokens.spacingVerticalL },
  danger: {
    backgroundColor: tokens.colorStatusDangerBackground3,
    color: tokens.colorNeutralForegroundOnBrand,
    ':hover': { backgroundColor: tokens.colorStatusDangerForeground1, color: tokens.colorNeutralForegroundOnBrand },
    ':hover:active': {
      backgroundColor: tokens.colorStatusDangerForeground1,
      color: tokens.colorNeutralForegroundOnBrand,
    },
  },
  dialogError: { marginTop: tokens.spacingVerticalM },
});

/**
 * The signed-in dashboard: account bar, jobs that need the person, each X account's risk level, live jobs and
 * connected browsers. It shows; it never starts, resumes or changes a job (ADR-0006).
 */
export function Dashboard({ viewer, initial }: { viewer: DashboardViewer; initial: DashboardSnapshot }) {
  const s = useStyles();
  const { devices, jobs, live, disconnect, createPairingCode } = useLiveDashboard(viewer.id, initial);
  const now = useNow(30_000);
  const [leaving, setLeaving] = useState<Device | null>(null);

  const deviceName = new Map(devices.map((d) => [d.id, d.name]));
  const needsYou = jobsNeedingYou(jobs);
  const risks = accountRisks(jobs);

  return (
    <div className={s.root}>
      <AccountBar viewer={viewer} live={live} />

      {needsYou.length > 0 && <NeedsYou jobs={needsYou} deviceName={deviceName} />}
      {risks.length > 0 && <AccountRisks risks={risks} deviceName={deviceName} now={now} />}

      {devices.length === 0 ? (
        <ConnectBrowser createCode={createPairingCode} />
      ) : (
        <section aria-labelledby="jobs-title">
          <h2 id="jobs-title" className={s.sectionTitle}>
            Jobs
          </h2>
          {jobs.length === 0 ? (
            <p className={mergeClasses(s.card, s.padded, s.sectionBody, s.text)}>
              No jobs yet. Start a cleanup or a scan in the extension and it shows up here as it runs.
            </p>
          ) : (
            <ul className={mergeClasses(s.list, s.stack, s.sectionBody)}>
              {jobs.map((job) => (
                <JobRow key={job.id} job={job} device={deviceName.get(job.deviceId)} now={now} />
              ))}
            </ul>
          )}
        </section>
      )}

      {devices.length > 0 && (
        <section aria-labelledby="devices-title">
          <h2 id="devices-title" className={s.sectionTitle}>
            Connected browsers
          </h2>
          <ul className={mergeClasses(s.card, s.list, s.sectionBody)}>
            {devices.map((device) => {
              const online = isOnline(device, now);
              return (
                <li key={device.id} className={mergeClasses(s.divided, s.row, s.center)}>
                  <div className={s.group}>
                    <span className={s.deviceIcon} aria-hidden>
                      <Laptop24Regular />
                    </span>
                    <div className={s.minW0}>
                      <p className={s.strong}>{device.name}</p>
                      <p className={s.meta}>
                        <span className={mergeClasses(s.status, online && s.online)}>
                          <span className={mergeClasses(s.dot, online && s.dotOn)} aria-hidden />
                          {online ? 'Online' : `Last seen ${relativeTime(device.lastSeenAt, now)}`}
                        </span>{' '}
                        · Extension v{device.extensionVersion}
                      </p>
                    </div>
                  </div>
                  <Button size="small" icon={<PlugDisconnected20Regular />} onClick={() => setLeaving(device)}>
                    Disconnect
                  </Button>
                </li>
              );
            })}
          </ul>
          <div className={s.pairing}>
            <PairingPanel createCode={createPairingCode} />
          </div>
        </section>
      )}

      <DisconnectDialog device={leaving} onClose={() => setLeaving(null)} disconnect={disconnect} />
    </div>
  );
}

/**
 * Confirms disconnecting a browser. On failure it stays open with the reason, and the browser stays listed; the
 * name is kept while the dialog closes, so its title doesn't empty mid-animation.
 */
function DisconnectDialog({
  device,
  onClose,
  disconnect,
}: {
  device: Device | null;
  onClose: () => void;
  disconnect: (device: Device) => Promise<string | null>;
}) {
  const s = useStyles();
  const [shown, setShown] = useState<Device | null>(device);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (device && device !== shown) setShown(device);

  function close() {
    setError(null);
    onClose();
  }

  async function confirm() {
    if (!device) return;
    setPending(true);
    setError(null);
    const failure = await disconnect(device);
    setPending(false);
    if (failure) setError(failure);
    else close();
  }

  return (
    <Dialog modalType="alert" open={device !== null} onOpenChange={(_, data) => !data.open && !pending && close()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Disconnect “{shown?.name}”?</DialogTitle>
          <DialogContent>
            Its job history on this page is removed too. Nothing on X changes.
            {error && (
              <div role="alert" className={s.dialogError}>
                <MessageBar intent="error">
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              </div>
            )}
          </DialogContent>
          <DialogActions>
            <Button disabled={pending} onClick={close}>
              Cancel
            </Button>
            <Button
              appearance="primary"
              className={pending ? undefined : s.danger}
              disabled={pending}
              icon={pending ? <Spinner size="extra-tiny" /> : <PlugDisconnected20Regular />}
              onClick={() => void confirm()}
            >
              Disconnect
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function AccountBar({ viewer, live }: { viewer: DashboardViewer; live: boolean }) {
  const s = useStyles();
  return (
    <div className={mergeClasses(s.row, s.center)}>
      <div className={s.group}>
        {viewer.avatarUrl ? (
          // Google profile pictures, loaded as they are (no optimizer) with the referrer off.
          <Image
            src={viewer.avatarUrl}
            alt=""
            width={44}
            height={44}
            unoptimized
            referrerPolicy="no-referrer"
            className={s.avatar}
          />
        ) : (
          <span className={s.avatar}>{(viewer.name || viewer.email).slice(0, 1).toUpperCase()}</span>
        )}
        <div className={s.minW0}>
          <h1 className={s.name}>{viewer.name}</h1>
          <p className={s.meta}>{viewer.email}</p>
        </div>
      </div>
      <div className={s.group}>
        <span className={s.live} title="Updates appear as they happen" data-live={live}>
          <span className={mergeClasses(s.dot, live && s.dotOn)} aria-hidden />
          {live ? 'Live' : 'Connecting…'}
        </span>
        <ButtonLink href="/account">Account</ButtonLink>
        <form action="/auth/signout" method="post" className={s.signOut}>
          <Button type="submit" icon={<SignOut20Regular />}>
            Sign out
          </Button>
        </form>
      </div>
    </div>
  );
}

function ConnectBrowser({ createCode }: { createCode: () => Promise<PairingResult> }) {
  const s = useStyles();
  return (
    <section className={mergeClasses(s.card, s.paddedLarge)} aria-labelledby="connect-title">
      <p className={s.eyebrow}>
        <PuzzlePiece20Regular aria-hidden />
        One more step
      </p>
      <h2 id="connect-title" className={s.connectTitle}>
        Connect your browser
      </h2>
      <p className={s.connectText}>
        Cleanups run in the Xomoni extension on your computer. Connect it to this account and its jobs appear here live.
        The extension only reports status: what it is doing, never what you posted.
      </p>
      <ol className={s.steps}>
        <Step n={1}>
          <TextLink href={INSTALL_URL}>Install the Xomoni extension</TextLink> in Chrome, Edge or Brave on your
          computer.
        </Step>
        <Step n={2}>
          <span className={s.stepLead}>
            Get a one-time code, then type it in the extension under{' '}
            <strong className={s.strong}>Settings → xomoni.com</strong>.
          </span>
          <PairingPanel createCode={createCode} />
        </Step>
        <Step n={3}>This page updates by itself as soon as your browser connects.</Step>
      </ol>
      <Spinner className={s.waiting} size="extra-tiny" labelPosition="after" label="Waiting for your browser…" />
    </section>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  const s = useStyles();
  return (
    <li className={s.step}>
      <span className={s.stepNumber} aria-hidden>
        {n}
      </span>
      <span className={s.stepText}>{children}</span>
    </li>
  );
}

/** Jobs waiting for something only the person can do; first on the page. */
function NeedsYou({ jobs, deviceName }: { jobs: JobSummary[]; deviceName: Map<string, string> }) {
  const s = useStyles();
  return (
    <section aria-labelledby="needs-you-title" className={mergeClasses(s.card, s.padded, s.needsYou)}>
      <h2 id="needs-you-title" className={s.sectionTitle}>
        <PersonAlert20Regular className={s.warningIcon} aria-hidden />
        Needs you
      </h2>
      <p className={s.sectionIntro}>
        Finish these steps in the Xomoni window on that computer; the job goes on by itself afterwards. This page can’t
        continue a job for you.
      </p>
      <ul className={mergeClasses(s.list, s.sectionBody)}>
        {jobs.map((job) => {
          const device = deviceName.get(job.deviceId);
          return (
            <li key={job.id} className={mergeClasses(s.divided, s.flushRow)}>
              <p className={s.strong}>{job.title}</p>
              <p className={s.meta}>
                @{job.xHandle}
                {device && ` · ${device}`}
              </p>
              {/* The reason stays in the browser (#149); the phase is Xomoni's own words for what it waits on. */}
              {(job.stateReason || job.phase) && <p className={s.reason}>{job.stateReason || job.phase}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Each X account's risk level on each browser, worst first, with what the level means. */
function AccountRisks({
  risks,
  deviceName,
  now,
}: {
  risks: AccountRisk[];
  deviceName: Map<string, string>;
  now: number;
}) {
  const s = useStyles();
  return (
    <section aria-labelledby="accounts-title">
      <h2 id="accounts-title" className={s.sectionTitle}>
        X accounts
      </h2>
      <p className={s.sectionIntro}>
        How hard X has pushed back lately, as each browser’s extension reported it. Xomoni slows down on its own as the
        level rises.
      </p>
      <ul className={mergeClasses(s.card, s.list, s.sectionBody)}>
        {risks.map((risk) => {
          const level = RISK_LEVEL[risk.level];
          const device = deviceName.get(risk.deviceId);
          return (
            <li key={`${risk.deviceId}-${risk.xHandle}`} className={mergeClasses(s.divided, s.row)}>
              <div className={mergeClasses(s.group, s.top)}>
                <ShieldError20Regular className={mergeClasses(s.riskIcon, risk.level >= 3 && s.riskHigh)} aria-hidden />
                <div className={s.minW0}>
                  <p className={s.strong}>
                    @{risk.xHandle}
                    <span className={s.handleMeta}>
                      {device && ` · ${device}`} · reported {relativeTime(risk.reportedAt, now)}
                    </span>
                  </p>
                  <p className={s.text}>{level.meaning}</p>
                </div>
              </div>
              <Badge appearance="tint" shape="rounded" color={BADGE_COLOR[level.tone]} data-tone={level.tone}>
                Risk level {risk.level}: {level.label}
              </Badge>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function JobRow({ job, device, now }: { job: JobSummary; device: string | undefined; now: number }) {
  const s = useStyles();
  const state = jobStateView(job.state);
  const pct = jobProgress(job);
  const waiting = job.state === 'waiting';

  return (
    <li className={mergeClasses(s.card, s.job)} data-state={job.state}>
      <div className={s.row}>
        <div className={s.minW0}>
          <p className={s.jobTitle}>{job.title}</p>
          <p className={s.meta}>
            @{job.xHandle}
            {device && ` · ${device}`} · updated {relativeTime(job.updatedAt, now)}
          </p>
        </div>
        <Badge appearance="tint" shape="rounded" color={BADGE_COLOR[state.tone]} data-tone={state.tone}>
          {state.label}
        </Badge>
      </div>

      {pct !== null && (
        <ProgressBar
          className={s.progress}
          thickness="large"
          shape="rounded"
          value={pct}
          max={100}
          color={BAR_COLOR[state.tone]}
          aria-label="Progress"
        />
      )}

      <dl className={s.chips}>
        {job.kind === 'scan' ? (
          <Count icon={<Search16Regular />} label="Scanned" value={job.scanned} tone="brand" />
        ) : (
          <>
            <Count
              icon={<CheckmarkCircle16Regular />}
              label={job.title.toLowerCase().includes('like') ? 'Removed' : 'Deleted'}
              value={job.done}
              tone="success"
            />
            <Count icon={<Filter16Regular />} label="Matched" value={job.matched} />
            <Count icon={<ArrowRepeatAll16Regular />} label="Skipped" value={job.skipped} />
            {job.failed > 0 && (
              <Count icon={<ErrorCircle16Regular />} label="Failed" value={job.failed} tone="danger" />
            )}
          </>
        )}
        {pct !== null && <Count icon={<DataPie16Regular />} label="Progress" value={`${pct}%`} tone="brand" />}
      </dl>

      {(job.stateReason || job.phase) &&
        (waiting ? (
          <p className={s.alert} role="alert">
            <Warning16Filled className={s.alertIcon} aria-hidden />
            {job.stateReason || job.phase}
          </p>
        ) : (
          <p className={s.phase}>{job.stateReason || job.phase}</p>
        ))}
    </li>
  );
}

function Count({
  icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: ReactNode;
  label: string;
  value: number | string;
  tone?: 'neutral' | 'success' | 'danger' | 'brand';
}) {
  const s = useStyles();
  const toneClass = { neutral: undefined, success: s.chipSuccess, danger: s.chipDanger, brand: s.chipBrand }[tone];
  return (
    <div className={mergeClasses(s.chip, toneClass)} data-tone={tone}>
      <dt className={s.chipTerm}>
        <span aria-hidden>{icon}</span>
        {label}
      </dt>
      <dd className={s.chipValue}>{typeof value === 'number' ? value.toLocaleString('en-US') : value}</dd>
    </div>
  );
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
