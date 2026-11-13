import {
  Body1,
  Body1Strong,
  Caption1,
  Button as FluentButton,
  MessageBar,
  MessageBarBody,
  MessageBarGroup,
  type MessageBarIntent,
  Nav,
  NavItem,
  Spinner,
  Subtitle2,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  AlertUrgent20Regular,
  Board20Filled,
  Board20Regular,
  CheckmarkCircle16Filled,
  Eye16Regular,
  EyeOff16Regular,
  type FluentIcon,
  History20Filled,
  History20Regular,
  Library20Filled,
  Library20Regular,
  Open16Regular,
  Pause16Regular,
  Pulse20Regular,
  Search20Filled,
  Search20Regular,
  Settings20Filled,
  Settings20Regular,
  Sparkle20Filled,
  Sparkle20Regular,
  TaskListLtr20Filled,
  TaskListLtr20Regular,
  Warning16Filled,
  bundleIcon,
} from '@fluentui/react-icons';
import { type ReactNode, useEffect, useState } from 'react';
import { runner } from '../engine/platform';
import { workerTab } from '../engine/worker-tab';
import { type Need, NEED_TITLE, needMessage, pageNeed } from '../shared/attention';
import { db } from '../shared/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, type Tone } from './components/ui';
import { AccountPanel } from './components/AccountPanel';
import { UpdateNotice } from './components/UpdateNotice';
import { ArchiveFollowUp } from './components/ArchiveFollowUp';
import { ConsentDialog } from './components/ConsentDialog';
import { errorMessage } from './format';
import {
  type WorkerStatus,
  runHidden,
  toast,
  useActiveAccount,
  useRunner,
  useShareGuard,
  useTabShare,
  useToasts,
  useWorkerStatus,
} from './hooks';
import { tabShare } from './tab-share';
import { ActivityPage } from './pages/Activity';
import { CleanupPage } from './pages/Cleanup';
import { LibraryPage } from './pages/Library';
import { JobsPage } from './pages/Jobs';
import { OverviewPage } from './pages/Overview';
import { SettingsPage } from './pages/Settings';
import { WatchPage } from './pages/Watch';
import type { Account } from '../shared/types';
import { MOVED_PAGES, type PageId, type PageProps } from './navigation';
import { startCloudSync } from '../cloud/sync';

// Each page's icon: Fluent's Nav shows the filled one for the current page and the outline for the others.
const NAV: { id: PageId; label: string; icon: FluentIcon }[] = [
  { id: 'overview', label: 'Overview', icon: bundleIcon(Board20Filled, Board20Regular) },
  { id: 'cleanup', label: 'Cleanup', icon: bundleIcon(Sparkle20Filled, Sparkle20Regular) },
  { id: 'library', label: 'Library', icon: bundleIcon(Library20Filled, Library20Regular) },
  { id: 'watch', label: 'Watch', icon: bundleIcon(Search20Filled, Search20Regular) },
  { id: 'jobs', label: 'Jobs', icon: bundleIcon(TaskListLtr20Filled, TaskListLtr20Regular) },
  { id: 'activity', label: 'Activity log', icon: bundleIcon(History20Filled, History20Regular) },
  { id: 'settings', label: 'Settings', icon: bundleIcon(Settings20Filled, Settings20Regular) },
];

/** Fluent's message bar intent for each toast tone. */
const TOAST_INTENT = {
  good: 'success',
  critical: 'error',
  neutral: 'info',
} as const satisfies Record<'good' | 'critical' | 'neutral', MessageBarIntent>;

// The page column's width and side padding, shared by the content and the sticky banners so they line up.
const COLUMN = { maxWidth: '72rem', marginInline: 'auto', paddingInline: tokens.spacingHorizontalXXXL } as const;

