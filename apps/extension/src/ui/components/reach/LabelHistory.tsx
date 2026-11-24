import {
  Link,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Tag20Regular } from '@fluentui/react-icons';
import { glossaryEntry } from '../../../shared/vault/label-glossary';
import {
  type LabelMonthRow,
  type LabelScope,
  UNDER_THE_HOOD_MIN_POSTS,
  UNDER_THE_HOOD_PAGE,
  monthName,
} from '../../../shared/vault/under-the-hood';
import { fmtDate, fmtNumber } from '../../format';
import { Card, EmptyState } from '../ui';

const useStyles = makeStyles({
  months: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
  month: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS },
  monthName: { margin: 0, fontSize: tokens.fontSizeBase400, fontWeight: tokens.fontWeightSemibold },
  line: { margin: 0, color: tokens.colorNeutralForeground2 },
  muted: { color: tokens.colorNeutralForeground3 },
  table: { fontVariantNumeric: 'tabular-nums' },
  headCell: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
  },
  numeric: { textAlign: 'right' },
  endAlign: { justifyContent: 'flex-end' },
  name: { fontFamily: tokens.fontFamilyMonospace, overflowWrap: 'anywhere' },
  steps: { margin: 0, paddingLeft: tokens.spacingHorizontalXL, lineHeight: tokens.lineHeightBase400 },
});

/** What each scope says in the table. */
const SCOPE_WORDS: Readonly<Record<LabelScope, string>> = {
  posts: 'Posts',
  account: 'The account',
  unknown: 'X didn’t say',
};

/** The steps to get X's file, with the page's link, which opens a normal tab only when the person follows it. */
export function HowToGetUnderTheHood() {
  const styles = useStyles();
  return (
    <ol className={styles.steps}>
      <li>
        On X, open{' '}
        <Link href={UNDER_THE_HOOD_PAGE} target="_blank" rel="noreferrer">
          Under the hood
        </Link>{' '}
        (x.com/i/under_the_hood), signed in as this account.
      </li>
      <li>Press Download: X saves a JSON file of last month&apos;s labels.</li>
      <li>Drop that file on Xomoni&apos;s Vault page. It stays on your computer.</li>
    </ol>
  );
}

/** What a label means: the glossary's words with their source, X's own words from the file, or that X said nothing. */
function Meaning({ about, effect, name }: { name: string; about?: string; effect?: string }) {
  const styles = useStyles();
  const known = glossaryEntry(name);
  if (known)
    return (
      <>
        {known.meaning} {known.effect}{' '}
        <span className={styles.muted}>
          (
          <Link href={known.source} target="_blank" rel="noreferrer">
            {known.sourceName}
          </Link>
          , checked {fmtDate(Date.parse(`${known.checkedOn}T12:00:00Z`))})
        </span>
      </>
    );
  if (about || effect)
    return (
      <>
        <span className={styles.muted}>X&apos;s words: </span>
        {[about, effect].filter(Boolean).join(' ')}
      </>
    );
  return <span className={styles.muted}>X didn&apos;t explain this label.</span>;
}

/**
 * X's labels, month by month (#429, ADR-0045, point 5), from the *Under the hood* files the person imported: each
 * label X applied, with X's own name, how many posts it touched or that it was on the account, and what it means when
 * a public source says so. A month without labels says *No labels that month*, never "clean"; a month the account
 * wasn't eligible for says so, with X's conditions. Every name and word is shown as text.
 */
export function LabelHistory({ months }: { months: readonly LabelMonthRow[] }) {
  const styles = useStyles();
  if (!months.length)
    return (
      <Card title="X's labels">
        <EmptyState
          icon={<Tag20Regular />}
          title="No Under the hood reports yet"
          body="X's monthly Under the hood report says which labels X applied to your posts and how many posts each touched, but not which posts. To see it here:"
        />
        <HowToGetUnderTheHood />
      </Card>
    );
  return (
    <Card
      title="X's labels"
      subtitle="From X's monthly Under the hood reports you imported. X doesn't say which posts."
    >
      <div className={styles.months}>
        {months.map((m) => (
          <section key={m.month} aria-label={monthName(m.month)} className={styles.month}>
            <h3 className={styles.monthName}>{monthName(m.month)}</h3>
            {m.eligible === false ? (
              <p className={styles.line}>
                X says the account wasn&apos;t eligible for that month&apos;s report: X gives it to accounts at least a
                year old with {UNDER_THE_HOOD_MIN_POSTS} or more posts in the month before.
              </p>
            ) : !m.labels.length ? (
              <p className={styles.line}>
                No labels that month
                {m.postsInMonth !== undefined && `, across ${fmtNumber(m.postsInMonth)} posts`}.
              </p>
            ) : (
              <Table size="small" className={styles.table} aria-label={`X's labels in ${monthName(m.month)}`}>
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell className={styles.headCell}>Label</TableHeaderCell>
                    <TableHeaderCell className={styles.headCell}>On</TableHeaderCell>
                    <TableHeaderCell className={styles.headCell} button={{ className: styles.endAlign }}>
                      Posts
                    </TableHeaderCell>
                    <TableHeaderCell className={styles.headCell}>What it means</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {m.labels.map((l) => (
                    <TableRow key={`${l.scope}:${l.name}`}>
                      <TableCell className={styles.name}>{l.name}</TableCell>
                      <TableCell>{SCOPE_WORDS[l.scope]}</TableCell>
                      <TableCell className={styles.numeric}>
                        {l.scope === 'account' ? '—' : fmtNumber(l.count)}
                        {l.scope === 'posts' && m.postsInMonth ? ` of ${fmtNumber(m.postsInMonth)}` : ''}
                      </TableCell>
                      <TableCell>
                        <Meaning
                          name={l.name}
                          {...(l.about && { about: l.about })}
                          {...(l.effect && { effect: l.effect })}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {m.governmentOrders?.length ? (
              <p className={styles.line}>
                Orders from governments that month:{' '}
                {m.governmentOrders.map((o) => `${o.country} (${fmtNumber(o.count)})`).join(', ')}.
              </p>
            ) : null}
          </section>
        ))}
      </div>
    </Card>
  );
}
