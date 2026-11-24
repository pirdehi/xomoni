import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { REACH_VERDICT_WORDS, type ReachVerdict } from '@xomoni/bridge';
import { useMemo, useState } from 'react';
import {
  DAY_PARTS,
  type ReachComparison,
  type TimeCell,
  WEEKDAYS,
  comparedKey,
  reachByTime,
  reachComparisons,
} from '../../../shared/vault/reach-compare';
import type { PremiumPeriod } from '../../../shared/vault/reach';
import { MIN_GROUP } from '../../../shared/vault/reach-stats';
import { fmtNumber } from '../../format';
import type { ReachRow } from '../../reach';
import type { Account } from '../../../shared/types';
import { Badge, Button, Card, Disclosure, type Tone } from '../ui';
import { PremiumDateDialog } from './PremiumDateDialog';

const useStyles = makeStyles({
  grid: {
    display: 'grid',
    gap: tokens.spacingHorizontalXL,
    gridTemplateColumns: '1fr',
    '@media (min-width: 900px)': { gridTemplateColumns: '1fr 1fr' },
  },
  groups: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: tokens.spacingHorizontalM,
    margin: `${tokens.spacingVerticalM} 0`,
  },
  group: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXXS },
  groupName: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
  groupValue: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    fontVariantNumeric: 'tabular-nums',
  },
  line: { margin: `${tokens.spacingVerticalXS} 0`, color: tokens.colorNeutralForeground2 },
  list: { margin: 0, paddingLeft: tokens.spacingHorizontalL },
  table: { fontVariantNumeric: 'tabular-nums' },
  headCell: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
  },
  numeric: { textAlign: 'right' },
  endAlign: { justifyContent: 'flex-end' },
});

/** Each verdict's badge color: a difference stands out, the rest stay quiet. */
const VERDICT_TONE: Readonly<Record<ReachVerdict, Tone>> = {
  'clear-lower': 'warn',
  'clear-higher': 'good',
  maybe: 'neutral',
  'no-difference': 'neutral',
  'not-enough-data': 'neutral',
};

/** `words` with a capital first letter. */
const capitalized = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);

/** A ratio as a share: 0.52 is "52%". */
const share = (ratio: number) =>
  Number.isFinite(ratio) ? `${Math.round(ratio * 100).toLocaleString('en-US')}%` : 'more than any share';

/** What the comparisons are computed from, held with the key it had (`comparedKey`). */
interface Compared {
  key: string;
  rows: readonly ReachRow[];
  periods: readonly PremiumPeriod[];
}

/**
 * The rows and spans to compute from: the ones first seen with this key (`comparedKey`), kept while the key stays the
 * same. The page's live query hands over new copies of every row whenever any item changes, such as a post a running
 * cleanup removed; those keep the key, so what is computed from them isn't computed again (#497).
 */
function useCompared(rows: readonly ReachRow[], periods: readonly PremiumPeriod[]): Compared {
  const key = comparedKey(rows, periods);
  const [held, setHeld] = useState<Compared>({ key, rows, periods });
  // React's pattern for state from an earlier render: this render's output is dropped, and the next uses the new rows.
  if (held.key !== key) setHeld({ key, rows, periods });
  return held;
}

/**
 * The Reach page's comparisons (#429, ADR-0045): posts with a link against posts without, photos or videos against
 * text, and Premium against before it, each with its verdict in one of five fixed words, each group's size and median,
 * the ratio with its 95% interval, and what can mislead it under *How this is computed*; and the usual reach by day and
 * time of day. They show what goes together, never why. Each comparison takes 2,000 resamples a side, seconds with
 * tens of thousands of posts, so both are computed once for the same posts, not at each render (`useCompared`).
 */
export function ReachComparisons({
  rows,
  periods,
  account,
}: {
  rows: readonly ReachRow[];
  periods: readonly PremiumPeriod[];
  /** The account, for *When did you get Premium?*; without it the Premium card only says it can't compare. */
  account?: Pick<Account, 'id' | 'createdAt'>;
}) {
  const styles = useStyles();
  const [asking, setAsking] = useState(false);
  const compared = useCompared(rows, periods);
  const comparisons = useMemo(() => reachComparisons(compared.rows, compared.periods), [compared]);
  const byTime = useMemo(() => reachByTime(compared.rows), [compared]);
  return (
    <div className={styles.grid}>
      {comparisons.map((c) => (
        <ComparisonCard key={c.id} comparison={c} {...(account && { onAskDate: () => setAsking(true) })} />
      ))}
      <TimeTable byTime={byTime} />
      {account && <PremiumDateDialog account={account} open={asking} onClose={() => setAsking(false)} />}
    </div>
  );
}

