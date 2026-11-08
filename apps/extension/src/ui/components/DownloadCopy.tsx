import { Caption1, Checkbox, Input, Radio, RadioGroup, makeStyles, tokens } from '@fluentui/react-components';
import { ArrowDownload16Regular, ErrorCircle16Regular } from '@fluentui/react-icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, useId, useState } from 'react';
import { ARCHIVE_KINDS, type ArchiveKind, archiveHtml, archiveItems, archiveJson } from '../../shared/backup';
import { db } from '../../shared/db';
import type { Account, DateRange, Item } from '../../shared/types';
import { KIND_PLURAL, downloadFile, fmtDate, fmtNumber, fromDateInput, toDateInput } from '../format';
import { Button, Field, Modal, Segmented } from './ui';

/** X's launch day, the earliest date an account can have posts from. */
const FIRST_DAY = '2006-03-21';

/** The dates a copy covers: everything, the last 12 months, this calendar year, or dates the person picks. */
export type Span = 'all' | 'twelve' | 'year' | 'custom';

const SPANS: { value: Span; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'twelve', label: 'Last 12 months' },
  { value: 'year', label: 'This year' },
  { value: 'custom', label: 'Choose dates' },
];

const useStyles = makeStyles({
  form: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalL },
  dates: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: tokens.spacingHorizontalM,
  },
  control: { width: '100%' },
  kinds: { display: 'flex', flexWrap: 'wrap', columnGap: tokens.spacingHorizontalL },
  problem: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    margin: 0,
    color: tokens.colorStatusDangerForeground1,
  },
  summary: { margin: 0, color: tokens.colorNeutralForeground2 },
  group: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalXS },
  groupLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
});

/**
 * A labelled group of controls. Unlike `Field`, which is a `<label>` and would name every button inside it with all
 * of its text, the group's name comes from its heading and each control keeps its own.
 */
function Group({ label, children }: { label: string; children: ReactNode }) {
  const styles = useStyles();
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className={styles.group}>
      <span id={id} className={styles.groupLabel}>
        {label}
      </span>
      {children}
    </div>
  );
}

/** Local midnight of the day after `ms`, so the range includes the whole "to" day even across a DST change. */
function nextDay(ms: number) {
  const d = new Date(ms);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** The first and last day (`YYYY-MM-DD`) a span covers, `today` being its last unless the person picked dates. */
export function spanDays(
  span: Span,
  first: string,
  today: string,
  picked: { from: string; to: string },
): { from: string; to: string } {
  const now = fromDateInput(today) ?? Date.now();
  switch (span) {
    case 'all':
      return { from: first, to: today };
    case 'twelve': {
      const start = new Date(now);
      start.setFullYear(start.getFullYear() - 1);
      start.setDate(start.getDate() + 1);
      const from = toDateInput(start.getTime());
      return { from: from < first ? first : from, to: today };
    }
    case 'year': {
      const from = `${today.slice(0, 4)}-01-01`;
      return { from: from < first ? first : from, to: today };
    }
    case 'custom':
      return picked;
  }
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
 * *Download a copy* (#185): the posts, replies and reposts of a span of dates, as a page that opens in any browser
 * (HTML, built by `shared/backup.ts`) or as JSON. The dates are chosen here, when the copy is made, not before
 * reading X. The file is built on this computer and nothing on X changes.
 */
export function DownloadCopyDialog({
  account,
  open,
  onClose,
}: {
  account: Account;
  open: boolean;
  onClose: () => void;
}) {
  const styles = useStyles();
  const [today] = useState(() => toDateInput(Date.now()));
  const first = account.createdAt ? toDateInput(account.createdAt) : FIRST_DAY;
  const [span, setSpan] = useState<Span>('all');
  const [picked, setPicked] = useState({ from: first, to: today });
  const [kinds, setKinds] = useState<ArchiveKind[]>([...ARCHIVE_KINDS]);
  const [format, setFormat] = useState<'html' | 'json'>('html');

  const { from, to } = spanDays(span, first, today, picked);
  const start = fromDateInput(from);
  const end = fromDateInput(to);
  const range: DateRange | null =
    start != null && end != null && start <= end ? { after: start, before: nextDay(end) } : null;
  const items = useLiveQuery(
    () => (open && range ? loadRange(account.id, range, ARCHIVE_KINDS) : Promise.resolve([] as Item[])),
    [open, account.id, range?.after, range?.before],
  );
  const count = (kind: ArchiveKind) => items?.filter((i) => i.kind === kind).length ?? 0;
  const chosen = items?.filter((i) => (kinds as readonly string[]).includes(i.kind)) ?? [];

  const toggle = (kind: ArchiveKind, on: boolean) =>
    setKinds((list) => ARCHIVE_KINDS.filter((k) => (k === kind ? on : list.includes(k))));

  const download = () => {
    if (!range || !chosen.length) return;
    const name = `xomoni-${account.handle}-${from}-to-${to}.${format}`;
    if (format === 'html') downloadFile(name, archiveHtml(account, range, chosen, fmtDate), 'text/html');
    else downloadFile(name, archiveJson(account, range, chosen));
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Download a copy"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon={<ArrowDownload16Regular />}
            disabled={!range || !chosen.length}
            onClick={download}
          >
            Download
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <Group label="Dates">
          <Segmented value={span} onChange={setSpan} options={SPANS} />
        </Group>
        {span === 'custom' && (
          <div className={styles.dates}>
            <Field label="From">
              <Input
                type="date"
                className={styles.control}
                value={picked.from}
                max={picked.to}
                onChange={(_, data) => setPicked((p) => ({ ...p, from: data.value }))}
              />
            </Field>
            <Field label="To (inclusive)">
              <Input
                type="date"
                className={styles.control}
                value={picked.to}
                min={picked.from}
                max={today}
                onChange={(_, data) => setPicked((p) => ({ ...p, to: data.value }))}
              />
            </Field>
          </div>
        )}
        {!range && (
          <Caption1 as="p" className={styles.problem}>
            <ErrorCircle16Regular aria-hidden />
            Pick a start date on or before the end date.
          </Caption1>
        )}
        <Group label="Include">
          <div className={styles.kinds}>
            {ARCHIVE_KINDS.map((kind) => (
              <Checkbox
                key={kind}
                checked={kinds.includes(kind)}
                onChange={(_, data) => toggle(kind, data.checked === true)}
                label={`${KIND_PLURAL[kind]} (${fmtNumber(count(kind))})`}
              />
            ))}
          </div>
        </Group>
        <Group label="Format">
          <RadioGroup
            aria-label="Format"
            value={format}
            onChange={(_, data) => setFormat(data.value === 'json' ? 'json' : 'html')}
          >
            <Radio value="html" label="A page you can open in any browser (HTML)" />
            <Radio value="json" label="Data for other tools (JSON)" />
          </RadioGroup>
        </Group>
        <Caption1 as="p" className={styles.summary} role="status">
          {range
            ? `${fmtNumber(chosen.length)} items from ${fmtDate(range.after)} to ${fmtDate(range.before - 1)}.`
            : 'No dates yet.'}{' '}
          Text and links only. Posts Xomoni deleted stay in, marked as deleted.
        </Caption1>
      </div>
    </Modal>
  );
}
