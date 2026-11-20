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
  Switch,
  makeStyles,
  mergeClasses,
  tokens,
  typographyStyles,
} from '@fluentui/react-components';
import {
  ArrowRepeatAll16Regular,
  CheckmarkCircle16Regular,
  ErrorCircle16Regular,
  HourglassHalf16Regular,
  Laptop24Regular,
  PersonAlert20Regular,
  PlugDisconnected20Regular,
  PuzzlePiece20Regular,
  Search16Regular,
  ShieldError20Regular,
  Warning16Filled,
} from '@fluentui/react-icons';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { INSTALL_URL } from '@/shared/config/site';
import { TextLink } from '@/shared/ui/links';
import { isOnline, jobProgress, jobRemaining, jobStateView, relativeTime, type Tone } from '../domain/job-status';
import {
  type Figure,
  daysBefore,
  daysInScope,
  followersSeries,
  isoDay,
  overviewFigures,
  publishedSeries,
} from '../domain/insights';
import type { DailyNumbers, DashboardSnapshot, Device, JobSummary } from '../domain/model';
import { PERIODS, type Scope, accountsIn, jobsInScope, removedIn, scopeQuery } from '../domain/scope';
import { Audience } from './audience';
import { Content } from './content';
import { Engagement } from './engagement';
import { ColumnChart, LineChart, formatCount } from './charts';
import { Delta } from './delta';
import { HealthPlace, LibraryPlace, WatchPlace } from './xomoni-places';
import { SettingsPlace } from './settings-place';
import { CleanupPlace } from './cleanup-place';
import { CommentsPlace } from './comments-place';
import { type Section, sectionHref, xomoniPageFor } from '../domain/sections';
import { RISK_LEVEL, accountRisks, jobsNeedingYou, type AccountRisk } from '../domain/risk';
import type { PairingResult } from '../domain/pairing';
import { useExtensionLink } from '@/modules/extension/ui/extension-session-sync';
import { OpenInXomoni, XomoniJobActions, type XomoniControls, useXomoni } from '@/modules/extension/ui/xomoni-actions';
import { PendingConnectNotice } from './connect-panel';
import { DashboardFrame, useScope } from './dashboard-frame';
import { PairingPanel } from './pairing-panel';
import { SectionPreview } from './section-preview';
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

  tiles: {
    display: 'grid',
    gap: tokens.spacingHorizontalM,
    margin: 0,
    padding: 0,
    listStyleType: 'none',
    // Set only inside the queries: see the frame's note on shared atomic classes (#245).
    '@media (max-width: 767.98px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
    '@media (min-width: 768px)': { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
  },
  tile: { padding: tokens.spacingHorizontalL },
  tileLabel: { ...typographyStyles.caption1Strong, margin: 0, color: tokens.colorNeutralForeground3 },
  tileValue: {
    ...typographyStyles.title2,
    margin: `${tokens.spacingVerticalXS} 0 0`,
    color: tokens.colorNeutralForeground1,
  },
  numbersNote: { marginTop: tokens.spacingVerticalS },
  charts: {
    display: 'grid',
    gap: tokens.spacingHorizontalM,
    marginTop: tokens.spacingVerticalM,
    gridTemplateColumns: 'minmax(0, 1fr)',
    '@media (min-width: 900px)': { gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' },
  },
  chartCard: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalS,
    padding: tokens.spacingHorizontalL,
  },
  chartTitle: { ...typographyStyles.subtitle2, margin: 0 },
  numbersChoice: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalS,
    marginTop: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalL,
  },
  setup: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: tokens.spacingHorizontalL },
  setupIcon: {
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    width: '40px',
    height: '40px',
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
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
  progressRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    marginTop: tokens.spacingVerticalL,
  },
  progress: { flexGrow: 1 },
  progressText: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    fontVariantNumeric: 'tabular-nums',
    minWidth: '3ch',
    textAlign: 'end',
  },
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
  // A browser that has just connected: its icon turns green and rings for a moment (#182).
  deviceIconNew: {
    backgroundColor: tokens.colorPaletteGreenBackground2,
    color: tokens.colorPaletteGreenForeground1,
    animationName: {
      '0%': { boxShadow: `0 0 0 0 ${tokens.colorPaletteGreenBorderActive}` },
      '100%': { boxShadow: '0 0 0 12px transparent' },
    },
    animationDuration: '1.4s',
    animationIterationCount: 3,
    '@media (prefers-reduced-motion: reduce)': { animationName: 'none' },
  },
  nameRow: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
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
 * Ids of the browsers that connected while this page was open, kept for `ms` so the list can say "Just connected".
 * The browsers the page started with are never new.
 */