const useStyles = makeStyles({
  shell: {
    display: 'flex',
    height: '100vh',
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground1,
    fontFamily: tokens.fontFamilyBase,
  },
  main: { flexGrow: 1, minWidth: 0, overflowY: 'auto' },
  content: { ...COLUMN, paddingBlock: tokens.spacingVerticalXXXL },
  sidebar: {
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    width: '240px',
    boxSizing: 'border-box',
    overflowY: 'auto',
    backgroundColor: tokens.colorNeutralBackground1,
    borderRight: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalMNudge,
    padding: tokens.spacingHorizontalXL,
  },
  logo: { display: 'block', width: '28px', height: '28px', borderRadius: tokens.borderRadiusLarge },
  brandText: { display: 'flex', flexDirection: 'column' },
  muted: { color: tokens.colorNeutralForeground3 },
  nav: { flexGrow: 1, paddingInline: tokens.spacingHorizontalM },
  navList: { rowGap: tokens.spacingVerticalXXS },
  navItem: {
    backgroundColor: tokens.colorTransparentBackground,
    ':hover': { backgroundColor: tokens.colorSubtleBackgroundHover, color: tokens.colorNeutralForeground1 },
    ':active': { backgroundColor: tokens.colorSubtleBackgroundPressed },
  },
  navItemCurrent: {
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground2,
    ':hover': { backgroundColor: tokens.colorBrandBackground2Hover, color: tokens.colorBrandForeground2 },
    ':active': { backgroundColor: tokens.colorBrandBackground2Pressed },
  },
  footer: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalL,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  chip: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalXS} ${tokens.spacingVerticalXS} ${tokens.spacingHorizontalMNudge}`,
    backgroundColor: tokens.colorNeutralBackground2,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
  },
  chipStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    minWidth: 0,
    color: tokens.colorNeutralForeground2,
  },
  chipIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: '16px',
    height: '16px',
  },
  dot: { width: '8px', height: '8px', borderRadius: tokens.borderRadiusCircular, backgroundColor: 'currentColor' },
  truncate: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  account: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalMNudge, minWidth: 0 },
  accountText: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  banner: {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow2,
  },
  attention: {
    backgroundColor: tokens.colorStatusWarningBackground1,
    borderBottomColor: tokens.colorStatusWarningBorder1,
  },
  attentionBar: {
    position: 'absolute',
    insetBlock: 0,
    left: 0,
    width: '4px',
    backgroundColor: tokens.colorStatusWarningForeground1,
  },
  bannerRow: {
    ...COLUMN,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalL,
    paddingBlock: tokens.spacingVerticalMNudge,
  },
  attentionRow: { paddingBlock: tokens.spacingVerticalM },
  bannerText: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalMNudge, minWidth: 0 },
  bannerTextTop: { alignItems: 'flex-start' },
  bannerIcon: { flexShrink: 0, color: tokens.colorBrandForeground1 },
  attentionIcon: { flexShrink: 0, color: tokens.colorStatusWarningForeground1 },
  stack: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  noShrink: { flexShrink: 0 },
  secondary: { color: tokens.colorNeutralForeground2 },
  actions: { display: 'flex', flexShrink: 0, gap: tokens.spacingHorizontalS },
  toasts: {
    position: 'fixed',
    right: tokens.spacingHorizontalXL,
    bottom: tokens.spacingVerticalXL,
    zIndex: 2,
    width: '320px',
    pointerEvents: 'none',
  },
  toastGroup: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalS },
  toast: { pointerEvents: 'auto', boxShadow: tokens.shadow16, borderRadius: tokens.borderRadiusLarge },
  toastNeutral: { backgroundColor: tokens.colorNeutralBackground1 },
});

/** The icon color for each worker status tone. */
const useToneStyles = makeStyles({
  neutral: { color: tokens.colorNeutralForeground3 },
  accent: { color: tokens.colorBrandForeground1 },
  good: { color: tokens.colorStatusSuccessForeground1 },
  warn: { color: tokens.colorStatusWarningForeground1 },
  critical: { color: tokens.colorStatusDangerForeground1 },
});

/** Reports job status to xomoni.com while the dashboard is open, if this browser is connected (ADR-0018). */
function useCloudSync() {
  useEffect(
    () =>
      startCloudSync(() =>
        toast(
          'xomoni.com no longer knows this browser: it was disconnected there, or sent nothing for 90 days. Connect it again in Settings to keep sending job status.',
        ),
      ),
    [],
  );
}

function useHashRoute(): [PageId, (p: PageId) => void] {
  const read = () => {
    const hash = location.hash.replace(/^#\/?/, '');
    const id = MOVED_PAGES[hash] ?? hash;
    return NAV.find((n) => n.id === id)?.id ?? 'overview';
  };
  const [page, setPage] = useState<PageId>(read);
  useEffect(() => {
    const onHash = () => setPage(read());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return [page, (p) => (location.hash = `/${p}`)];
}

/**
 * The dashboard shell, on Fluent UI (ADR-0019): a full-height sidebar (Fluent `Nav`, with the current page marked
 * `aria-current="page"`, the worker status and the account), the running-job banner, a notice when a newer version
 * is out (#151), the current page and toasts, and the archive follow-up, which gets X's archive the rest of the way
 * by itself once the person asked for it (#186).
 * Pages are addressed by the URL hash (`#/jobs`). Until an X account is known, only the onboarding view is shown,
 * whatever the hash says.
 */
export function App() {
  const styles = useStyles();
  const [page, navigate] = useHashRoute();
  const account = useActiveAccount();
  const worker = useWorkerStatus();
  useCloudSync();
  useShareGuard();

  return (
    <div className={styles.shell}>
      <Sidebar page={page} navigate={navigate} account={account ?? null} worker={worker} />
      <main className={styles.main}>
        <RunnerBanner />
        {account && <IdleNeedBanner account={account} worker={worker} />}
        <div className={styles.content}>
          <UpdateNotice />
          {account === undefined ? null : !account ? (
            <OverviewPage account={null} worker={worker} navigate={navigate} />
          ) : (
            <PageSwitch page={page} account={account} worker={worker} navigate={navigate} />
          )}
        </div>
      </main>
      <Toasts />
      <ConsentDialog />
      {account && <ArchiveFollowUp account={account} libraryOpen={page === 'library'} />}
    </div>
  );
}

function PageSwitch({ page, ...props }: PageProps & { page: PageId }) {
  switch (page) {
    case 'cleanup':
      return <CleanupPage {...props} />;
    case 'library':
      return <LibraryPage {...props} />;
    case 'watch':
      return <WatchPage {...props} />;
    case 'jobs':
      return <JobsPage {...props} />;
    case 'activity':
      return <ActivityPage {...props} />;
    case 'settings':
      return <SettingsPage {...props} />;
    default:
      return <OverviewPage {...props} />;
  }
}

function Sidebar({
  page,
  navigate,
  account,
  worker,
}: {
  page: PageId;
  navigate: (p: PageId) => void;
  account: Account | null;
  worker: WorkerStatus;
}) {
  const styles = useStyles();
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <img src="icons/icon48.png" alt="" className={styles.logo} />
        <div className={styles.brandText}>
          <Subtitle2>Xomoni</Subtitle2>
          <Caption1 className={styles.muted}>X account manager</Caption1>
        </div>
      </div>
      <nav className={styles.nav}>
        <Nav selectedValue={page} className={styles.navList}>
          {NAV.map(({ id, label, icon: Icon }) => (
            <NavItem
              key={id}
              value={id}
              icon={<Icon />}
              onClick={() => navigate(id)}
              className={mergeClasses(styles.navItem, page === id && styles.navItemCurrent)}
            >
              {label}
            </NavItem>
          ))}
        </Nav>
      </nav>
      <div className={styles.footer}>
        <WorkerChip worker={worker} />
        {account && <AccountPanel account={account} worker={worker} navigate={navigate} />}
      </div>
    </aside>
  );
}

