import { Link, makeStyles, tokens } from '@fluentui/react-components';
import { Info20Regular, Open16Regular } from '@fluentui/react-icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { kvGet, kvSet } from '../../../shared/db';
import { GUESS_NOTICE, SUSPECT_WHY_WORDS, type SuspectLabel, suspectPosts } from '../../../shared/vault/suspects';
import { type LabelMonthRow, monthName } from '../../../shared/vault/under-the-hood';
import { fmtDate, fmtNumber, postUrl } from '../../format';
import type { ReachRow } from '../../reach';
import { Badge, Button, Callout, Card } from '../ui';

/** Where an account's dismissed suspects are kept in `kv`: post ids. Not carried by a move, and never sent. */
export const suspectDismissedKey = (accountId: string) => `suspectDismissed:${accountId}`;

/** The most dismissed posts kept per account. */
export const MAX_DISMISSED = 1_000;

/** The account's dismissed suspects; an empty list when none, or when what is kept isn't a list of ids. */
export async function dismissedSuspects(accountId: string): Promise<string[]> {
  const kept = await kvGet<unknown>(suspectDismissedKey(accountId), []);
  return Array.isArray(kept) ? kept.filter((id): id is string => typeof id === 'string' && /^\d{1,20}$/.test(id)) : [];
}

/** Dismisses `id` (or brings it back), keeping at most `MAX_DISMISSED`, newest kept. */
export async function setDismissed(accountId: string, id: string, dismissed: boolean): Promise<void> {
  const now = (await dismissedSuspects(accountId)).filter((kept) => kept !== id);
  await kvSet(suspectDismissedKey(accountId), (dismissed ? [...now, id] : now).slice(-MAX_DISMISSED));
}

const useStyles = makeStyles({
  labels: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXL },
  label: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS },
  heading: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    margin: 0,
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
  },
  name: { fontFamily: tokens.fontFamilyMonospace, overflowWrap: 'anywhere' },
  list: { margin: 0, padding: 0, listStyleType: 'none' },
  item: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
    padding: `${tokens.spacingVerticalS} 0`,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: tokens.spacingHorizontalS },
  text: { overflowWrap: 'anywhere' },
  reasons: { margin: 0, paddingLeft: tokens.spacingHorizontalL, color: tokens.colorNeutralForeground2 },
  muted: { margin: 0, color: tokens.colorNeutralForeground3 },
});

/**
 * Suspected posts (#429, ADR-0045, point 4): for each post label of each month X's file names, the posts of that month
 * furthest below their usual, as a guess. Every label's list sits under a box that can't be hidden, *This is a guess.
 * X doesn't say which posts got a label.*; each post has its reasons, Open on X while it is there, and Dismiss. Nothing
 * here leads to a cleanup, and nothing is sent anywhere.
 */
export function SuspectPosts({
  accountId,
  rows,
  months,
  handle,
}: {
  accountId: string;
  rows: readonly ReachRow[];
  months: readonly LabelMonthRow[];
  handle: string;
}) {
  const styles = useStyles();
  const dismissed = useLiveQuery(async () => await dismissedSuspects(accountId), [accountId]);
  if (dismissed === undefined) return null;
  const guesses = suspectPosts(rows, months, new Set(dismissed));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return (
    <Card title="Suspected posts" subtitle="Posts that may have got a label X applied that month">
      <Callout tone="warn" icon={<Info20Regular />}>
        {GUESS_NOTICE}
      </Callout>
      {!guesses.length ? (
        <p className={styles.muted}>
          {months.length
            ? 'No month you imported has a label on posts, so there is nothing to guess.'
            : "Import X's Under the hood report to see which months had labels. Xomoni never guesses without it."}
        </p>
      ) : (
        <div className={styles.labels}>
          {guesses.map((g) => (
            <GuessList
              key={`${g.month}:${g.label}`}
              guess={g}
              handle={handle}
              text={(id) => byId.get(id)?.text ?? ''}
              onX={(id) => byId.get(id)?.onX ?? false}
              onDismiss={(id) => void setDismissed(accountId, id, true)}
            />
          ))}
        </div>
      )}
      {dismissed.length > 0 && (
        <Button size="sm" variant="ghost" onClick={() => void kvSet(suspectDismissedKey(accountId), [])}>
          Show the {fmtNumber(dismissed.length)} dismissed again
        </Button>
      )}
    </Card>
  );
}

/** One label's guesses in one month, or why there are none. */
function GuessList({
  guess,
  handle,
  text,
  onX,
  onDismiss,
}: {
  guess: SuspectLabel;
  handle: string;
  text: (id: string) => string;
  onX: (id: string) => boolean;
  onDismiss: (id: string) => void;
}) {
  const styles = useStyles();
  const title = `${guess.label} in ${monthName(guess.month)}`;
  return (
    <section aria-label={title} className={styles.label}>
      <h3 className={styles.heading}>
        <span className={styles.name}>{guess.label}</span> · {monthName(guess.month)} · X says {fmtNumber(guess.n)}{' '}
        {guess.n === 1 ? 'post' : 'posts'}
        {guess.confidence && (
          <Badge tone="neutral">{guess.confidence === 'medium' ? 'Medium confidence' : 'Low confidence'}</Badge>
        )}
      </h3>
      {guess.why ? (
        <p className={styles.muted}>{SUSPECT_WHY_WORDS[guess.why]}</p>
      ) : (
        <ul className={styles.list}>
          {guess.candidates.map((c) => (
            <li key={c.id} className={styles.item} data-post={c.id}>
              <div className={styles.row}>
                <span className={styles.muted}>{fmtDate(c.createdAt)}</span>
                <span className={styles.text}>{text(c.id) || 'Untitled post'}</span>
              </div>
              <ul className={styles.reasons}>
                {c.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <div className={styles.row}>
                {onX(c.id) && (
                  <Link href={postUrl(c.id, handle)} target="_blank" rel="noreferrer">
                    <Open16Regular aria-hidden /> Open on X
                  </Link>
                )}
                <Button size="sm" variant="ghost" onClick={() => onDismiss(c.id)}>
                  Dismiss
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
