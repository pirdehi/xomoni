import {
  Body1,
  Body1Strong,
  Caption1,
  Spinner,
  Subtitle1,
  Title2,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowRepeatAll16Regular,
  ArrowReply16Regular,
  Checkmark16Filled,
  CheckmarkCircle20Regular,
  CheckmarkCircle24Filled,
  Compose16Regular,
  Delete16Regular,
  Heart16Regular,
  LockClosed20Regular,
  Open16Regular,
  Play16Regular,
  Pulse24Regular,
  ShieldCheckmark20Regular,
  Sparkle20Regular,
  Warning24Filled,
} from '@fluentui/react-icons';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ReactNode } from 'react';
import { workerTab } from '../../engine/worker-tab';
import { db } from '../../shared/db';
import type { Account } from '../../shared/types';
import type { PageId } from '../navigation';
import { ActivityChart } from '../components/ActivityChart';
import { LogList } from '../components/LogList';
import { Button, Card, EmptyState, PageHeader, StatTile, type Tone, useNow } from '../components/ui';
import { errorMessage, fmtCompact, fmtNumber } from '../format';
import { type HomeStatus, type StartStep, gettingStarted, homeStatus } from '../home-status';
import { type WorkerStatus, startJob, toast, useRisk, useRunner } from '../hooks';
import { useArchiveStatus, useKindCounts } from '../queries';

/** Wide enough for the dashboard's side-by-side layout (Tailwind's former `lg`). */
const WIDE = '@media (min-width: 1024px)';
/** Wide enough for the three onboarding assurances in a row (Tailwind's former `sm`). */
const MEDIUM = '@media (min-width: 640px)';

const useStyles = makeStyles({
  section: { marginTop: tokens.spacingVerticalL },
  countsNote: {
    margin: `${tokens.spacingVerticalXL} 0 ${tokens.spacingVerticalS}`,
    color: tokens.colorNeutralForeground3,
  },
  // As many tiles in a row as fit, so the five counts share one row on a laptop.
  counts: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(9.5rem, 1fr))',
    gap: tokens.spacingVerticalL,
  },
  status: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: tokens.spacingHorizontalL,
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalXL}`,
    borderRadius: tokens.borderRadiusXLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
  },
  status_good: { borderLeft: `${tokens.strokeWidthThickest} solid ${tokens.colorStatusSuccessBorderActive}` },
  status_accent: { borderLeft: `${tokens.strokeWidthThickest} solid ${tokens.colorBrandStroke1}` },
  status_warn: {
    borderLeft: `${tokens.strokeWidthThickest} solid ${tokens.colorStatusWarningBorderActive}`,
    backgroundColor: tokens.colorStatusWarningBackground1,
  },
  status_critical: {
    borderLeft: `${tokens.strokeWidthThickest} solid ${tokens.colorStatusDangerBorderActive}`,
    backgroundColor: tokens.colorStatusDangerBackground1,
  },
  statusIcon: { display: 'inline-flex', flexShrink: 0 },
  statusIcon_good: { color: tokens.colorStatusSuccessForeground1 },
  statusIcon_accent: { color: tokens.colorBrandForeground1 },
  statusIcon_warn: { color: tokens.colorStatusWarningForeground1 },
  statusIcon_critical: { color: tokens.colorStatusDangerForeground1 },
  statusBody: { flexGrow: 1, flexBasis: '20rem', minWidth: 0 },
  statusTitle: { display: 'block', margin: 0, color: tokens.colorNeutralForeground1 },
  statusText: { margin: `${tokens.spacingVerticalXXS} 0 0`, color: tokens.colorNeutralForeground2 },
  started: {
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalXL}`,
    borderRadius: tokens.borderRadiusXLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  startedTitle: { display: 'block', margin: `0 0 ${tokens.spacingVerticalS}`, color: tokens.colorNeutralForeground1 },
  startedSteps: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: tokens.spacingVerticalS,
    margin: 0,
    padding: 0,
    listStyleType: 'none',
    [WIDE]: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
  },
  startedStep: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM, minWidth: 0 },
  startedText: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: tokens.spacingHorizontalM },
  doneText: { color: tokens.colorNeutralForeground3 },
  // The log rows have their own vertical padding; this lines the first and last row up with the card's padding.
  log: { marginBlock: `calc(-1 * ${tokens.spacingVerticalMNudge})` },
  onboarding: { maxWidth: '42rem', marginInline: 'auto', paddingTop: tokens.spacingVerticalXXL },
  intro: { marginBottom: tokens.spacingVerticalXXXL },
  logo: {
    display: 'block',
    width: '56px',
    height: '56px',
    margin: `0 auto ${tokens.spacingVerticalL}`,
    borderRadius: tokens.borderRadius3XLarge,
    boxShadow: tokens.shadow4,
  },
  welcome: { display: 'block', margin: 0, color: tokens.colorNeutralForeground1 },
  pitch: {
    display: 'block',
    maxWidth: '28rem',
    margin: `${tokens.spacingVerticalS} auto 0`,
    color: tokens.colorNeutralForeground2,
  },
  steps: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalXL,
    margin: 0,
    padding: 0,
    listStyleType: 'none',
  },
  step: { display: 'flex', gap: tokens.spacingHorizontalL },
  marker: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: '28px',
    height: '28px',
    borderRadius: tokens.borderRadiusCircular,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    fontVariantNumeric: 'tabular-nums',
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground2,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  markerGood: {
    backgroundColor: tokens.colorStatusSuccessBackground3,
    color: tokens.colorNeutralForegroundOnBrand,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorStatusSuccessBackground3}`,
  },
  markerAccent: {
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorBrandBackground}`,
  },
  stepBody: { minWidth: 0, paddingTop: tokens.spacingVerticalXXS },
  stepTitle: { display: 'block', color: tokens.colorNeutralForeground1 },
  stepText: {
    marginTop: tokens.spacingVerticalXS,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    color: tokens.colorNeutralForeground2,
  },
  stepAction: { marginTop: tokens.spacingVerticalM },
  busy: { display: 'inline-flex', alignItems: 'center', gap: tokens.spacingHorizontalSNudge },
  assurances: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: tokens.spacingVerticalM,
    marginTop: tokens.spacingVerticalL,
    [MEDIUM]: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
  },
  assurance: {
    padding: tokens.spacingHorizontalL,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusXLarge,
  },
  assuranceTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    margin: `0 0 ${tokens.spacingVerticalSNudge}`,
    color: tokens.colorNeutralForeground1,
  },
  assuranceIcon: { display: 'inline-flex', flexShrink: 0, color: tokens.colorBrandForeground1 },
  assuranceText: { display: 'block', margin: 0, color: tokens.colorNeutralForeground2 },
});

