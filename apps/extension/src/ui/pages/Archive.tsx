import { Button as FluentButton, Caption1, Input, makeStyles, tokens } from '@fluentui/react-components';
import {
  Braces16Regular,
  DocumentGlobe16Regular,
  DocumentSearch16Regular,
  ErrorCircle16Regular,
  Info16Regular,
  Open16Regular,
} from '@fluentui/react-icons';
import { useLiveQuery } from 'dexie-react-hooks';
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

/** Two columns from this width up (Tailwind's former `sm`). */
const SM = '@media (min-width: 640px)';
/** The four cards in two columns from this width up (Tailwind's former `lg`). */
const LG = '@media (min-width: 1024px)';

const useStyles = makeStyles({
  layout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: tokens.spacingHorizontalL,
    [LG]: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  },
  dates: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: tokens.spacingHorizontalL,
    [SM]: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  },
  control: { width: '100%' },
  kinds: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalM,
    marginTop: tokens.spacingVerticalL,
  },
  problem: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    margin: `${tokens.spacingVerticalM} 0 0`,
    color: tokens.colorStatusDangerForeground1,
  },
  problemIcon: { flexShrink: 0 },
  actions: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
  note: { display: 'block', margin: `${tokens.spacingVerticalM} 0 0`, color: tokens.colorNeutralForeground2 },
  spaced: { marginTop: tokens.spacingVerticalL },
  link: { whiteSpace: 'nowrap' },
});

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
 * saved on this computer. Nothing on this page changes anything on X. Drawn with Fluent UI (ADR-0019); the
 * request for X's own archive is a link styled as a button, so it still opens X in a new tab.
 */
export function ArchivePage({ account, navigate }: PageProps) {
  const styles = useStyles();
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
      <div className={styles.layout}>
        <Card
          title="1 · Choose the dates"
          subtitle="The archive holds everything posted from the first day to the last."
        >
          <div className={styles.dates}>
            <Field label="From">
              <Input
                type="date"
                className={styles.control}
                value={from}
                max={to}
                onChange={(_, data) => setFrom(data.value)}
              />
            </Field>
            <Field label="To (inclusive)">
              <Input
                type="date"
                className={styles.control}
                value={to}
                min={from}
                max={today}
                onChange={(_, data) => setTo(data.value)}
              />
            </Field>
          </div>
          <div className={styles.kinds}>
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
          {!range && (
            <Caption1 as="p" className={styles.problem} data-tone="critical">
              <ErrorCircle16Regular className={styles.problemIcon} />
              Pick a start date on or before the end date.
            </Caption1>
          )}
        </Card>

        <Card
          title="2 · Read this range from X"
          subtitle="Scrolls your replies timeline and searches X for your posts in these dates. Nothing is changed."
        >
          <Button
            variant="primary"
            icon={<DocumentSearch16Regular />}
            disabled={!range || run.status !== 'idle'}
            onClick={() => void readFromX()}
          >
            Read from X
          </Button>
          <Caption1 as="p" className={styles.note}>
            Runs as a job at the same careful pace as everything else, within your active hours. Your posts are stored
            only on this computer. You can download the archive at any time; it holds what Xomoni has seen so far, from
            X and from your imported X archive.
          </Caption1>
          <div className={styles.spaced}>
            <Callout tone="accent" icon={<Info16Regular />} title="How complete is it?">
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
          <div className={styles.actions}>
            <Button
              variant="primary"
              icon={<DocumentGlobe16Regular />}
              disabled={!items?.length}
              onClick={() => download('html')}
            >
              Download as a page (HTML)
            </Button>
            <Button icon={<Braces16Regular />} disabled={!items?.length} onClick={() => download('json')}>
              Download as data (JSON)
            </Button>
          </div>
          <Caption1 as="p" className={styles.note}>
            Text and links only. Posts Xomoni already deleted stay in the archive, marked as deleted.
          </Caption1>
        </Card>

        <Card
          title="Your official X archive"
          subtitle="X’s own copy of your whole account, including images, videos and likes. It can’t be limited to dates."
        >
          <div className={styles.actions}>
            {/* A real link (role "link"), so the browser opens X in a new tab; Fluent styles it as a button. */}
            <FluentButton
              as="a"
              href={X_ARCHIVE_URL}
              target="_blank"
              rel="noreferrer"
              icon={<Open16Regular />}
              className={styles.link}
            >
              Request it on X
            </FluentButton>
            <Button onClick={() => navigate('inventory')}>Import it when it arrives</Button>
          </div>
          <Caption1 as="p" className={styles.note}>
            X asks for your password and may send a code; you enter them on X, never in Xomoni. The archive takes 24 to
            72 hours.
          </Caption1>
        </Card>
      </div>
    </>
  );
}
