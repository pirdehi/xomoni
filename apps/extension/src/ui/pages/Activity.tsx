import { useLiveQuery } from 'dexie-react-hooks';
import { Download, History } from 'lucide-react';
import { useState } from 'react';
import { db } from '../../shared/db';
import type { LogEntry } from '../../shared/types';
import type { PageProps } from '../navigation';
import { LogList } from '../components/LogList';
import { Button, Card, EmptyState, PageHeader, Segmented } from '../components/ui';
import { downloadFile, toDateInput } from '../format';

type Level = 'all' | 'success' | 'problems';

const matches = (level: Level) => (e: LogEntry) =>
  level === 'all' ? true : level === 'success' ? e.level === 'success' : e.level === 'warn' || e.level === 'error';

function csvCell(v: string | number | null | undefined) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The account's activity log, newest first, filterable by level and loaded 100 entries at first,
 * then 200 more at a time. The CSV export always contains every entry, whatever the filter.
 */
export function ActivityPage({ account }: PageProps) {
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

  const exportCsv = async () => {
    const all = await db.logs.where('[accountId+ts]').between([account.id, 0], [account.id, Infinity]).toArray();
    const header = ['time', 'level', 'action', 'outcome', 'post_id', 'job_id', 'message'];
    const lines = all.map((e) =>
      [new Date(e.ts).toISOString(), e.level, e.action, e.outcome, e.targetId, e.jobId, e.message]
        .map(csvCell)
        .join(','),
    );
    downloadFile(`xomoni-activity-${toDateInput(Date.now())}.csv`, [header.join(','), ...lines].join('\n'), 'text/csv');
  };

  return (
    <>
      <PageHeader
        title="Activity log"
        description="Every action, skip and safety stop, with the post it touched."
        actions={
          <Button icon={<Download size={14} />} onClick={() => void exportCsv()}>
            Export CSV
          </Button>
        }
      />
      <div className="mb-4">
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
            icon={<History size={18} />}
            title="No activity"
            body="Actions appear here as soon as a job runs."
          />
        ) : (
          <div className="px-5 py-1">
            <LogList entries={entries ?? []} absolute />
          </div>
        )}
        {entries && entries.length >= limit && (
          <div className="border-t border-line px-5 py-3 text-center">
            <Button size="sm" variant="ghost" onClick={() => setLimit(limit + 200)}>
              Load more
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
