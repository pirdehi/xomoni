import { Button as FluentButton, Caption1, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { ChevronDown16Regular, Sparkle20Regular, TaskListLtr20Regular } from '@fluentui/react-icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { useId, useState } from 'react';
import { db } from '../../shared/db';
import type { Job } from '../../shared/types';
import type { PageProps } from '../navigation';
import { JobCard } from '../components/JobCard';
import { LogList } from '../components/LogList';
import { Button, Card, EmptyState, PageHeader, Segmented } from '../components/ui';

const OPEN_STATES = new Set(['queued', 'running', 'waiting', 'paused', 'blocked', 'failed']);

const useStyles = makeStyles({
  filter: { marginBottom: tokens.spacingVerticalL },
  list: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
  job: { display: 'flex', flexDirection: 'column' },
  logToggle: {
    alignSelf: 'flex-start',
    marginTop: tokens.spacingVerticalXS,
    marginLeft: tokens.spacingHorizontalM,
    fontWeight: tokens.fontWeightRegular,
    color: tokens.colorNeutralForeground3,
  },
  chevron: {
    transitionProperty: 'transform',
    transitionDuration: tokens.durationNormal,
    '@media (prefers-reduced-motion: reduce)': { transitionDuration: '0s' },
  },
  chevronOpen: { transform: 'rotate(180deg)' },
  log: {
    marginTop: tokens.spacingVerticalXS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalXL}`,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusXLarge,
  },
  noEntries: { display: 'block', paddingBlock: tokens.spacingVerticalM, color: tokens.colorNeutralForeground3 },
});

/** The account's jobs, newest first: open ones by default, or all. Each job can show its last 100 log entries. */
export function JobsPage({ account, navigate }: PageProps) {
  const styles = useStyles();
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
          <Button variant="primary" icon={<Sparkle20Regular />} onClick={() => navigate('cleanup')}>
            New cleanup
          </Button>
        }
      />
      <div className={styles.filter}>
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
            icon={<TaskListLtr20Regular />}
            title={filter === 'open' ? 'No open jobs' : 'No jobs yet'}
            body="Create a cleanup, or complete your copy from the Library."
            action={
              <Button size="sm" onClick={() => navigate('cleanup')}>
                New cleanup
              </Button>
            }
          />
        </Card>
      ) : (
        <div className={styles.list}>
          {shown?.map((job) => (
            <JobWithLog key={job.id} job={job} />
          ))}
        </div>
      )}
    </>
  );
}

/** A job card with a "Show log" toggle (`aria-expanded`) under it; the log is read only while it is shown. */
function JobWithLog({ job }: { job: Job }) {
  const styles = useStyles();
  const logId = useId();
  const [open, setOpen] = useState(false);
  const logs = useLiveQuery(
    async () => (open ? await db.logs.where('jobId').equals(job.id).reverse().limit(100).toArray() : undefined),
    [open, job.id],
  );
  return (
    <div className={styles.job}>
      <JobCard job={job} />
      <FluentButton
        appearance="transparent"
        size="small"
        icon={<ChevronDown16Regular className={mergeClasses(styles.chevron, open && styles.chevronOpen)} />}
        aria-expanded={open}
        aria-controls={open ? logId : undefined}
        onClick={() => setOpen(!open)}
        className={styles.logToggle}
      >
        {open ? 'Hide log' : 'Show log'}
      </FluentButton>
      {open && (
        <div id={logId} className={styles.log}>
          {logs?.length ? (
            <LogList entries={logs} absolute />
          ) : (
            <Caption1 className={styles.noEntries}>No entries yet.</Caption1>
          )}
        </div>
      )}
    </div>
  );
}
