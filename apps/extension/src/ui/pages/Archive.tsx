import { useLiveQuery } from 'dexie-react-hooks';
import { ExternalLink, FileCode, FileJson, Info, ScanSearch } from 'lucide-react';
import { useState } from 'react';
import { createScanJob } from '../../engine/runner';
import { ARCHIVE_KINDS, type ArchiveKind, archiveHtml, archiveItems, archiveJson } from '../../shared/backup';
import { db } from '../../shared/db';
import type { DateRange, Item } from '../../shared/types';
import type { PageProps } from '../navigation';
import { Button, Callout, Card, Field, PageHeader, Toggle } from '../components/ui';
import { KIND_PLURAL, downloadFile, errorMessage, fmtDate, fmtNumber, fromDateInput, toDateInput } from '../format';
import { startJob, toast, useRunner } from '../hooks';

/** X's page for requesting the official archive. The person confirms it there with their password, never Xomoni. */
const X_ARCHIVE_URL = 'https://x.com/settings/download_your_data';

/** X's launch day, the earliest date an account can have posts from. */
const FIRST_DAY = '2006-03-21';

/** Local midnight of the day after `ms`, so the range includes the whole "to" day even across a DST change. */
function nextDay(ms: number) {
  const d = new Date(ms);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** The account's items of `kinds` created inside `range`, from the `[accountId+kind+createdAt]` index. */
async function loadRange(accountId: string, range: DateRange, kinds: readonly ArchiveKind[]): Promise<Item[]> {
  const lists = await Promise.all(
    kinds.map((kind) =>
      db.items
        .where('[accountId+kind+createdAt]')
        .between([accountId, kind, range.after], [accountId, kind, range.before], true, false)
        .toArray(),
    ),
  );
  return archiveItems(lists.flat(), range, kinds);
}

/**
 * The Archive page: pick a date range, read it from X with a scan job that only reads, and download the
 * posts, replies and reposts of that range as a readable HTML page or as JSON. The file is built here and
 * saved on this computer. Nothing on this page changes anything on X.
 */
export function ArchivePage({ account, navigate }: PageProps) {
  const run = useRunner();
  const [today] = useState(() => toDateInput(Date.now()));
  const [from, setFrom] = useState(account.createdAt ? toDateInput(account.createdAt) : FIRST_DAY);
  const [to, setTo] = useState(today);
  const [kinds, setKinds] = useState<ArchiveKind[]>([...ARCHIVE_KINDS]);

  const start = fromDateInput(from);
  const end = fromDateInput(to);
  const range: DateRange | null =
    start != null && end != null && start <= end ? { after: start, before: nextDay(end) } : null;
  const items = useLiveQuery(
    () => (range && kinds.length ? loadRange(account.id, range, kinds) : Promise.resolve([] as Item[])),
    [account.id, range?.after, range?.before, kinds.join()],
  );
  const count = (kind: ArchiveKind) => items?.filter((i) => i.kind === kind).length ?? 0;

  const toggle = (kind: ArchiveKind, on: boolean) =>
    setKinds((list) => ARCHIVE_KINDS.filter((k) => (k === kind ? on : list.includes(k))));

  const readFromX = async () => {
    if (!range) return;
    const title = `Archive: ${fmtDate(range.after)} – ${fmtDate(range.before - 1)}`;
    try {
      const job = await createScanJob(account.id, title, 'range', range);
      void startJob(job.id);
      navigate('jobs');
    } catch (err) {
      toast(`The archive job could not be saved: ${errorMessage(err)}`, 'critical');
    }
  };

  const fileName = (ext: string) => `xomoni-archive-${account.handle}-${from}-to-${to}.${ext}`;
  const download = (format: 'html' | 'json') => {
    if (!range || !items?.length) return;
    if (format === 'html') downloadFile(fileName('html'), archiveHtml(account, range, items, fmtDate), 'text/html');
    else downloadFile(fileName('json'), archiveJson(account, range, items));
  };

  return (
    <>
      <PageHeader
        title="Archive"
        description="Keep a copy of your posts, replies and reposts from a date range, as a page you can open in any browser."
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="1 · Choose the dates"
          subtitle="The archive holds everything posted from the first day to the last."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="From">
              <input type="date" className="field" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To (inclusive)">
              <input
                type="date"
                className="field"
                value={to}
                min={from}
                max={today}
                onChange={(e) => setTo(e.target.value)}
              />
            </Field>
          </div>
          <div className="mt-4 space-y-3">
            {ARCHIVE_KINDS.map((kind) => (
              <Toggle
                key={kind}
                checked={kinds.includes(kind)}
                onChange={(on) => toggle(kind, on)}
                label={KIND_PLURAL[kind]}
                description={`${fmtNumber(count(kind))} in this range so far`}
              />
            ))}
          </div>
          {!range && <p className="mt-3 text-xs text-critical">Pick a start date on or before the end date.</p>}
        </Card>

        <Card
          title="2 · Read this range from X"
          subtitle="Scrolls your replies timeline and searches X for your posts in these dates. Nothing is changed."
        >
          <Button
            variant="primary"
            icon={<ScanSearch size={14} />}
            disabled={!range || run.status !== 'idle'}
            onClick={() => void readFromX()}
          >
            Read from X
          </Button>
          <p className="mt-3 text-xs text-ink-2">
            Runs as a job at the same careful pace as everything else, within your active hours. Your posts are stored
            only on this computer. You can download the archive at any time; it holds what Xomoni has seen so far, from
            X and from your imported X archive.
          </p>
          <div className="mt-4">
            <Callout tone="accent" icon={<Info size={14} />} title="How complete is it?">
              X search may not show old posts that have no likes, and your profile shows only about your latest 3,200
              posts. For a complete copy with images and videos, also request your official X archive below and import
              it on the Inventory page.
            </Callout>
          </div>
        </Card>

        <Card
          title="3 · Download"
          subtitle={`${fmtNumber(items?.length ?? 0)} items from ${range ? fmtDate(range.after) : '—'} to ${range ? fmtDate(range.before - 1) : '—'}`}
        >
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              icon={<FileCode size={14} />}
              disabled={!items?.length}
              onClick={() => download('html')}
            >
              Download as a page (HTML)
            </Button>
            <Button icon={<FileJson size={14} />} disabled={!items?.length} onClick={() => download('json')}>
              Download as data (JSON)
            </Button>
          </div>
          <p className="mt-3 text-xs text-ink-2">
            Text and links only. Posts Xomoni already deleted stay in the archive, marked as deleted.
          </p>
        </Card>

        <Card
          title="Your official X archive"
          subtitle="X’s own copy of your whole account, including images, videos and likes. It can’t be limited to dates."
        >
          <div className="flex flex-wrap gap-2">
            <a
              href={X_ARCHIVE_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 text-sm font-medium whitespace-nowrap text-ink transition-colors hover:bg-surface-2"
            >
              <ExternalLink size={14} /> Request it on X
            </a>
            <Button onClick={() => navigate('inventory')}>Import it when it arrives</Button>
          </div>
          <p className="mt-3 text-xs text-ink-2">
            X asks for your password and may send a code; you enter them on X, never in Xomoni. The archive takes 24 to
            72 hours.
          </p>
        </Card>
      </div>
    </>
  );
}
