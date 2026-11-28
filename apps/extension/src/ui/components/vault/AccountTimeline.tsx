import { Body1, Caption1, Input, Select, Textarea, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import {
  Add16Regular,
  ArrowDownload16Regular,
  Archive16Regular,
  History24Regular,
  Note16Regular,
  ShieldError16Regular,
  StarEmphasis16Regular,
  Tag16Regular,
} from '@fluentui/react-icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, type SyntheticEvent, useId, useState } from 'react';
import {
  TIMELINE_PAGE,
  type TimelineEntry,
  type TimelineKind,
  VaultError,
  accountTimeline,
  addAccountEvent,
} from '../../../shared/vault/db';
import {
  ACCOUNT_EVENT_WORDS,
  type EventLook,
  PERSON_KINDS,
  SOURCE_WORDS,
  timelineCsv,
} from '../../../shared/vault/timeline';
import { EVENT_WORDS } from '../../../shared/vault/types';
import type { Account } from '../../../shared/types';
import { downloadFile, errorMessage } from '../../format';
import { toast } from '../../hooks';
import { Badge, Button, Card, EmptyState, Field } from '../ui';

const useStyles = makeStyles({
  toolbar: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalM, alignItems: 'flex-end' },
  month: {
    margin: `${tokens.spacingVerticalL} 0 ${tokens.spacingVerticalS}`,
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
  },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: tokens.spacingVerticalS },
  entry: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: tokens.spacingHorizontalM,
    padding: tokens.spacingVerticalS,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  icon: { color: tokens.colorNeutralForeground2, paddingTop: '2px' },
  head: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS, alignItems: 'center' },
  words: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: `${tokens.spacingVerticalXS} 0 0` },
  form: { display: 'grid', gap: tokens.spacingVerticalM, marginTop: tokens.spacingVerticalM, maxWidth: '36rem' },
  row: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalM },
  count: { color: tokens.colorNeutralForeground3 },
  over: { color: tokens.colorStatusDangerForeground1 },
  more: { marginTop: tokens.spacingVerticalM },
});

/** The icon of each kind of entry, by `EventLook.icon`. */
const ICONS: Record<EventLook['icon'], ReactNode> = {
  note: <Note16Regular aria-hidden />,
  premium: <StarEmphasis16Regular aria-hidden />,
  archive: <Archive16Regular aria-hidden />,
  label: <Tag16Regular aria-hidden />,
  risk: <ShieldError16Regular aria-hidden />,
};

/** What the filter offers: every kind, or one. */
const FILTERS: { value: 'all' | TimelineKind; label: string }[] = [
  { value: 'all', label: 'Everything' },
  ...(Object.entries(ACCOUNT_EVENT_WORDS) as [TimelineKind, EventLook][]).map(([value, look]) => ({
    value,
    label: look.label,
  })),
];

/** The month an entry falls in, in the person's time zone, as a heading says it: `November 2026`. */
const monthOf = (at: number) => new Date(at).toLocaleDateString('en', { year: 'numeric', month: 'long' });

