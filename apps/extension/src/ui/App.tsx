import {
  Activity,
  Archive,
  BellRing,
  CircleCheck,
  Database,
  ExternalLink,
  History,
  LayoutDashboard,
  ListChecks,
  LoaderCircle,
  Pause,
  Settings as SettingsIcon,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { type ComponentType, useEffect, useState } from 'react';
import { runner } from '../engine/runner';
import { workerTab } from '../engine/worker-tab';
import { db } from '../shared/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, cx } from './components/ui';
import { ConsentDialog } from './components/ConsentDialog';
import { type WorkerStatus, toast, useActiveAccount, useRunner, useToasts, useWorkerStatus } from './hooks';
import { ActivityPage } from './pages/Activity';
import { ArchivePage } from './pages/Archive';
import { CleanupPage } from './pages/Cleanup';
import { InventoryPage } from './pages/Inventory';
import { JobsPage } from './pages/Jobs';
import { OverviewPage } from './pages/Overview';
import { SettingsPage } from './pages/Settings';
import type { Account } from '../shared/types';
import type { PageId, PageProps } from './navigation';

const NAV: { id: PageId; label: string; icon: ComponentType<{ size?: number }> }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'cleanup', label: 'Cleanup', icon: Sparkles },
  { id: 'archive', label: 'Archive', icon: Archive },
  { id: 'inventory', label: 'Inventory', icon: Database },
  { id: 'jobs', label: 'Jobs', icon: ListChecks },
  { id: 'activity', label: 'Activity log', icon: History },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

function useHashRoute(): [PageId, (p: PageId) => void] {
  const read = () => {
    const id = location.hash.replace(/^#\/?/, '') as PageId;
    return NAV.some((n) => n.id === id) ? id : 'overview';
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
 * The dashboard shell: sidebar with worker status, the running-job banner, the current page and
 * toasts. Pages are addressed by the URL hash (`#/jobs`). Until an X account is known, only the
 * onboarding view is shown, whatever the hash says.
 */
export function App() {
  const [page, navigate] = useHashRoute();
  const account = useActiveAccount();
  const worker = useWorkerStatus();

  return (
    <div className="flex h-full">
      <Sidebar page={page} navigate={navigate} account={account ?? null} worker={worker} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <RunnerBanner />
        <div className="mx-auto max-w-6xl px-8 py-8">
          {account === undefined ? null : !account ? (
            <OverviewPage account={null} worker={worker} navigate={navigate} />
          ) : (
            <PageSwitch page={page} account={account} worker={worker} navigate={navigate} />
          )}
        </div>
      </main>
      <Toasts />
      <ConsentDialog />
    </div>
  );
}

function PageSwitch({ page, ...props }: PageProps & { page: PageId }) {
  switch (page) {
    case 'cleanup':
      return <CleanupPage {...props} />;
    case 'archive':
      return <ArchivePage {...props} />;
    case 'inventory':
      return <InventoryPage {...props} />;
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
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <img src="icons/icon48.png" alt="" className="size-7 rounded-lg" />
        <div>
          <div className="text-sm font-semibold tracking-tight">Xomoni</div>
          <div className="text-[11px] text-muted">X account manager</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 px-3">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => navigate(id)}
            className={cx(
              'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
              page === id ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
            )}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </nav>
      <div className="space-y-3 border-t border-line p-4">
        <WorkerChip worker={worker} />
        {account && (
          <div className="flex items-center gap-2.5">
            {account.avatar ? (
              <img src={account.avatar} alt="" className="size-8 rounded-full" />
            ) : (
              <div className="flex size-8 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-ink-2">
                {(account.name || account.handle || '?').slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{account.name || account.handle}</div>
              <div className="truncate text-xs text-muted">@{account.handle}</div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function WorkerChip({ worker }: { worker: WorkerStatus }) {
  const { open, info } = worker;
  let text = 'X worker not open';
  let icon = <span className="size-2 rounded-full bg-muted" />;
  if (open && !info) {
    text = 'X worker loading…';
    icon = <LoaderCircle size={12} className="animate-spin text-ink-2" />;
  } else if (info?.locked) {
    text = 'X account locked';
    icon = <TriangleAlert size={12} className="text-critical" />;
  } else if (info && !info.loggedIn) {
    text = 'Log in to X in the worker';
    icon = <TriangleAlert size={12} className="text-serious" />;
  } else if (info?.challenge) {
    text = 'X wants you to confirm it’s you';
    icon = <TriangleAlert size={12} className="text-serious" />;
  } else if (info?.hidden) {
    text = 'Keep the X worker visible';
    icon = <TriangleAlert size={12} className="text-serious" />;
  } else if (info) {
    text = 'X worker connected';
    icon = <CircleCheck size={12} className="text-good" />;
  }
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-2">
      <span className="flex min-w-0 items-center gap-2 text-xs text-ink-2">
        {icon}
        <span className="truncate">{text}</span>
      </span>
      <button
        type="button"
        title={open ? 'Show the X worker window' : 'Open the X worker window'}
        onClick={() =>
          (open ? workerTab.focus() : workerTab.open()).catch((e) => toast(String(e?.message ?? e), 'critical'))
        }
        className="shrink-0 rounded p-1 text-muted hover:bg-surface hover:text-ink"
      >
        <ExternalLink size={13} />
      </button>
    </div>
  );
}

function RunnerBanner() {
  const state = useRunner();
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
    return (
      <div role="alert" className="sticky top-0 z-30 border-b border-line bg-surface">
        <span className="absolute inset-y-0 left-0 w-1 bg-serious" />
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-8 py-3">
          <div className="flex min-w-0 items-start gap-2.5 text-sm">
            <BellRing size={16} className="mt-0.5 shrink-0 text-serious" />
            <div className="min-w-0">
              <div className="font-medium">X needs you to continue “{job?.title ?? 'this job'}”</div>
              <div className="text-ink-2">{state.message} Xomoni continues by itself once you’re done.</div>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              variant="primary"
              icon={<ExternalLink size={13} />}
              onClick={() => workerTab.focus().catch((e) => toast(String(e?.message ?? e), 'critical'))}
            >
              Open X window
            </Button>
            <Button size="sm" icon={<Pause size={13} />} onClick={() => runner.pause()}>
              Pause
            </Button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-8 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5 text-sm">
          <Activity size={15} className="shrink-0 text-accent" />
          <span className="shrink-0 font-medium">{job?.title ?? 'Job running'}</span>
          <span className="truncate text-ink-2">· Keep this tab and the X worker window open (not minimized).</span>
        </div>
        <Button
          size="sm"
          icon={<Pause size={13} />}
          onClick={() => runner.pause()}
          disabled={state.status === 'stopping'}
        >
          {state.status === 'stopping' ? 'Stopping…' : 'Pause'}
        </Button>
      </div>
    </div>
  );
}

function Toasts() {
  const list = useToasts();
  return (
    <div className="pointer-events-none fixed right-5 bottom-5 z-50 flex w-80 flex-col gap-2">
      {list.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line bg-surface px-3.5 py-3 text-sm shadow-lg"
        >
          {t.tone === 'critical' ? (
            <TriangleAlert size={15} className="mt-0.5 shrink-0 text-critical" />
          ) : (
            <CircleCheck size={15} className="mt-0.5 shrink-0 text-good" />
          )}
          <span className="text-ink">{t.text}</span>
        </div>
      ))}
    </div>
  );
}