/** One comparison as a card; the Premium card without a known start asks for the date with `onAskDate`. */
function ComparisonCard({ comparison: c, onAskDate }: { comparison: ReachComparison; onAskDate?: () => void }) {
  const styles = useStyles();
  const { verdict, a, b, ratio, interval } = c.result;
  const [first, second] = c.groups;
  return (
    <Card
      title={c.title}
      actions={
        <span data-verdict={verdict}>
          <Badge tone={VERDICT_TONE[verdict]}>{REACH_VERDICT_WORDS[verdict]}</Badge>
        </span>
      }
    >
      <section aria-label={c.title}>
        <div className={styles.groups}>
          {[
            { name: first, group: a },
            { name: second, group: b },
          ].map(({ name, group }) => (
            <div key={name} className={styles.group}>
              <span className={styles.groupName}>{name}</span>
              <span className={styles.groupValue}>
                {group.median === null ? '—' : fmtNumber(Math.round(group.median))}
              </span>
              <span className={styles.groupName}>
                {fmtNumber(group.n)} {group.n === 1 ? 'post' : 'posts'}
              </span>
            </div>
          ))}
        </div>
        {verdict === 'not-enough-data' || ratio === null || interval === null ? (
          <>
            <p className={styles.line}>
              {c.needsDate
                ? "Xomoni doesn't know yet when you got Premium, so it can't compare."
                : `Each side needs at least ${String(MIN_GROUP)} posts read 7 days or more after you made them.`}
            </p>
            {c.needsDate && onAskDate && (
              <Button size="sm" onClick={onAskDate}>
                When did you get Premium?
              </Button>
            )}
          </>
        ) : (
          <p className={styles.line}>
            {capitalized(c.subjects[0])} were seen {share(ratio)} as much as {c.subjects[1]} (median against median; 95%
            interval {share(interval[0])} to {share(interval[1])}).
          </p>
        )}
        <Disclosure label="How this is computed">
          <p className={styles.line}>
            Your posts (not replies) read at least 7 days after you made them, from the period you chose. Each side
            needs {MIN_GROUP}. The interval comes from 2,000 resamples, the same every time for the same posts. It shows
            what goes together, not why. What can mislead it:
          </p>
          <ul className={styles.list}>
            {c.misleads.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Disclosure>
      </section>
    </Card>
  );
}

/** A cell's median, or *Not enough data* with its count. */
function cellWords(cell: TimeCell): string {
  return cell.median === null ? REACH_VERDICT_WORDS['not-enough-data'] : fmtNumber(Math.round(cell.median));
}

/** The usual reach by day of the week and time of day, as a table. */
function TimeTable({ byTime: { days, parts } }: { byTime: ReturnType<typeof reachByTime> }) {
  const styles = useStyles();
  const table = (label: string, names: readonly string[], cells: readonly TimeCell[]) => (
    <Table size="small" className={styles.table} aria-label={label}>
      <TableHeader>
        <TableRow>
          <TableHeaderCell className={styles.headCell}>{label}</TableHeaderCell>
          <TableHeaderCell className={styles.headCell} button={{ className: styles.endAlign }}>
            Posts
          </TableHeaderCell>
          <TableHeaderCell className={styles.headCell} button={{ className: styles.endAlign }}>
            Usual reach
          </TableHeaderCell>
        </TableRow>
      </TableHeader>
      <TableBody>
        {cells.map((cell, i) => (
          <TableRow key={names[i]}>
            <TableCell>{names[i]}</TableCell>
            <TableCell className={styles.numeric}>{fmtNumber(cell.n)}</TableCell>
            <TableCell className={styles.numeric}>{cellWords(cell)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
  return (
    <Card title="By day and time" subtitle="The median reach of your posts made then, once there are 15">
      {table(
        'Day',
        WEEKDAYS.map((d) => d.label),
        days,
      )}
      {table(
        'Time of day',
        DAY_PARTS.map((p) => p.label),
        parts,
      )}
    </Card>
  );
}