/** The tones the worker chip uses. */
type WorkerTone = Exclude<Tone, 'serious'>;

/**
 * What the X window's chip says, and its tone, for the window's state; the first matching problem wins. A covered
 * window only matters while a job runs (`running`), since Chrome pauses pages it doesn't show; otherwise it is ready
 * (#200).
 */
export function workerState({ open, info }: WorkerStatus, running: boolean): { text: string; tone: WorkerTone } {
  if (open && !info) return { text: 'Opening the X window…', tone: 'accent' };
  if (info?.locked) return { text: 'X account locked', tone: 'critical' };
  if (info && !info.loggedIn) return { text: 'Sign in to X', tone: 'warn' };
  if (info?.challenge) return { text: 'Confirm it’s you on X', tone: 'warn' };
  if (info?.hidden && running) return { text: 'Keep the X window visible', tone: 'warn' };
  if (info) return { text: 'X window ready', tone: 'good' };
  return { text: 'X window closed', tone: 'neutral' };
}

/**
 * What X needs from the person while no job runs, worth a banner on every page. Another account in the X window
 * isn't one: the dashboard follows the account the window is signed in to.
 */
const IDLE_NEEDS: readonly Need[] = ['login', 'verify'];

/**
 * A banner at the top of every page when X needs the person and no job runs (#200): signed out, or an X check or
 * lock. A running job shows its own banner instead. It goes once X is ready.
 */
