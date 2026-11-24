'use client';
// Reach on xomoni.com (#431, ADR-0045, ADR-0028): what Xomoni's `reach` answer says, drawn from it as it came, kept in
// this page's memory only. The verdicts and the guess box use the extension's words; a suspected post is always a
// guess, in a box that can't be hidden, and nothing here leads to a cleanup. Text is drawn as text, never as markup.
// On Fluent UI (ADR-0019).
import { Badge, Link, makeStyles, tokens, typographyStyles } from '@fluentui/react-components';
import { Open12Regular } from '@fluentui/react-icons';
import { REACH_GUESS_NOTICE, type ReachSummary } from '@xomoni/bridge';
import { comparisonView, monthNote, monthWords, postUrl, vsUsualWords } from '../domain/reach';
import { formatDate } from './xomoni-places';

const useStyles = makeStyles({
  stack: { display: 'grid', rowGap: tokens.spacingVerticalL },
  grid: {
    display: 'grid',
    gap: tokens.spacingHorizontalL,
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalS,
    padding: tokens.spacingHorizontalL,
    borderRadius: tokens.borderRadius2XLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  title: { ...typographyStyles.subtitle2, margin: 0 },
  text: { ...typographyStyles.body1, margin: 0, color: tokens.colorNeutralForeground2 },
  meta: { ...typographyStyles.caption1, margin: 0, color: tokens.colorNeutralForeground3 },
  list: { display: 'grid', rowGap: tokens.spacingVerticalS, margin: 0, padding: 0, listStyleType: 'none' },
  item: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalXS,
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  body: { ...typographyStyles.body1, margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  guess: {
    ...typographyStyles.body1Strong,
    margin: 0,
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusLarge,
    borderLeft: `${tokens.strokeWidthThickest} solid ${tokens.colorPaletteYellowBorderActive}`,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  name: { fontFamily: tokens.fontFamilyMonospace, overflowWrap: 'anywhere' },
});

/**
 * Xomoni's Reach as xomoni.com shows it: the comparisons, each with its verdict and sentence; the posts of the answer,
 * each with its number, its share of usual and a link to X; the suspected posts, each a guess, under the box; and X's
 * months of labels. `handle` is the account's, for links to its posts.
 */
export function ReachView({ summary, handle }: { summary: ReachSummary; handle: string }) {
  const s = useStyles();
  return (
    <div className={s.stack}>
      <section aria-label="Comparisons" className={s.grid}>
        {summary.comparisons.map((c) => {
          const view = comparisonView(c);
          return (
            <article key={c.id} aria-label={view.title} className={s.card}>
              <h3 className={s.title}>{view.title}</h3>
              <Badge appearance="tint" color="informative">
                {view.verdict}
              </Badge>
              <p className={s.text}>
                {view.sentence ??
                  `${view.groups[0]}: ${String(c.a.n)} posts. ${view.groups[1]}: ${String(c.b.n)} posts. Each side needs 15.`}
              </p>
            </article>
          );
        })}
      </section>

      <section aria-label="Posts" className={s.card}>
        <h3 className={s.title}>Your posts</h3>
        {summary.posts.length ? (
          <ol className={s.list}>
            {summary.posts.map((p) => (
              <li key={p.id} className={s.item} data-post={p.id}>
                <p className={s.meta}>
                  {formatDate(p.createdAt)} · {p.impressions.toLocaleString('en-US')} seen ·{' '}
                  {p.source === 'csv' ? "X's analytics export" : 'views Xomoni saw'} · {vsUsualWords(p.vsUsual)}
                </p>
                {p.text && <p className={s.body}>{p.text}</p>}
                <Link href={postUrl(p.id, handle)} target="_blank" rel="noreferrer">
                  Open on X <Open12Regular aria-hidden />
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <p className={s.text}>No post with a number in this period.</p>
        )}
      </section>

      <section aria-label="Suspected posts" className={s.card}>
        <h3 className={s.title}>Suspected posts</h3>
        <p className={s.guess}>{REACH_GUESS_NOTICE}</p>
        {summary.suspects.length ? (
          <ul className={s.list}>
            {summary.suspects.map((g) => (
              <li key={`${g.month}:${g.label}:${g.id}`} className={s.item} data-post={g.id}>
                <p className={s.meta}>
                  <span className={s.name}>{g.label}</span> · {monthWords(g.month)} ·{' '}
                  {g.confidence === 'medium' ? 'Medium confidence' : 'Low confidence'}
                </p>
                <ul>
                  {g.reasons.map((r) => (
                    <li key={r} className={s.text}>
                      {r}
                    </li>
                  ))}
                </ul>
                <Link href={postUrl(g.id, handle)} target="_blank" rel="noreferrer">
                  Open on X <Open12Regular aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className={s.text}>
            {summary.months.length
              ? 'No post stands out in a month X labelled.'
              : "Xomoni guesses only from X's Under the hood report, and has none yet."}
          </p>
        )}
      </section>

      <section aria-label="X's labels" className={s.card}>
        <h3 className={s.title}>X&apos;s labels</h3>
        {summary.months.length ? (
          summary.months.map((m) => (
            <div key={m.month} aria-label={monthWords(m.month)} role="group">
              <p className={s.meta}>{monthWords(m.month)}</p>
              {monthNote(m) ?? (
                <ul>
                  {m.labels.map((l) => (
                    <li key={`${l.scope}:${l.name}`} className={s.text}>
                      <span className={s.name}>{l.name}</span>:{' '}
                      {l.scope === 'account' ? 'on the account' : `${l.count.toLocaleString('en-US')} posts`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
        ) : (
          <p className={s.text}>
            No Under the hood report yet. Xomoni shows it once you drop X&apos;s file on its Vault page.
          </p>
        )}
      </section>
    </div>
  );
}
