import { Caption1, Link, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import {
  CheckmarkCircle16Filled,
  DismissCircle16Filled,
  type FluentIcon,
  Info16Regular,
  Open12Regular,
  Warning16Filled,
} from '@fluentui/react-icons';
import type { LogEntry, LogLevel } from '../../shared/types';
import { fmtAgo, fmtDateTime, postUrl } from '../format';
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

/**
 * Activity log rows: level icon (its tone in `data-tone`), message, a link to the post on X when the entry names
 * one, and the time (relative, or absolute with `absolute`), with the full local time on hover.
 */
export function LogList({ entries, absolute = false }: { entries: LogEntry[]; absolute?: boolean }) {
  const styles = useStyles();
  const toneStyles = useToneStyles();
  const now = useNow(30_000);
  return (
    <ul className={styles.list}>
      {entries.map((e) => {
        const { tone, Icon } = LEVEL[e.level];
        return (
          <li key={e.seq} className={styles.row}>
            <span className={mergeClasses(styles.icon, toneStyles[tone])} data-tone={tone}>
              <Icon aria-hidden />
            </span>
            <span className={styles.message}>
              {e.message}
              {e.targetId && (
                <Link
                  href={postUrl(e.targetId)}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.link}
                  title="Open on X"
                >
                  {e.targetId.slice(-6)} <Open12Regular aria-hidden />
                </Link>
              )}
            </span>
            <Caption1 className={styles.time} title={new Date(e.ts).toLocaleString()}>
              {absolute ? fmtDateTime(e.ts) : fmtAgo(e.ts, now)}
            </Caption1>
          </li>
        );
      })}
    </ul>
  );
}