function IdleNeedBanner({ account, worker }: { account: Account; worker: WorkerStatus }) {
  const styles = useStyles();
  const state = useRunner();
  const need = state.status === 'idle' && worker.info ? pageNeed(worker.info, account.id) : null;
  if (!need || !IDLE_NEEDS.includes(need)) return null;
  return (
    <section role="status" aria-label="X needs you" className={mergeClasses(styles.banner, styles.attention)}>
      <span className={styles.attentionBar} />
      <div className={mergeClasses(styles.bannerRow, styles.attentionRow)}>
        <div className={mergeClasses(styles.bannerText, styles.bannerTextTop)}>
          <AlertUrgent20Regular className={styles.attentionIcon} aria-hidden />
          <div className={styles.stack}>
            <Body1Strong>{NEED_TITLE[need]}</Body1Strong>
            <Body1 className={styles.secondary}>
              {needMessage(need, account.handle)} Jobs wait until then; Xomoni never sees what you type.
            </Body1>
          </div>
        </div>
        <div className={styles.actions}>
          <Button
            size="sm"
            variant="primary"
            icon={<Open16Regular />}
            onClick={() => void workerTab.focus().catch((e: unknown) => toast(errorMessage(e), 'critical'))}
          >
            Open X window
          </Button>
        </div>
      </div>
    </section>
  );
}

function WorkerChip({ worker }: { worker: WorkerStatus }) {
  const styles = useStyles();
  const toneStyles = useToneStyles();
  const run = useRunner();
  const { text, tone } = workerState(worker, run.status !== 'idle');
  const icon: ReactNode =
    tone === 'accent' ? (
      <Spinner size="extra-tiny" aria-hidden />
    ) : tone === 'good' ? (
      <CheckmarkCircle16Filled aria-hidden />
    ) : tone === 'neutral' ? (
      <span className={styles.dot} />
    ) : (
      <Warning16Filled aria-hidden />
    );
  const title = worker.open ? 'Show the X window' : 'Open the X window';
  return (
    <div className={styles.chip} data-tone={tone}>
      <span className={styles.chipStatus}>
        <span className={mergeClasses(styles.chipIcon, toneStyles[tone])}>{icon}</span>
        <Caption1>{text}</Caption1>
      </span>
      <FluentButton
        appearance="subtle"
        size="small"
        icon={<Open16Regular />}
        title={title}
        aria-label={title}
        onClick={() =>
          void (worker.open ? workerTab.focus() : workerTab.open()).catch((e: unknown) =>
            toast(errorMessage(e), 'critical'),
          )
        }
      />
    </div>
  );
}