/** Today in the person's time zone, as a date input takes it (`YYYY-MM-DD`). */
function today(): string {
  const d = new Date();
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Entries grouped by month, newest first, as they come. */
function byMonth(entries: readonly TimelineEntry[]): [string, TimelineEntry[]][] {
  const groups: [string, TimelineEntry[]][] = [];
  for (const entry of entries) {
    const month = monthOf(entry.at);
    const last = groups.at(-1);
    if (last?.[0] === month) last[1].push(entry);
    else groups.push([month, [entry]]);
  }
  return groups;
}

/** The form for an entry of the person's own: what, when, and a note of at most 500 characters. */
function AddEntry({ account, onDone }: { account: Account; onDone: () => void }) {
  const styles = useStyles();
  const [kind, setKind] = useState<(typeof PERSON_KINDS)[number]>('note');
  const [day, setDay] = useState(today);
  const [words, setWords] = useState('');
  const [saving, setSaving] = useState(false);
  const countId = useId();
  const over = words.length > EVENT_WORDS;
  const empty = kind === 'note' && !words.trim();

  const submit = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (over || empty || !day) return;
    setSaving(true);
    try {
      const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
      // Noon on that day, in the person's time zone: the day they picked, wherever they are.
      const at = Math.min(new Date(y, m - 1, d, 12).getTime(), Date.now());
      await addAccountEvent({
        accountId: account.id,
        kind,
        at,
        source: 'person',
        words: words.trim() || ACCOUNT_EVENT_WORDS[kind].label,
      });
      toast('Added to your timeline', 'good');
      onDone();
    } catch (err) {
      toast(err instanceof VaultError ? err.message : errorMessage(err), 'critical');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={styles.form} aria-label="Add an entry" onSubmit={(e) => void submit(e)}>
      <div className={styles.row}>
        <Field label="What">
          <Select value={kind} onChange={(_, data) => setKind(data.value as (typeof PERSON_KINDS)[number])}>
            {PERSON_KINDS.map((k) => (
              <option key={k} value={k}>
                {ACCOUNT_EVENT_WORDS[k].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="When">
          <Input type="date" value={day} max={today()} onChange={(_, data) => setDay(data.value)} required />
        </Field>
      </div>
      <Field label={kind === 'note' ? 'Note' : 'Note (optional)'}>
        <Textarea
          value={words}
          onChange={(_, data) => setWords(data.value)}
          resize="vertical"
          aria-describedby={countId}
          aria-invalid={over}
        />
      </Field>
      <Caption1 id={countId} className={mergeClasses(styles.count, over && styles.over)} aria-live="polite">
        {over
          ? `${String(words.length - EVENT_WORDS)} characters too many: a note holds ${String(EVENT_WORDS)}.`
          : `${String(words.length)} of ${String(EVENT_WORDS)} characters. Only you see it, on this computer.`}
      </Caption1>
      <div className={styles.row}>
        <Button type="submit" variant="primary" disabled={saving || over || empty || !day}>
          Add to timeline
        </Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

/**
 * The account's timeline (#425, ADR-0043): what happened to the account, newest first and grouped by month, 50 at a
 * time with *Show older*. It joins the person's notes, Xomoni's own entries (X Premium seen on or off, the archive asked
 * for and imported, X's labels) and the risk ladder's events, each with who said it. A filter keeps one kind; *Add an
 * entry* takes a note of at most 500 characters; *Export CSV* saves it as a spreadsheet can't run. Every word is shown
 * as text, never as HTML.
 */
export function AccountTimeline({ account }: { account: Account }) {
  const styles = useStyles();
  const [filter, setFilter] = useState<'all' | TimelineKind>('all');
  const [pages, setPages] = useState(1);
  const [adding, setAdding] = useState(false);
  const limit = pages * TIMELINE_PAGE;
  // An async querier keeps Dexie's zone across the helper's awaits, so the list follows every new entry (#459).
  const entries = useLiveQuery(
    async () => await accountTimeline(account.id, { limit: limit + 1, ...(filter !== 'all' && { kinds: [filter] }) }),
    [account.id, filter, limit],
  );
  const shown = entries?.slice(0, limit) ?? [];
  const more = (entries?.length ?? 0) > limit;

  const exportCsv = async () => {
    try {
      const all = await accountTimeline(account.id, { limit: Infinity });
      downloadFile(`xomoni-timeline-${account.handle || account.id}-${today()}.csv`, timelineCsv(all), 'text/csv');
      toast('Saved your timeline. It stays on your computer.', 'good');
    } catch (err) {
      toast(`The timeline wasn’t saved: ${errorMessage(err)}`, 'critical');
    }
  };

  return (
    <Card
      title="Account timeline"
      subtitle="What happened to your account, from Xomoni, X's files and your own notes. It stays on this computer."
      actions={
        <>
          <Button size="sm" icon={<Add16Regular />} onClick={() => setAdding(true)} disabled={adding}>
            Add an entry
          </Button>
          <Button size="sm" icon={<ArrowDownload16Regular />} onClick={() => void exportCsv()} disabled={!shown.length}>
            Export CSV
          </Button>
        </>
      }
    >
      {adding && <AddEntry account={account} onDone={() => setAdding(false)} />}
      <div className={styles.toolbar}>
        <Field label="Show">
          <Select
            value={filter}
            onChange={(_, data) => {
              setFilter(data.value as 'all' | TimelineKind);
              setPages(1);
            }}
          >
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {entries === undefined ? null : !shown.length ? (
        <EmptyState
          icon={<History24Regular />}
          title={filter === 'all' ? 'Nothing on your timeline yet' : 'Nothing of this kind yet'}
          body="Importing X's archive, a change of X Premium on your profile, and warnings from X appear here. You can add your own notes too."
        />
      ) : (
        byMonth(shown).map(([month, list]) => (
          <section key={month} aria-label={month}>
            <h3 className={styles.month}>{month}</h3>
            <ol className={styles.list}>
              {list.map((entry) => {
                const look = ACCOUNT_EVENT_WORDS[entry.kind];
                return (
                  <li key={`${entry.kind}:${String(entry.seq ?? entry.at)}`} className={styles.entry}>
                    <span className={styles.icon}>{ICONS[look.icon]}</span>
                    <div>
                      <div className={styles.head}>
                        <Body1 as="span">
                          <strong>{look.label}</strong>
                        </Body1>
                        <Caption1 as="span">
                          <time dateTime={new Date(entry.at).toISOString()}>
                            {new Date(entry.at).toLocaleDateString('en', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </time>
                        </Caption1>
                        <Badge tone={look.tone}>{SOURCE_WORDS[entry.source]}</Badge>
                      </div>
                      <Body1 as="p" className={styles.words}>
                        {entry.words}
                      </Body1>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))
      )}
      {more && (
        <div className={styles.more}>
          <Button onClick={() => setPages((p) => p + 1)}>Show older</Button>
        </div>
      )}
    </Card>
  );
}
