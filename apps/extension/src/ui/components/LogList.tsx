import { Caption1, Button as FluentButton, Link, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import {
  CheckmarkCircle16Filled,
  ChevronDown12Regular,
  ChevronUp12Regular,
  DismissCircle16Filled,
  type FluentIcon,
  Info16Regular,
  Open12Regular,
  Warning16Filled,
} from '@fluentui/react-icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, useId, useState } from 'react';
import { db } from '../../shared/db';
import type { LogEntry, LogLevel } from '../../shared/types';
import { fmtAgo, fmtDateTime, fmtTime, postUrl } from '../format';
import { groupLog } from '../log-groups';
import { type Tone, useNow } from './ui';

/** Each level's icon and tone; the tone colors the icon and is exposed in `data-tone`. */
const LEVEL = {
  success: { tone: 'good', Icon: CheckmarkCircle16Filled },
  info: { tone: 'neutral', Icon: Info16Regular },
  warn: { tone: 'warn', Icon: Warning16Filled },
  error: { tone: 'critical', Icon: DismissCircle16Filled },
} as const satisfies Record<LogLevel, { tone: Tone; Icon: FluentIcon }>;

const useStyles = makeStyles({
  list: { listStyleType: 'none', margin: 0, padding: 0 },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: tokens.spacingHorizontalM,
    paddingBlock: tokens.spacingVerticalMNudge,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
    ':not(:first-child)': { borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}` },
  },
  icon: { display: 'inline-flex', flexShrink: 0, marginTop: tokens.spacingVerticalXXS },
  message: { flexGrow: 1, minWidth: 0, overflowWrap: 'anywhere', color: tokens.colorNeutralForeground1 },
  link: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXXS,
    marginLeft: tokens.spacingHorizontalS,
    fontSize: tokens.fontSizeBase200,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.colorNeutralForeground3,
    ':hover': { color: tokens.colorBrandForeground1 },
  },
  postText: {
    display: 'block',
    marginTop: tokens.spacingVerticalXXS,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  toggle: { marginLeft: tokens.spacingHorizontalS, minWidth: 'auto', fontWeight: tokens.fontWeightRegular },
  nested: {
    listStyleType: 'none',
    margin: `${tokens.spacingVerticalXS} 0 0`,
    paddingLeft: tokens.spacingHorizontalL,
    borderLeft: `${tokens.strokeWidthThick} solid ${tokens.colorNeutralStroke2}`,
  },
  // On the message's line height, so the time sits on the same line as the first line of the message.
  time: {
    flexShrink: 0,
    lineHeight: tokens.lineHeightBase300,
    color: tokens.colorNeutralForeground3,
    fontVariantNumeric: 'tabular-nums',
  },
});

/** The icon color behind each tone a log level can have. */
const useToneStyles = makeStyles({
  neutral: { color: tokens.colorNeutralForeground3 },
  good: { color: tokens.colorStatusSuccessForeground1 },
  warn: { color: tokens.colorStatusWarningForeground1 },
  critical: { color: tokens.colorStatusDangerForeground1 },
});

/** The text of the posts these entries name, from this browser's inventory (#204); posts it doesn't have are left out. */
function usePostTexts(entries: readonly LogEntry[], enabled: boolean): Map<string, string> | undefined {
  const keys = enabled
    ? [...new Set(entries.filter((e) => e.targetId).map((e) => `${e.accountId}\u0000${e.targetId}`))]
    : [];
  return useLiveQuery(async () => {
    const texts = new Map<string, string>();
    if (!keys.length) return texts;
    const items = await db.items
      .where('[accountId+targetId]')
      .anyOf(keys.map((k) => k.split('\u0000') as [string, string]))
      .toArray();
    for (const item of items) if (item.text) texts.set(`${item.accountId}\u0000${item.targetId}`, item.text);
    return texts;
  }, [keys.join('|')]);
}

/**
 * Activity log rows: level icon (its tone in `data-tone`), message, a link to the post on X when the entry names
 * one, and the time (relative, or absolute with `absolute`), with the full local time on hover. With `grouped`
 * (#204), a run of the same confirmed action within one job and day reads as one line that opens to its entries;
 * with `withText`, an entry shows the post's text when this browser has it.
 */
export function LogList({
  entries,
  absolute = false,
  grouped = false,
  withText = false,
  maxRows = Infinity,
}: {
  entries: LogEntry[];
  absolute?: boolean;
  grouped?: boolean;
  withText?: boolean;
  /** Shows at most this many lines, a group counting as one. */
  maxRows?: number;
}) {
  const styles = useStyles();
  const toneStyles = useToneStyles();
  const now = useNow(30_000);
  const texts = usePostTexts(entries, withText);
  const when = (ts: number) => (absolute ? fmtDateTime(ts) : fmtAgo(ts, now));

  const row = (e: LogEntry) => {
    const { tone, Icon } = LEVEL[e.level];
    const text = e.targetId ? texts?.get(`${e.accountId}\u0000${e.targetId}`) : undefined;
    return (
      <li key={e.seq ?? `${e.ts}-${e.message}`} className={styles.row}>
        <span className={mergeClasses(styles.icon, toneStyles[tone])} data-tone={tone}>
          <Icon aria-hidden />
        </span>
        <span className={styles.message}>
          {e.message}
          {e.targetId && (
            <Link href={postUrl(e.targetId)} target="_blank" rel="noreferrer" className={styles.link} title="Open on X">
              {e.targetId.slice(-6)} <Open12Regular aria-hidden />
            </Link>
          )}
          {text && <span className={styles.postText}>“{text}”</span>}
        </span>
        <Caption1 className={styles.time} title={new Date(e.ts).toLocaleString()}>
          {when(e.ts)}
        </Caption1>
      </li>
    );
  };

  if (!grouped) return <ul className={styles.list}>{entries.slice(0, maxRows).map(row)}</ul>;
  return (
    <ul className={styles.list}>
      {groupLog(entries)
        .slice(0, maxRows)
        .map((r) =>
          r.kind === 'entry' ? (
            row(r.entry)
          ) : (
            <GroupRow
              key={r.key}
              label={r.label}
              range={`${absolute ? fmtDateTime(r.from) : fmtTime(r.from)}–${fmtTime(r.to)}`}
              title={`${new Date(r.from).toLocaleString()} – ${new Date(r.to).toLocaleString()}`}
              count={r.entries.length}
            >
              {r.entries.map(row)}
            </GroupRow>
          ),
        )}
    </ul>
  );
}

/** A run of the same confirmed action as one line, with *Show* (`aria-expanded`) for its entries underneath. */
function GroupRow({
  label,
  range,
  title,
  count,
  children,
}: {
  label: string;
  range: string;
  title: string;
  count: number;
  children: ReactNode;
}) {
  const styles = useStyles();
  const toneStyles = useToneStyles();
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <li className={styles.row} data-group={count}>
      <span className={mergeClasses(styles.icon, toneStyles.good)} data-tone="good">
        <CheckmarkCircle16Filled aria-hidden />
      </span>
      <span className={styles.message}>
        {label}
        <FluentButton
          appearance="transparent"
          size="small"
          className={styles.toggle}
          icon={open ? <ChevronUp12Regular /> : <ChevronDown12Regular />}
          iconPosition="after"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Hide' : 'Show'}
        </FluentButton>
        <ul id={listId} className={styles.nested}>
          {open && children}
        </ul>
      </span>
      <Caption1 className={styles.time} title={title}>
        {range}
      </Caption1>
    </li>
  );
}