function RunnerBanner() {
  const styles = useStyles();
  const state = useRunner();
  const sharing = useTabShare();
  const job = useLiveQuery(() => (state.jobId ? db.jobs.get(state.jobId) : undefined), [state.jobId]);
  const attention = state.status === 'attention';
  useEffect(() => {
    if (!attention) return;
    const title = document.title;
    document.title = '(!) Needs you — Xomoni';
    return () => void (document.title = title);
  }, [attention]);
  if (state.status === 'idle') return null;
  if (attention) {
    // A hidden window is Chrome pausing the page, not X asking for anything (#118).
    const who = state.need === 'hidden' ? 'Xomoni needs its X window on screen' : 'X needs you';
    return (
      <div role="alert" className={mergeClasses(styles.banner, styles.attention)}>
        <span className={styles.attentionBar} />
        <div className={mergeClasses(styles.bannerRow, styles.attentionRow)}>
          <div className={mergeClasses(styles.bannerText, styles.bannerTextTop)}>
            <AlertUrgent20Regular className={styles.attentionIcon} aria-hidden />
            <div className={styles.stack}>
              <Body1Strong>{`${who} to continue “${job?.title ?? 'this job'}”`}</Body1Strong>
              <Body1 className={styles.secondary}>{state.message} Xomoni continues by itself once you’re done.</Body1>
            </div>
          </div>
          <div className={styles.actions}>
            {state.need === 'hidden' && !sharing && (
              <Button size="sm" variant="primary" icon={<EyeOff16Regular />} onClick={() => void runHidden()}>
                Run hidden
              </Button>
            )}
            <Button
              size="sm"
              variant={state.need === 'hidden' && !sharing ? 'secondary' : 'primary'}
              icon={<Open16Regular />}
              onClick={() => void workerTab.focus().catch((e: unknown) => toast(errorMessage(e), 'critical'))}
            >
              Open X window
            </Button>
            <Button size="sm" icon={<Pause16Regular />} onClick={() => runner.pause()}>
              Pause
            </Button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <section aria-label="Running job" className={styles.banner}>
      <div className={styles.bannerRow}>
        <div className={styles.bannerText}>
          <Pulse20Regular className={styles.bannerIcon} aria-hidden />
          <Body1Strong className={styles.noShrink}>{job?.title ?? 'Job running'}</Body1Strong>
          <Body1 className={mergeClasses(styles.truncate, styles.secondary)}>
            {sharing
              ? '· Running hidden: the X window may be minimized or covered. Keep this tab open (minimizing it is fine).'
              : '· Keep this tab open (minimizing it is fine), and part of the X window on screen: not minimized or fully covered. Or run it hidden.'}
          </Body1>
        </div>
        <div className={styles.actions}>
          {sharing ? (
            <Button size="sm" icon={<Eye16Regular />} onClick={() => tabShare.stop()}>
              Stop running hidden
            </Button>
          ) : (
            <Button size="sm" icon={<EyeOff16Regular />} onClick={() => void runHidden()}>
              Run hidden
            </Button>
          )}
          <Button
            size="sm"
            icon={<Pause16Regular />}
            onClick={() => runner.pause()}
            disabled={state.status === 'stopping'}
          >
            {state.status === 'stopping' ? 'Stopping…' : 'Pause'}
          </Button>
        </div>
      </div>
    </section>
  );
}

/** The toasts, newest last, in the bottom-right corner; a polite live region, so screen readers read them out. */
function Toasts() {
  const styles = useStyles();
  const list = useToasts();
  return (
    <div className={styles.toasts} aria-live="polite">
      <MessageBarGroup animate="both" className={styles.toastGroup}>
        {list.map((t) => (
          <MessageBar
            key={t.id}
            intent={TOAST_INTENT[t.tone]}
            layout="multiline"
            className={mergeClasses(styles.toast, t.tone === 'neutral' && styles.toastNeutral)}
            data-tone={t.tone}
          >
            <MessageBarBody>{t.text}</MessageBarBody>
          </MessageBar>
        ))}
      </MessageBarGroup>
    </div>
  );
}
