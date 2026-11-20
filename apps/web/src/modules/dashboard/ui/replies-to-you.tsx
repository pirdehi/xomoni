'use client';
// Comments on xomoni.com (#256): *Replies to you*, the replies other people wrote to the person's posts that Xomoni kept
// from what X showed it, for 90 days (ADR-0030). Read from Xomoni in this browser and kept in this page's memory
// only (ADR-0028). Xomoni never hides, blocks or reports anyone: each reply opens on X, where the person can hide it.
// On Fluent UI (ADR-0019).
import {
  Button,
  Field,
  Input,
  Spinner,
  makeStyles,
  mergeClasses,
  tokens,
  typographyStyles,
} from '@fluentui/react-components';
import { ArrowClockwise16Regular, Open12Regular, Search16Regular } from '@fluentui/react-icons';
import type { IncomingReply } from '@xomoni/bridge';
import { useState } from 'react';
import { type XomoniControls, useXomoniRead } from '@/modules/extension/ui/xomoni-actions';
import { dayText, incomingSeries } from '../domain/comments';
import { ColumnChart, formatCount } from './charts';
import { useSettled } from './cleanup-place';
import { NoAnswer, formatDate, postUrl } from './xomoni-places';

const useStyles = makeStyles({
  card: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalL,
    borderRadius: tokens.borderRadius2XLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  title: { ...typographyStyles.subtitle2, margin: 0 },
  text: { ...typographyStyles.body1, margin: 0, color: tokens.colorNeutralForeground2 },
  meta: { ...typographyStyles.caption1, margin: 0, color: tokens.colorNeutralForeground3 },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: tokens.spacingHorizontalM },
  search: { minWidth: '200px', maxWidth: '360px', flexGrow: 1 },
  people: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
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
  links: { display: 'flex', flexWrap: 'wrap', columnGap: tokens.spacingHorizontalL },
});

/**
 * *Replies to you* (#256, ADR-0030): how many replies Xomoni kept each day of the last 30, who replies most, and the
 * replies themselves, by person and words, 100 at a time, each with *Open on X* and a link to the post it answers.
 */
export function RepliesToYou({ xomoni, now }: { xomoni: XomoniControls; now: number }) {
  const s = useStyles();
  const [author, setAuthor] = useState('');
  const [typed, setTyped] = useState('');
  const query = useSettled(typed.trim(), 300);
  return (
    <>
      <div className={s.row}>
        <Field label="Words" className={s.search}>
          <Input
            contentBefore={<Search16Regular />}
            placeholder="In the replies"
            value={typed}
            maxLength={100}
            onChange={(_, d) => setTyped(d.value)}
          />
        </Field>
      </div>
      <Incoming
        key={`${author}\n${query}`}
        xomoni={xomoni}
        now={now}
        author={author}
        query={query}
        onAuthor={setAuthor}
      />
      <p className={s.meta}>
        To hide a reply, open it on X and choose *Hide reply* in its menu. Xomoni never hides, blocks or reports anyone.
      </p>
    </>
  );
}

/** What Xomoni kept for one person and search: the days, the people, and a page of replies. */
function Incoming({
  xomoni,
  now,
  author,
  query,
  onAuthor,
}: {
  xomoni: XomoniControls;
  now: number;
  author: string;
  query: string;
  onAuthor: (handle: string) => void;
}) {
  const s = useStyles();
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState<IncomingReply[]>([]);
  const { answer, loading, reload } = useXomoniRead(xomoni, { what: 'incoming', author, query, offset });
  if (answer && !answer.ok) return <NoAnswer reason={answer.reason} doing="show replies to you" />;
  const page = answer?.ok && answer.what === 'incoming' ? answer.page : null;
  if (!page) return loading ? <Spinner size="small" label="Reading replies to you in Xomoni…" /> : null;
  if (page.total === 0 || page.since === null)
    return (
      <p className={s.text}>
        Xomoni hasn’t kept a reply to your posts yet. It keeps the ones X shows it while you use X, for 90 days.
      </p>
    );
  // While the next page is read, the answer is still the last one: each reply is listed once.
  const listed = new Set(more.map((reply) => reply.id));
  const items = [...more, ...page.items.filter((reply) => !listed.has(reply.id))];
  const next = page.next;
  const since = formatDate(page.since);
  return (
    <>
      <section className={s.card} aria-labelledby="per-day-title">
        <h2 id="per-day-title" className={s.title}>
          Replies to you each day
        </h2>
        <ColumnChart points={incomingSeries(page, now)} label="Replies to you each day" today={dayText(now)} />
        <p className={s.meta}>
          {formatCount(page.total)} kept since {since}: what X showed Xomoni, not every reply. Xomoni keeps them on this
          computer for 90 days.
        </p>
      </section>
      <section className={s.card} aria-labelledby="repliers-title">
        <h2 id="repliers-title" className={s.title}>
          Who replies most
        </h2>
        <div className={s.people}>
          {page.people.map((person) => {
            const chosen = person.handle.toLowerCase() === author.toLowerCase();
            return (
              <Button
                key={person.handle}
                size="small"
                appearance={chosen ? 'primary' : 'outline'}
                aria-pressed={chosen}
                onClick={() => onAuthor(chosen ? '' : person.handle)}
              >
                @{person.handle} · {formatCount(person.replies)}
              </Button>
            );
          })}
        </div>
      </section>
      <section className={s.card} aria-labelledby="incoming-title">
        <div className={s.row}>
          <h2 id="incoming-title" className={s.title}>
            {formatCount(page.matching)} {page.matching === 1 ? 'reply' : 'replies'}
            {author && ` from @${author}`}
          </h2>
          {loading && <Spinner size="extra-tiny" />}
          <Button appearance="subtle" size="small" icon={<ArrowClockwise16Regular />} onClick={reload}>
            Read again
          </Button>
        </div>
        {items.length === 0 ? (
          <p className={s.text}>None of the replies Xomoni kept match.</p>
        ) : (
          <ul className={s.list} aria-label="Replies to you">
            {items.map((reply) => (
              <li key={reply.id} className={s.item}>
                <span className={s.meta}>
                  @{reply.author} · {formatDate(reply.createdAt)}
                </span>
                <p className={s.body}>{reply.text || '(no text)'}</p>
                <span className={mergeClasses(s.meta, s.links)}>
                  <a href={postUrl(reply.id)} target="_blank" rel="noreferrer noopener">
                    Open on X <Open12Regular />
                  </a>
                  <a href={postUrl(reply.toId)} target="_blank" rel="noreferrer noopener">
                    Your post <Open12Regular />
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
        {next !== null && (
          <div>
            <Button
              appearance="secondary"
              disabled={loading}
              onClick={() => {
                setMore(items);
                setOffset(next);
              }}
            >
              Show more
            </Button>
          </div>
        )}
      </section>
    </>
  );
}
