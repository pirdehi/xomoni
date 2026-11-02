import { useLiveQuery } from 'dexie-react-hooks';
import {
  CircleCheck,
  ExternalLink,
  Heart,
  LoaderCircle,
  Lock,
  MessageSquareReply,
  Repeat2,
  ShieldCheck,
  Sparkles,
  SquarePen,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { workerTab } from '../../engine/worker-tab';
import { db } from '../../shared/db';
import type { Account } from '../../shared/types';
import type { PageId } from '../navigation';
import { ActivityChart } from '../components/ActivityChart';
import { JobCard } from '../components/JobCard';
import { LimitsPanel } from '../components/LimitsPanel';
import { LogList } from '../components/LogList';
import { Button, Card, EmptyState, PageHeader, StatTile, cx } from '../components/ui';
import { errorMessage, fmtCompact, fmtNumber } from '../format';
import { type WorkerStatus, toast } from '../hooks';
import { useKindCounts } from '../queries';

/**
 * The home page. With no known account (`account` is null) it shows onboarding: open the worker
 * window and log in to X there. Otherwise it shows counts, the yearly chart, limits, open jobs and
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
          <Button variant="primary" icon={<Sparkles size={15} />} onClick={() => navigate('cleanup')}>
            New cleanup
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col justify-between rounded-xl border border-line bg-surface p-5">
          <div>
            <div className="text-xs font-medium text-ink-2">Removed by Xomoni</div>
            <div className="mt-2 text-5xl font-semibold tracking-tight">{fmtNumber(removed)}</div>
            <div className="mt-1 text-xs text-ink-2">posts, replies, reposts and likes</div>
          </div>
          {account.postsCount != null && (
            <div className="mt-4 border-t border-line pt-3 text-xs text-ink-2">
              X shows <span className="font-medium text-ink">{fmtNumber(account.postsCount)}</span> posts on your
              profile
              {account.likesCount != null && (
                <>
                  {' '}
                  and <span className="font-medium text-ink">{fmtNumber(account.likesCount)}</span> likes
                </>
              )}
              .
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 lg:col-span-2">
          <StatTile
            label="Posts"
            icon={<SquarePen size={14} />}
            value={fmtCompact(counts?.post.present ?? 0)}
            sub={`${fmtNumber(counts?.post.deleted ?? 0)} removed`}
          />
          <StatTile
            label="Replies"
            icon={<MessageSquareReply size={14} />}
            value={fmtCompact(counts?.reply.present ?? 0)}
            sub={`${fmtNumber(counts?.reply.deleted ?? 0)} removed`}
          />
          <StatTile
            label="Reposts"
            icon={<Repeat2 size={14} />}
            value={fmtCompact(counts?.repost.present ?? 0)}
            sub={`${fmtNumber(counts?.repost.deleted ?? 0)} undone`}
          />
          <StatTile
            label="Likes"
            icon={<Heart size={14} />}
            value={fmtCompact(counts?.like.present ?? 0)}
            sub={`${fmtNumber(counts?.like.deleted ?? 0)} removed`}
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ActivityChart accountId={account.id} />
        </div>
        <LimitsPanel accountId={account.id} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
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
              icon={<Sparkles size={18} />}
              title="No jobs in progress"
              body="Start a cleanup to remove old posts, replies, reposts or likes."
              action={
                <Button size="sm" onClick={() => navigate('cleanup')}>
                  New cleanup
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
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
              icon={<CircleCheck size={18} />}
              title="Nothing yet"
              body="Every action Xomoni takes is recorded here."
            />
          ) : (
            <div className="-my-2.5">
              <LogList entries={logs} />
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function Onboarding({ worker }: { worker: WorkerStatus }) {
  const open = () =>
    void (worker.open ? workerTab.focus() : workerTab.open()).catch((e: unknown) => toast(errorMessage(e), 'critical'));
  const loggedIn = !!worker.info?.loggedIn;
  return (
    <div className="mx-auto max-w-2xl pt-6">
      <div className="mb-8 text-center">
        <img src="icons/icon128.png" alt="" className="mx-auto mb-4 size-14 rounded-2xl" />
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to Xomoni</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-2">
          Clean up your X account — old posts, replies, reposts and likes — without API keys, at a pace X accepts.
        </p>
      </div>
      <Card>
        <ol className="space-y-5">
          <Step n={1} done={worker.open} title="Open the X worker window">
            A normal Chrome window on x.com that Xomoni drives for you, like a careful assistant clicking the buttons.
            <div className="mt-3">
              <Button variant="primary" size="sm" icon={<ExternalLink size={13} />} onClick={open}>
                {worker.open ? 'Show X worker' : 'Open X worker'}
              </Button>
            </div>
          </Step>
          <Step n={2} done={loggedIn} title="Log in to X there">
            Use your normal login, including 2FA. Xomoni never sees your password or session cookies.
          </Step>
          <Step n={3} done={false} active={loggedIn} title="Xomoni detects your account">
            {loggedIn ? (
              <span className="inline-flex items-center gap-1.5">
                <LoaderCircle size={12} className="animate-spin" /> Reading your profile…
              </span>
            ) : (
              'Your dashboard appears here as soon as you are signed in.'
            )}
          </Step>
        </ol>
      </Card>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Assurance icon={<Lock size={15} />} title="Private by design">
          No servers. Your data stays in this browser.
        </Assurance>
        <Assurance icon={<ShieldCheck size={15} />} title="Respects X limits">
          Human pacing, caps and automatic safety stops.
        </Assurance>
        <Assurance icon={<CircleCheck size={15} />} title="Verified actions">
          Counted only when X confirms them.
        </Assurance>
      </div>
    </div>
  );
}

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
  return (
    <li className="flex gap-4">
      <span
        className={cx(
          'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
          done ? 'bg-good text-white' : active ? 'bg-accent text-white' : 'bg-surface-2 text-ink-2',
        )}
      >
        {done ? <CircleCheck size={14} /> : n}
      </span>
      <div className="pt-0.5">
        <div className="text-sm font-medium text-ink">{title}</div>
        <div className="mt-1 text-xs text-ink-2">{children}</div>
      </div>
    </li>
  );
}

function Assurance({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-ink">
        <span className="text-accent">{icon}</span>
        {title}
      </div>
      <p className="text-xs text-ink-2">{children}</p>
    </div>
  );
}
