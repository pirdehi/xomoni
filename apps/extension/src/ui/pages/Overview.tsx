import {
  Body1,
  Body1Strong,
  Caption1,
  Spinner,
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
  Compose16Regular,
  Heart16Regular,
  LockClosed20Regular,
  Open16Regular,
  ShieldCheckmark20Regular,
  Sparkle20Regular,
} from '@fluentui/react-icons';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ReactNode } from 'react';
import { workerTab } from '../../engine/worker-tab';
import { db } from '../../shared/db';
import type { Account } from '../../shared/types';
import type { PageId } from '../navigation';
import { ActivityChart } from '../components/ActivityChart';
import { JobCard } from '../components/JobCard';
import { LimitsPanel } from '../components/LimitsPanel';
import { LogList } from '../components/LogList';
import { Button, Card, EmptyState, PageHeader, StatTile, type Tone } from '../components/ui';
import { errorMessage, fmtCompact, fmtNumber } from '../format';
import { type WorkerStatus, toast } from '../hooks';
import { useKindCounts } from '../queries';

/** Wide enough for the dashboard's side-by-side layout (Tailwind's former `lg`). */
const WIDE = '@media (min-width: 1024px)';
/** Wide enough for the three onboarding assurances in a row (Tailwind's former `sm`). */
const MEDIUM = '@media (min-width: 640px)';

const useStyles = makeStyles({
  grid: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: tokens.spacingVerticalL },
  thirds: { [WIDE]: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' } },
  halves: { [WIDE]: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } },
  spanTwo: { [WIDE]: { gridColumnEnd: 'span 2' } },
  section: { marginTop: tokens.spacingVerticalL },
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: tokens.spacingVerticalL },
  hero: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: tokens.spacingHorizontalXL,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusXLarge,
  },
  heroLabel: {
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
  },
  heroValue: {
    marginTop: tokens.spacingVerticalS,
    fontSize: tokens.fontSizeHero900,
    lineHeight: tokens.lineHeightHero900,
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: '-0.02em',
    color: tokens.colorNeutralForeground1,
    fontVariantNumeric: 'tabular-nums',
  },
  heroSub: {
    marginTop: tokens.spacingVerticalXS,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    color: tokens.colorNeutralForeground2,
  },
  heroFooter: {
    marginTop: tokens.spacingVerticalL,
    paddingTop: tokens.spacingVerticalM,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    color: tokens.colorNeutralForeground2,
  },
  strong: { fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground1 },
  stack: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
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
 * The home page, drawn with Fluent UI (ADR-0019). With no known account (`account` is null) it shows onboarding:
 * open the worker window and log in to X there. Otherwise it shows counts, the yearly chart, limits, open jobs and
 * recent activity.
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
  const jobs = useLiveQuery(
    () =>
      db.jobs
        .where('accountId')
        .equals(account.id)
        .filter((j) => j.state !== 'completed' && j.state !== 'cancelled')
        .reverse()
        .sortBy('updatedAt')
        .then((list) => list.slice(0, 3)),
    [account.id],
  );
  const logs = useLiveQuery(
    () => db.logs.where('[accountId+ts]').between([account.id, 0], [account.id, Infinity]).reverse().limit(8).toArray(),
    [account.id],
  );
  const removed = counts ? Object.values(counts).reduce((s, c) => s + c.deleted, 0) : 0;

  return (
    <>
      <PageHeader
        title="Overview"
        description={`@${account.handle} · everything Xomoni knows is stored only in this browser.`}
        actions={
          <Button variant="primary" icon={<Sparkle20Regular />} onClick={() => navigate('cleanup')}>
            New cleanup
          </Button>
        }
      />

      <div className={mergeClasses(styles.grid, styles.thirds)}>
        <div className={styles.hero}>
          <div>
            <div className={styles.heroLabel}>Removed by Xomoni</div>
            <div className={styles.heroValue}>{fmtNumber(removed)}</div>
            <div className={styles.heroSub}>posts, replies, reposts and likes</div>
          </div>
          {account.postsCount != null && (
            <div className={styles.heroFooter}>
              X shows <span className={styles.strong}>{fmtNumber(account.postsCount)}</span> posts on your profile
              {account.likesCount != null && (
                <>
                  {' '}
                  and <span className={styles.strong}>{fmtNumber(account.likesCount)}</span> likes
                </>
              )}
              .
            </div>
          )}
        </div>
        <div className={mergeClasses(styles.tiles, styles.spanTwo)}>
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
        </div>
      </div>

      <div className={mergeClasses(styles.grid, styles.thirds, styles.section)}>
        <div className={styles.spanTwo}>
          <ActivityChart accountId={account.id} />
        </div>
        <LimitsPanel accountId={account.id} />
      </div>

      <div className={mergeClasses(styles.grid, styles.halves, styles.section)}>
        <Card
          title="Jobs in progress"
          actions={
            <Button size="sm" variant="ghost" onClick={() => navigate('jobs')}>
              All jobs
            </Button>
          }
        >
          {!jobs?.length ? (
            <EmptyState
              icon={<Sparkle20Regular />}
              title="No jobs in progress"
              body="Start a cleanup to remove old posts, replies, reposts or likes."
              action={
                <Button size="sm" onClick={() => navigate('cleanup')}>
                  New cleanup
                </Button>
              }
            />
          ) : (
            <div className={styles.stack}>
              {jobs.map((j) => (
                <JobCard key={j.id} job={j} compact />
              ))}
            </div>
          )}
        </Card>
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
              <LogList entries={logs} />
            </div>
          )}
        </Card>
      </div>
    </>
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
          <Step n={1} done={worker.open} title="Open the X worker window">
            A normal Chrome window on x.com that Xomoni drives for you, like a careful assistant clicking the buttons.
            <div className={styles.stepAction}>
              <Button variant="primary" size="sm" icon={<Open16Regular />} onClick={open}>
                {worker.open ? 'Show X worker' : 'Open X worker'}
              </Button>
            </div>
          </Step>
          <Step n={2} done={loggedIn} title="Log in to X there">
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
