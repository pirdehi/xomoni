import { Tab, TabList, makeStyles, tokens } from '@fluentui/react-components';
import { Braces20Regular, DocumentTable20Regular, History20Regular, Sparkle20Regular } from '@fluentui/react-icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { activityCsv, activityJson } from '../../shared/activity-log';
import { db } from '../../shared/db';
import type { Account, LogEntry } from '../../shared/types';
import type { PageProps } from '../navigation';
import { LogList } from '../components/LogList';
import { Button, Card, EmptyState, PageHeader, Segmented } from '../components/ui';
import { downloadFile, toDateInput } from '../format';
import { JobsPanel } from './Jobs';

type Level = 'all' | 'success' | 'problems';

/** The two parts of Activity (#202): the jobs, and the log of every action. */
export type ActivityTab = 'jobs' | 'log';

const useStyles = makeStyles({
  tabs: { marginBottom: tokens.spacingVerticalL },
  filter: { marginBottom: tokens.spacingVerticalL },
  list: { padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalXL}` },
  more: {
    display: 'flex',
    justifyContent: 'center',
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalXL}`,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
});

const matches = (level: Level) => (e: LogEntry) =>
  level === 'all' ? true : level === 'success' ? e.level === 'success' : e.level === 'warn' || e.level === 'error';

/**
 * Activity (#202): what Xomoni is doing and did, in one place, with two tabs. *Jobs* lists the account's jobs (open
 * ones by default) and *Log* every action, skip and safety stop. The tab is part of the address (`#/jobs`,
 * `#/activity`), so links, notifications and the Back button land on the right one.
 */
export function ActivityPage({
  account,
  navigate,
  tab,
}: Pick<PageProps, 'account' | 'navigate'> & { tab: ActivityTab }) {
  const styles = useStyles();
  return (
    <>
      <PageHeader
        title="Activity"
        description="Your jobs, and everything Xomoni did on X. Jobs never lose progress: pausing, closing the browser or a safety stop only holds them."
        actions={
          tab === 'jobs' ? (
            <Button variant="primary" icon={<Sparkle20Regular />} onClick={() => navigate('cleanup')}>
              New cleanup
            </Button>
          ) : (
            <LogExports account={account} />
          )
        }
      />
      <TabList
        className={styles.tabs}
        selectedValue={tab}
        onTabSelect={(_, data) => navigate(data.value === 'jobs' ? 'jobs' : 'activity')}
      >
        <Tab value="jobs">Jobs</Tab>
        <Tab value="log">Log</Tab>
      </TabList>
      {tab === 'jobs' ? <JobsPanel account={account} navigate={navigate} /> : <LogPanel account={account} />}
    </>
  );
}

/** The log's two exports, which always hold every entry, whatever the filter, so a person can audit it (#34). */
function LogExports({ account }: { account: Account }) {
  const exportLog = async (format: 'csv' | 'json') => {
    const all = await db.logs.where('[accountId+ts]').between([account.id, 0], [account.id, Infinity]).toArray();
    const name = `xomoni-activity-${account.handle}-${toDateInput(Date.now())}.${format}`;
    if (format === 'csv') downloadFile(name, activityCsv(all), 'text/csv');
    else downloadFile(name, activityJson(account, all));
  };
  return (
    <>
      <Button icon={<DocumentTable20Regular />} onClick={() => void exportLog('csv')}>
        Export CSV
      </Button>
      <Button icon={<Braces20Regular />} onClick={() => void exportLog('json')}>
        Export JSON
      </Button>
    </>
  );
}

/** The account's log, newest first, filterable by level; 100 entries at first, then 200 more at a time. */
function LogPanel({ account }: { account: Account }) {
  const styles = useStyles();
  const [level, setLevel] = useState<Level>('all');
  const [limit, setLimit] = useState(100);
  const entries = useLiveQuery(
    () =>
      db.logs
        .where('[accountId+ts]')
        .between([account.id, 0], [account.id, Infinity])
        .reverse()
        .filter(matches(level))
        .limit(limit)
        .toArray(),
    [account.id, level, limit],
  );
  return (
    <>
      <div className={styles.filter}>
        <Segmented
          value={level}
          onChange={setLevel}
          options={[
            { value: 'all', label: 'All' },
            { value: 'success', label: 'Completed actions' },
            { value: 'problems', label: 'Warnings & errors' },
          ]}
        />
      </div>
      <Card padded={false}>
        {entries && !entries.length ? (
          <EmptyState
            icon={<History20Regular />}
            title="No activity"
            body="Actions appear here as soon as a job runs."
          />
        ) : (
          <div className={styles.list}>
            <LogList entries={entries ?? []} absolute />
          </div>
        )}
        {entries && entries.length >= limit && (
          <div className={styles.more}>
            <Button size="sm" variant="ghost" onClick={() => setLimit(limit + 200)}>
              Load more
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