/**
 * Home, drawn with Fluent UI (ADR-0019). With no known account (`account` is null) it shows onboarding: open the X
 * window and sign in to X there. Otherwise it answers "what now?" first (#201): one status (all well, what runs, or
 * what X needs) with its one action, the steps of getting started until they are done, then the counts in one row,
 * the yearly chart and recent activity. Xomoni's limits are in Settings.
 */
export function OverviewPage({
  account,
  worker,
  navigate,
}: {
  account: Account | null;
  worker: WorkerStatus;
  navigate: (p: PageId) => void;
}) {
  if (!account) return <Onboarding worker={worker} />;
  return <Dashboard account={account} navigate={navigate} />;
}

function Dashboard({ account, navigate }: { account: Account; navigate: (p: PageId) => void }) {
  const styles = useStyles();
  const counts = useKindCounts(account.id);
  const run = useRunner();
  const risk = useRisk(account.id);
  const archive = useArchiveStatus(account.id);
  const now = useNow(30_000);
  const jobs = useLiveQuery(
    () => db.jobs.where('accountId').equals(account.id).reverse().sortBy('updatedAt'),
    [account.id],
  );
  const logs = useLiveQuery(
    () =>
      db.logs.where('[accountId+ts]').between([account.id, 0], [account.id, Infinity]).reverse().limit(60).toArray(),
    [account.id],
  );
  const removed = counts ? Object.values(counts).reduce((s, c) => s + c.deleted, 0) : 0;
  const openJobs = (jobs ?? []).filter((j) => !['completed', 'cancelled', 'failed'].includes(j.state));
  const status = jobs ? homeStatus({ run, openJobs, risk, now }) : null;
  const steps =
    jobs && archive
      ? gettingStarted({
          archiveImported: archive.imported,
          archiveAsked: !!archive.request || !!archive.openJob,
          hasCleanup: jobs.some((j) => j.kind === 'cleanup'),
        })
      : null;

  return (
    <>
      <PageHeader
        title="Home"
        description={`@${account.handle} · everything Xomoni knows stays in this browser.`}
        actions={
          <Button variant="primary" icon={<Sparkle20Regular />} onClick={() => navigate('cleanup')}>
            New cleanup
          </Button>
        }
      />

      {status && <StatusCard status={status} navigate={navigate} />}
      {steps && <GettingStarted steps={steps} navigate={navigate} />}

      <Caption1 as="p" className={styles.countsNote}>
        In your copy: what Xomoni knows is still on X, and what it removed. X’s own count is in the Library.
      </Caption1>
      <section aria-label="Counts" className={styles.counts}>
        <StatTile label="Removed by Xomoni" icon={<Delete16Regular />} value={fmtNumber(removed)} sub="all kinds" />
        <StatTile
          label="Posts"
          icon={<Compose16Regular />}
          value={fmtCompact(counts?.post.present ?? 0)}
          sub={`${fmtNumber(counts?.post.deleted ?? 0)} removed`}
        />
        <StatTile
          label="Replies"
          icon={<ArrowReply16Regular />}
          value={fmtCompact(counts?.reply.present ?? 0)}
          sub={`${fmtNumber(counts?.reply.deleted ?? 0)} removed`}
        />
        <StatTile
          label="Reposts"
          icon={<ArrowRepeatAll16Regular />}
          value={fmtCompact(counts?.repost.present ?? 0)}
          sub={`${fmtNumber(counts?.repost.deleted ?? 0)} undone`}
        />
        <StatTile
          label="Likes"
          icon={<Heart16Regular />}
          value={fmtCompact(counts?.like.present ?? 0)}
          sub={`${fmtNumber(counts?.like.deleted ?? 0)} removed`}
        />
      </section>

      <div className={styles.section}>
        <ActivityChart accountId={account.id} />
      </div>

      <div className={styles.section}>
        <Card
          title="Recent activity"
          actions={
            <Button size="sm" variant="ghost" onClick={() => navigate('activity')}>
              Full log
            </Button>
          }
        >
          {!logs?.length ? (
            <EmptyState
              icon={<CheckmarkCircle20Regular />}
              title="Nothing yet"
              body="Every action Xomoni takes is recorded here."
            />
          ) : (
            <div className={styles.log}>
              <LogList entries={logs} grouped maxRows={6} />
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

/** Home's first block (#201): whether all is well, what runs, and the one thing to do about it. */
function StatusCard({ status, navigate }: { status: HomeStatus; navigate: (p: PageId) => void }) {
  const styles = useStyles();
  const { action } = status;
  const act = () => {
    if (!action) return;
    if (action.kind === 'open-x') void workerTab.focus().catch((e: unknown) => toast(errorMessage(e), 'critical'));
    else if (action.kind === 'resume') void startJob(action.jobId);
    else navigate('jobs');
  };
  const icon =
    status.tone === 'good' ? (
      <CheckmarkCircle24Filled />
    ) : status.tone === 'accent' ? (
      <Pulse24Regular />
    ) : (
      <Warning24Filled />
    );
  return (
    <section
      aria-label="Status"
      className={mergeClasses(styles.status, styles[`status_${status.tone}`])}
      data-tone={status.tone}
    >
      <span className={mergeClasses(styles.statusIcon, styles[`statusIcon_${status.tone}`])} aria-hidden>
        {icon}
      </span>
      <div className={styles.statusBody}>
        <Subtitle1 as="h2" className={styles.statusTitle}>
          {status.title}
        </Subtitle1>
        {status.text && (
          <Body1 as="p" className={styles.statusText}>
            {status.text}
          </Body1>
        )}
      </div>
      {action && (
        <Button
          variant={action.kind === 'jobs' ? 'secondary' : 'primary'}
          icon={action.kind === 'open-x' ? <Open16Regular /> : action.kind === 'resume' ? <Play16Regular /> : undefined}
          onClick={act}
        >
          {action.label}
        </Button>
      )}
    </section>
  );
}

/** The steps of getting started (#201), the current one with its action; gone once all are done. */
function GettingStarted({ steps, navigate }: { steps: StartStep[]; navigate: (p: PageId) => void }) {
  const styles = useStyles();
  return (
    <section aria-label="Getting started" className={mergeClasses(styles.started, styles.section)}>
      <Body1Strong as="h2" className={styles.startedTitle}>
        Getting started
      </Body1Strong>
      <ol className={styles.startedSteps}>
        {steps.map((step, i) => (
          <li
            key={step.id}
            className={styles.startedStep}
            data-state={step.state}
            aria-current={step.state === 'current' ? 'step' : undefined}
          >
            <span
              className={mergeClasses(
                styles.marker,
                step.state === 'done' && styles.markerGood,
                step.state === 'current' && styles.markerAccent,
              )}
            >
              {step.state === 'done' ? <Checkmark16Filled aria-label="Done:" /> : i + 1}
            </span>
            <span className={styles.startedText}>
              <Body1 className={step.state === 'done' ? styles.doneText : undefined}>{step.title}</Body1>
              {step.state === 'current' && step.id === 'archive' && (
                <Button size="sm" variant="primary" onClick={() => navigate('library')}>
                  {step.title === 'Get your archive' ? 'Get my archive' : 'See in Library'}
                </Button>
              )}
              {step.state === 'current' && step.id === 'cleanup' && (
                <Button size="sm" variant="primary" onClick={() => navigate('cleanup')}>
                  New cleanup
                </Button>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Onboarding({ worker }: { worker: WorkerStatus }) {
  const styles = useStyles();
  const open = () =>
    void (worker.open ? workerTab.focus() : workerTab.open()).catch((e: unknown) => toast(errorMessage(e), 'critical'));
  const loggedIn = !!worker.info?.loggedIn;
  return (
    <div className={styles.onboarding}>
      <div className={styles.intro}>
        <img src="icons/icon128.png" alt="" className={styles.logo} />
        <Title2 as="h1" align="center" className={styles.welcome}>
          Welcome to Xomoni
        </Title2>
        <Body1 as="p" align="center" className={styles.pitch}>
          Clean up your X account — old posts, replies, reposts and likes — without API keys, at a pace X accepts.
        </Body1>
      </div>
      <Card>
        <ol className={styles.steps}>
          <Step n={1} done={worker.open} title="Open the X window">
            A normal Chrome window on x.com that Xomoni drives for you, like a careful assistant clicking the buttons.
            <div className={styles.stepAction}>
              <Button variant="primary" size="sm" icon={<Open16Regular />} onClick={open}>
                {worker.open ? 'Show X window' : 'Open X window'}
              </Button>
            </div>
          </Step>
          <Step n={2} done={loggedIn} title="Sign in to X there">
            Use your normal login, including 2FA. Xomoni never sees your password or session cookies.
          </Step>
          <Step n={3} done={false} active={loggedIn} title="Xomoni detects your account">
            {loggedIn ? (
              <span className={styles.busy}>
                <Spinner size="extra-tiny" aria-hidden /> Reading your profile…
              </span>
            ) : (
              'Your dashboard appears here as soon as you are signed in.'
            )}
          </Step>
        </ol>
      </Card>
      <div className={styles.assurances}>
        <Assurance icon={<LockClosed20Regular />} title="Private by design">
          No servers. Your data stays in this browser.
        </Assurance>
        <Assurance icon={<ShieldCheckmark20Regular />} title="Respects X limits">
          Human pacing, caps and automatic safety stops.
        </Assurance>
        <Assurance icon={<CheckmarkCircle20Regular />} title="Verified actions">
          Counted only when X confirms them.
        </Assurance>
      </div>
    </div>
  );
}

/**
 * One onboarding step: a round marker with its number (a check mark once done) and the step's title and text. The
 * marker's state is in `data-tone`: `good` when done, `accent` while it is the step in progress, else `neutral`.
 */
function Step({
  n,
  done,
  active,
  title,
  children,
}: {
  n: number;
  done: boolean;
  active?: boolean;
  title: string;
  children: ReactNode;
}) {
  const styles = useStyles();
  const tone: Tone = done ? 'good' : active ? 'accent' : 'neutral';
  return (
    <li className={styles.step}>
      <span
        className={mergeClasses(
          styles.marker,
          tone === 'good' && styles.markerGood,
          tone === 'accent' && styles.markerAccent,
        )}
        data-tone={tone}
      >
        {done ? <Checkmark16Filled aria-hidden /> : n}
      </span>
      <div className={styles.stepBody}>
        <Body1Strong className={styles.stepTitle}>{title}</Body1Strong>
        <div className={styles.stepText}>{children}</div>
      </div>
    </li>
  );
}

function Assurance({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <div className={styles.assurance}>
      <Body1Strong as="p" className={styles.assuranceTitle}>
        <span className={styles.assuranceIcon}>{icon}</span>
        {title}
      </Body1Strong>
      <Caption1 as="p" className={styles.assuranceText}>
        {children}
      </Caption1>
    </div>
  );
}