export function useJustConnected(devices: readonly Device[], ms = 20_000): ReadonlySet<string> {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(devices.map((device) => device.id));
      return;
    }
    const known = seen.current;
    const arrived = devices.map((device) => device.id).filter((id) => !known.has(id));
    if (!arrived.length) return;
    arrived.forEach((id) => known.add(id));
    setFresh((before) => new Set([...before, ...arrived]));
    const timer = setTimeout(() => {
      setFresh((before) => new Set([...before].filter((id) => !arrived.includes(id))));
    }, ms);
    return () => clearTimeout(timer);
  }, [devices, ms]);
  return fresh;
}

/**
 * The signed-in dashboard: account bar, jobs that need the person, each X account's risk level, live jobs and
 * connected browsers. It shows; it never starts, resumes or changes a job (ADR-0006).
 */
export function Dashboard({
  viewer,
  initial,
  section,
}: {
  viewer: DashboardViewer;
  initial: DashboardSnapshot;
  /** The place shown; places not built yet show what they will hold. */
  section: Section;
}) {
  const s = useStyles();
  const { devices, jobs, days, live, disconnect, createPairingCode, numbersShown, showNumbers } = useLiveDashboard(
    viewer.id,
    initial,
  );
  const now = useNow(30_000);
  const justConnected = useJustConnected(devices);
  const [leaving, setLeaving] = useState<Device | null>(null);
  const [scope] = useScope();
  // The browser this page runs in, when its Xomoni is signed in here (#232): signing out disconnects it, since
  // xomoni.com would sign a disconnected browser straight back in.
  const link = useExtensionLink();
  const here = link.status === 'signed-in' ? link.deviceId : null;
  // Xomoni's actions from this page (ADR-0027, #251): sent to Xomoni in this browser, or one dialog saying why not.
  const xomoni = useXomoni(devices.map((d) => d.id));

  const deviceName = new Map(devices.map((d) => [d.id, d.name]));
  // What needs the person is shown whatever the period: a job waiting now matters even if it began long ago.
  const onAccount = jobsInScope(jobs, { ...scope, period: 'all' }, now);
  const inPeriod = jobsInScope(jobs, scope, now);
  const needsYou = jobsNeedingYou(onAccount);
  const risks = accountRisks(onAccount);
  const query = scopeQuery(scope);

  let content: ReactNode;
  if (section.id === 'overview') {
    content = (
      <>
        <PendingConnectNotice />
        {devices.length === 0 && <SetupBar />}
        {needsYou.length > 0 && <NeedsYou jobs={needsYou} deviceName={deviceName} />}
        {risks.length > 0 && <AccountRisks risks={risks} deviceName={deviceName} now={now} />}
        <Numbers
          removed={removedIn(inPeriod)}
          days={days}
          scope={scope}
          now={now}
          shown={numbersShown}
          onShow={showNumbers}
        />
        <section aria-labelledby="recent-title">
          <div className={mergeClasses(s.row, s.center)}>
            <h2 id="recent-title" className={s.sectionTitle}>
              Recent jobs
            </h2>
            {inPeriod.length > RECENT && (
              <TextLink href={sectionHref('activity', query)}>All {inPeriod.length} jobs</TextLink>
            )}
          </div>
          <JobList jobs={inPeriod.slice(0, RECENT)} deviceName={deviceName} now={now} xomoni={xomoni} />
        </section>
      </>
    );
  } else if (section.id === 'activity') {
    content = (
      <section aria-labelledby="jobs-title">
        <h2 id="jobs-title" className={s.sectionTitle}>
          Jobs
        </h2>
        <JobList jobs={inPeriod} deviceName={deviceName} now={now} xomoni={xomoni} />
      </section>
    );
  } else if (section.id === 'audience') {
    content = (
      <Audience
        days={days}
        scope={scope}
        now={now}
        shown={numbersShown}
        archives={<OpenInXomoni xomoni={xomoni} page="library" />}
      />
    );
  } else if (section.id === 'content') {
    content = (
      <Content
        days={days}
        scope={scope}
        now={now}
        shown={numbersShown}
        inXomoni={<OpenInXomoni xomoni={xomoni} page="library" />}
      />
    );
  } else if (section.id === 'engagement') {
    content = (
      <Engagement
        days={days}
        scope={scope}
        now={now}
        shown={numbersShown}
        inXomoni={<OpenInXomoni xomoni={xomoni} page="library" />}
      />
    );
  } else if (section.id === 'library') {
    content = <LibraryPlace xomoni={xomoni} />;
  } else if (section.id === 'watch') {
    content = <WatchPlace xomoni={xomoni} now={now} />;
  } else if (section.id === 'health') {
    content = <HealthPlace xomoni={xomoni} now={now} />;
  } else if (section.id === 'cleanup') {
    content = <CleanupPlace xomoni={xomoni} now={now} />;
  } else if (section.id === 'comments') {
    content = <CommentsPlace xomoni={xomoni} now={now} />;
  } else if (section.id === 'settings') {
    content = <SettingsPlace xomoni={xomoni} numbers={<NumbersChoice shown={numbersShown} onShow={showNumbers} />} />;
  } else if (section.id === 'browsers') {
    content =
      devices.length === 0 ? (
        <ConnectBrowser createCode={createPairingCode} />
      ) : (
        <section aria-labelledby="devices-title">
          <h2 id="devices-title" className={s.sectionTitle}>
            Connected browsers
          </h2>
          <ul className={mergeClasses(s.card, s.list, s.sectionBody)}>
            {devices.map((device) => {
              const online = isOnline(device, now);
              const isNew = justConnected.has(device.id);
              return (
                <li key={device.id} className={mergeClasses(s.divided, s.row, s.center)}>
                  <div className={s.group}>
                    <span className={mergeClasses(s.deviceIcon, isNew && s.deviceIconNew)} aria-hidden>
                      <Laptop24Regular />
                    </span>
                    <div className={s.minW0}>
                      <div className={s.nameRow}>
                        <p className={s.strong}>{device.name}</p>
                        {device.id === here && (
                          <Badge appearance="tint" color="brand" size="small">
                            This browser
                          </Badge>
                        )}
                        {isNew && (
                          <Badge appearance="tint" color="success" size="small">
                            Just connected
                          </Badge>
                        )}
                      </div>
                      <p className={s.meta}>
                        <span className={mergeClasses(s.status, online && s.online)}>
                          <span className={mergeClasses(s.dot, online && s.dotOn)} aria-hidden />
                          {online ? 'Online' : `Last seen ${relativeTime(device.lastSeenAt, now)}`}
                        </span>{' '}
                        · Extension v{device.extensionVersion}
                      </p>
                    </div>
                  </div>
                  {device.id === here ? (
                    <p className={s.meta}>Signed in with you: signing out disconnects it.</p>
                  ) : (
                    <Button size="small" icon={<PlugDisconnected20Regular />} onClick={() => setLeaving(device)}>
                      Disconnect
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          <div className={s.pairing}>
            <PairingPanel createCode={createPairingCode} devices={devices} />
          </div>
        </section>
      );
  } else {
    const page = xomoniPageFor(section.id);
    content = <SectionPreview section={section} action={page && <OpenInXomoni xomoni={xomoni} page={page} />} />;
  }

  return (
    <DashboardFrame section={section} accounts={accountsIn(jobs)} live={live}>
      <div className={s.root}>
        {xomoni.ui}
        {content}
      </div>
      <DisconnectDialog device={leaving} onClose={() => setLeaving(null)} disconnect={disconnect} />
    </DashboardFrame>
  );
}

/** How many jobs Overview lists before *All jobs*. */
const RECENT = 5;

/** Jobs, newest first, or a line saying there are none in this period. */
function JobList({
  jobs,
  deviceName,
  now,
  xomoni,
}: {
  jobs: readonly JobSummary[];
  deviceName: Map<string, string>;
  now: number;
  xomoni: XomoniControls;
}) {
  const s = useStyles();
  if (jobs.length === 0)
    return (
      <p className={mergeClasses(s.card, s.padded, s.sectionBody, s.text)}>
        No jobs in this period. Start a cleanup or a scan in Xomoni and it shows up here as it runs.
      </p>
    );
  return (
    <ul className={mergeClasses(s.list, s.stack, s.sectionBody)}>
      {jobs.map((job) => (
        <JobRow key={job.id} job={job} device={deviceName.get(job.deviceId)} now={now} xomoni={xomoni} />
      ))}
    </ul>
  );
}

/** How a figure reads: its value, and a note under it. */
interface Tile {
  label: string;
  value: string;
  note: ReactNode;
}

/**
 * Overview's figures (#252) from the daily numbers the person chose to show (ADR-0026), against the period before,
 * with followers over time and what was published. *Removed* comes from Xomoni's jobs. Without numbers the tiles say
 * why, instead of showing zeros; received figures are labelled as estimates.
 */
function Numbers({
  removed,
  days,
  scope,
  now,
  shown,
  onShow,
}: {
  removed: number;
  days: readonly DailyNumbers[];
  scope: Scope;
  now: number;
  /** Whether the account shows its daily numbers; null while it is read. */
  shown: boolean | null;
  onShow: (enabled: boolean) => Promise<string | null>;
}) {
  const s = useStyles();
  const current = daysInScope(days, scope, now);
  const figures = overviewFigures(current, daysBefore(days, scope, now));
  const today = isoDay(now);
  const period =
    PERIODS.find((p) => p.id === scope.period)
      ?.label.replace(/^Last /, '')
      .toLowerCase() ?? '';
  const versus = scope.period === 'all' ? 'all' : period;
  const missing = shown
    ? days.length > 0
      ? 'No numbers in this period'
      : 'From the next report'
    : 'With daily numbers';
  const figure = (f: Figure, opts: { unit?: string; upIsGood?: boolean } = {}): Pick<Tile, 'value' | 'note'> =>
    f.value === null
      ? { value: '—', note: missing }
      : {
          value: opts.unit === '%' ? `${f.value.toFixed(1)}%` : formatCount(f.value),
          note: <Delta figure={f} period={versus} {...opts} />,
        };
  const tiles: Tile[] = [
    { label: 'Followers', ...figure(figures.followers, { upIsGood: true }) },
    { label: 'Posts', ...figure(figures.posts) },
    { label: 'Likes received', ...figure(figures.likesReceived, { upIsGood: true }) },
    { label: 'Replies received', ...figure(figures.repliesReceived, { upIsGood: true }) },
    { label: 'Engagement rate', ...figure(figures.engagementRate, { unit: '%', upIsGood: true }) },
    { label: 'Removed by Xomoni', value: removed.toLocaleString('en-US'), note: 'by jobs in this period' },
  ];
  const followers = followersSeries(current, scope, now);
  const published = publishedSeries(current, scope, now);

  return (
    <section aria-labelledby="numbers-title">
      <h2 id="numbers-title" className={s.sectionTitle}>
        Your account in numbers
      </h2>
      <ul className={mergeClasses(s.tiles, s.sectionBody)}>
        {tiles.map((tile) => (
          <li key={tile.label} className={mergeClasses(s.card, s.tile)}>
            <p className={s.tileLabel}>{tile.label}</p>
            <p className={s.tileValue}>{tile.value}</p>
            <p className={s.meta}>{tile.note}</p>
          </li>
        ))}
      </ul>
      {current.length > 0 && (
        <>
          <div className={s.charts}>
            <section className={mergeClasses(s.card, s.chartCard)} aria-labelledby="followers-chart">
              <h3 id="followers-chart" className={s.chartTitle}>
                Followers
              </h3>
              {followers.some((p) => p.value !== null) ? (
                <LineChart points={followers} label="Followers" today={today} />
              ) : (
                <p className={s.meta}>No follower count in this period yet: it comes when you open your X profile.</p>
              )}
            </section>
            <section className={mergeClasses(s.card, s.chartCard)} aria-labelledby="published-chart">
              <h3 id="published-chart" className={s.chartTitle}>
                Published
              </h3>
              <ColumnChart points={published} label="Posts, replies, reposts and quotes" today={today} />
            </section>
          </div>
          <p className={mergeClasses(s.meta, s.numbersNote)}>
            Likes, replies and views received are estimates, from {formatCount(figures.observedPosts)} sightings of your
            posts by Xomoni.
            {figures.updatedAt && <> Updated {relativeTime(figures.updatedAt, now)}.</>}
          </p>
        </>
      )}
      <NumbersChoice shown={shown} onShow={onShow} />
    </section>
  );
}

/**
 * *Show my numbers on xomoni.com* (ADR-0026): the account's choice, kept in the cloud, so it works on any device.
 * On Overview and in Settings.
 */
function NumbersChoice({
  shown,
  onShow,
}: {
  shown: boolean | null;
  onShow: (enabled: boolean) => Promise<string | null>;
}) {
  const s = useStyles();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function choose(enabled: boolean) {
    setBusy(true);
    setError(await onShow(enabled));
    setBusy(false);
  }
  return (
    <div className={mergeClasses(s.card, s.numbersChoice)}>
      <Switch
        label="Show my numbers on xomoni.com"
        checked={shown === true}
        disabled={busy || shown === null}
        onChange={(_, data) => void choose(data.checked)}
      />
      <p className={s.meta}>
        Counts per day only, sent by Xomoni on your computer: followers, posts, what your posts received and what Xomoni
        removed. Never your posts, replies, likes or anyone’s name. Turning it off deletes them.{' '}
        <TextLink href="/privacy">What is stored</TextLink>
      </p>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
    </div>
  );
}

/** Overview without a connected browser: one slim bar, so the rest of the dashboard stays in view (#245). */
function SetupBar() {
  const s = useStyles();
  return (
    <section className={mergeClasses(s.card, s.padded, s.setup)} aria-labelledby="setup-title">
      <span className={s.setupIcon} aria-hidden>
        <PuzzlePiece20Regular />
      </span>
      <div className={s.minW0}>
        <h2 id="setup-title" className={s.strong}>
          Connect Xomoni to see your account here
        </h2>
        <p className={s.meta}>
          Install it on your computer, then press <strong>Sign in to xomoni.com</strong> in it. Your jobs, and soon your
          numbers, show here on every device.
        </p>
      </div>
      <div className={s.group}>
        <Button as="a" href={INSTALL_URL} appearance="primary" size="small">
          Install Xomoni
        </Button>
        <Button as="a" href="/dashboard/browsers" size="small">
          Connect a browser
        </Button>
      </div>
    </section>
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
            In the extension, press <strong className={s.strong}>Sign in to xomoni.com</strong>, in Settings or its
            account menu. This site opens and Xomoni signs in with you: one sign-in for both. Or get a one-time code and
            type it in the extension under <strong className={s.strong}>Settings → xomoni.com</strong>.
          </span>
          <PairingPanel createCode={createCode} />
        </Step>
        <Step n={3}>This page updates by itself as soon as your browser connects.</Step>
      </ol>
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

function JobRow({
  job,
  device,
  now,
  xomoni,
}: {
  job: JobSummary;
  device: string | undefined;
  now: number;
  xomoni: XomoniControls;
}) {
  const s = useStyles();
  const state = jobStateView(job.state);
  const pct = jobProgress(job);
  const remaining = jobRemaining(job);
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
        <div className={s.progressRow}>
          <ProgressBar
            className={s.progress}
            thickness="large"
            shape="rounded"
            value={pct}
            max={100}
            color={BAR_COLOR[state.tone]}
            aria-label="Progress"
          />
          <span className={s.progressText}>{pct}%</span>
        </div>
      )}

      {/* The extension's numbers, in its words (#206, #239): removed, skipped, failed and remaining. */}
      <dl className={s.chips}>
        {job.kind === 'scan' ? (
          <Count icon={<Search16Regular />} label="Scanned" value={job.scanned} tone="brand" />
        ) : (
          <>
            <Count icon={<CheckmarkCircle16Regular />} label="Removed" value={job.done} tone="success" />
            {job.skipped > 0 && <Count icon={<ArrowRepeatAll16Regular />} label="Skipped" value={job.skipped} />}
            {job.failed > 0 && (
              <Count icon={<ErrorCircle16Regular />} label="Failed" value={job.failed} tone="danger" />
            )}
            {remaining > 0 && <Count icon={<HourglassHalf16Regular />} label="Remaining" value={remaining} />}
          </>
        )}
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

      <XomoniJobActions xomoni={xomoni} job={job} deviceName={device} />
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
