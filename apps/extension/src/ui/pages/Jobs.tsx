import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, ListChecks, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { db } from '../../shared/db';
import type { Job } from '../../shared/types';
import type { PageProps } from '../navigation';
import { JobCard } from '../components/JobCard';
import { LogList } from '../components/LogList';
import { Button, Card, EmptyState, PageHeader, Segmented, cx } from '../components/ui';

const OPEN_STATES = new Set(['queued', 'running', 'waiting', 'paused', 'blocked', 'failed']);

/** The account's jobs, newest first: open ones by default, or all. Each job can show its last 100 log entries. */
export function JobsPage({ account, navigate }: PageProps) {
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const jobs = useLiveQuery(
    () => db.jobs.where('accountId').equals(account.id).reverse().sortBy('createdAt'),
    [account.id],
  );
  const shown = jobs?.filter((j) => filter === 'all' || OPEN_STATES.has(j.state));

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Cleanups and scans. Jobs are resumable — pausing, closing the browser or a safety stop never loses progress."
        actions={
          <Button variant="primary" icon={<Sparkles size={15} />} onClick={() => navigate('cleanup')}>
            New cleanup
          </Button>
        }
      />
      <div className="mb-4">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>
      {shown && !shown.length ? (
        <Card>
          <EmptyState
            icon={<ListChecks size={18} />}
            title={filter === 'open' ? 'No open jobs' : 'No jobs yet'}
            body="Create a cleanup, or scan your account from the Inventory page."
            action={
              <Button size="sm" onClick={() => navigate('cleanup')}>
                New cleanup
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {shown?.map((job) => (
            <JobWithLog key={job.id} job={job} />
          ))}
        </div>
      )}
    </>
  );
}

function JobWithLog({ job }: { job: Job }) {
  const [open, setOpen] = useState(false);
  const logs = useLiveQuery(
    async () => (open ? await db.logs.where('jobId').equals(job.id).reverse().limit(100).toArray() : undefined),
    [open, job.id],
  );
  return (
    <div>
      <JobCard job={job} />
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="mt-1 ml-5 inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
      >
        <ChevronDown size={13} className={cx('transition-transform', open && 'rotate-180')} />
        {open ? 'Hide log' : 'Show log'}
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-line bg-surface px-5 py-1">
          {logs?.length ? (
            <LogList entries={logs} absolute />
          ) : (
            <p className="py-3 text-xs text-muted">No entries yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
