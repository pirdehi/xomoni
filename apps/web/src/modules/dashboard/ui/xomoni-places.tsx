'use client';
// Xomoni's own places on xomoni.com (#233, ADR-0028): the Library, Watch and account health, read from Xomoni in this
// browser. What they show is X content: it stays in this page's memory, and is never stored, logged or sent. Without
// Xomoni here, each place says so and offers the dialog of ADR-0027. On Fluent UI (ADR-0019).
import {
  Badge,
  Button,
  Input,
  Spinner,
  Tab,
  TabList,
  makeStyles,
  mergeClasses,
  tokens,
  typographyStyles,
} from '@fluentui/react-components';
import { ArrowClockwise16Regular, Open12Regular, Search16Regular } from '@fluentui/react-icons';
import { LIBRARY_KINDS, type LibraryItem, type LibraryKind, type XomoniPage } from '@xomoni/bridge';
import { type ReactNode, useEffect, useState } from 'react';
import { OpenInXomoni, type XomoniControls, useXomoniRead } from '@/modules/extension/ui/xomoni-actions';
import { TextLink } from '@/shared/ui/links';
import { INSTALL_URL } from '@/shared/config/site';
import { relativeTime } from '../domain/job-status';
import { formatCount } from './charts';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalL },
  card: {
    padding: tokens.spacingHorizontalL,
    borderRadius: tokens.borderRadius2XLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  stack: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalS },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: tokens.spacingHorizontalM },
  text: { ...typographyStyles.body1, margin: 0, color: tokens.colorNeutralForeground2 },
  meta: { ...typographyStyles.caption1, margin: 0, color: tokens.colorNeutralForeground3 },
  title: { ...typographyStyles.subtitle2, margin: 0 },
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
  search: { minWidth: '240px', flexGrow: 1, maxWidth: '420px' },
  level: { ...typographyStyles.title3, margin: 0 },
  note: {
    ...typographyStyles.caption1,
    margin: 0,
    color: tokens.colorNeutralForeground3,
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
  },
});

const KIND_LABEL: Record<LibraryKind, string> = { post: 'Posts', reply: 'Replies', repost: 'Reposts', like: 'Likes' };
const LEVEL_LABEL = ['Normal', 'Caution', 'Retreat', 'Defensive', 'Full stop'];
const LEVEL_COLOR = ['success', 'warning', 'warning', 'danger', 'danger'] as const;

/** A post on X, by its id (digits only, checked by the bridge). */
export const postUrl = (id: string) => `https://x.com/i/status/${id}`;

/** The day of an epoch-ms time, as "Nov 20, 2026". */
export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** An epoch-ms time as "Nov 20, 2:30 PM". */
function formatTime(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * What a place says while Xomoni can't be read from this page, with the way to it. `what` names the place (its
 * region is "`what`: in Xomoni"); `says` replaces the sentence about where its data lives.
 */
export function NotHere({
  xomoni,
  page,
  what,
  says,
}: {
  xomoni: XomoniControls;
  page: XomoniPage;
  what: string;
  says?: string;
}) {
  const s = useStyles();
  return (
    <section className={mergeClasses(s.card, s.stack)} aria-label={`${what}: in Xomoni`}>
      {xomoni.presence.kind === 'checking' ? (
        // A Spinner is a div, so it can't sit in a paragraph: the label carries the words.
        <Spinner size="extra-tiny" labelPosition="after" label="Looking for Xomoni in this browser…" />
      ) : (
        <>
          <p className={s.text}>
            {says ??
              `${what} is read from Xomoni on your computer, in this browser: it never reaches our servers. Open this page in the browser where Xomoni runs, signed in to this account.`}
          </p>
          <div className={s.row}>
            <OpenInXomoni xomoni={xomoni} page={page} />
          </div>
        </>
      )}
    </section>
  );
}

/**
 * What a place says when Xomoni didn't give it what it asked for. `invalid` comes from a Xomoni older than the
 * message (it answers `invalid` to a type it doesn't know), so it says to install the newest version.
 */
export function NoAnswer({ reason, doing = 'show this' }: { reason: string; doing?: string }) {
  const s = useStyles();
  return reason === 'invalid' ? (
    <p className={s.text}>
      Your Xomoni is older than this page and can’t {doing} here yet.{' '}
      <TextLink href={INSTALL_URL}>Install the newest version</TextLink>, reload it in your browser’s extensions page,
      then try again.
    </p>
  ) : (
    <p className={s.text}>Xomoni didn’t answer. Open it on this computer and try again.</p>
  );
}

/** A small line above a place's content, such as where its data was read. */
export function Notice({ children }: { children: ReactNode }) {
  const s = useStyles();
  return <p className={s.note}>{children}</p>;
}

/**
 * The Library (#233): every post, reply, repost and like Xomoni knows for the active X account, by kind, newest first,
 * searchable, 100 at a time.
 */
export function LibraryPlace({ xomoni }: { xomoni: XomoniControls }) {
  const s = useStyles();
  const [kind, setKind] = useState<LibraryKind>('post');
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  const [more, setMore] = useState<LibraryItem[]>([]);
  const [offset, setOffset] = useState(0);
  // The search runs once typing pauses, not on every key.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(typed.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [typed]);
  const { answer, loading, reload } = useXomoniRead(xomoni, { what: 'library', kind, query, offset });
  const page = answer?.ok && answer.what === 'library' ? answer.page : null;
  const items = offset === 0 ? (page?.items ?? []) : [...more, ...(page?.items ?? [])];

  if (xomoni.presence.kind !== 'here') return <NotHere xomoni={xomoni} page="library" what="Your Library" />;

  const choose = (next: LibraryKind) => {
    setKind(next);
    setOffset(0);
    setMore([]);
  };
  return (
    <div className={s.root}>
      <Notice>Read from Xomoni in this browser: nothing here reaches our servers.</Notice>
      <TabList selectedValue={kind} onTabSelect={(_, data) => choose(data.value as LibraryKind)}>
        {LIBRARY_KINDS.map((k) => (
          <Tab key={k} value={k}>
            {KIND_LABEL[k]}
            {page ? ` ${formatCount(page.counts[k].present)}` : ''}
          </Tab>
        ))}
      </TabList>
      <div className={s.row}>
        <Input
          className={s.search}
          contentBefore={<Search16Regular />}
          placeholder="Search text or author"
          aria-label="Search the Library"
          value={typed}
          onChange={(_, data) => {
            setTyped(data.value);
            setOffset(0);
            setMore([]);
          }}
        />
        {page && (
          <span className={s.meta} role="status">
            {formatCount(page.matching)} {page.matching === 1 ? 'item' : 'items'}
            {page.counts[kind].removed > 0 && `, ${formatCount(page.counts[kind].removed)} removed`}
          </span>
        )}
        {loading && <Spinner size="extra-tiny" />}
      </div>
      {answer && !answer.ok ? (
        <NoAnswer reason={answer.reason} />
      ) : items.length === 0 && page ? (
        <p className={s.text}>
          {query ? 'Nothing matches that search.' : `No ${KIND_LABEL[kind].toLowerCase()} in your Library yet.`}
        </p>
      ) : (
        <ul className={s.list} aria-label={KIND_LABEL[kind]}>
          {items.map((item) => (
            <li key={`${item.kind}-${item.id}-${item.createdAt}`} className={s.item}>
              <div className={s.row}>
                <span className={s.meta}>
                  {item.kind === 'repost' || item.kind === 'like' ? `@${item.author} · ` : ''}
                  {formatDate(item.createdAt)} · {formatCount(item.likes)} likes · {formatCount(item.replies)} replies ·{' '}
                  {formatCount(item.reposts)} reposts
                </span>
                {item.removed && (
                  <Badge appearance="tint" color="informative" size="small">
                    Removed
                  </Badge>
                )}
              </div>
              <p className={s.body}>{item.text || '(no text)'}</p>
              <a className={s.meta} href={postUrl(item.id)} target="_blank" rel="noreferrer noopener">
                Open on X <Open12Regular />
              </a>
            </li>
          ))}
        </ul>
      )}
      {page?.next != null && (
        <Button
          appearance="secondary"
          disabled={loading}
          onClick={() => {
            setMore(items);
            setOffset(page.next ?? 0);
          }}
        >
          Show more
        </Button>
      )}
      <div>
        <Button appearance="subtle" size="small" icon={<ArrowClockwise16Regular />} onClick={reload}>
          Read again
        </Button>
      </div>
    </div>
  );
}

/** Account health (#233): each X account's level on the risk ladder, why, its pace, and when a hold ends. */
export function HealthPlace({ xomoni, now }: { xomoni: XomoniControls; now: number }) {
  const s = useStyles();
  const { answer, loading, reload } = useXomoniRead(xomoni, { what: 'health' });
  if (xomoni.presence.kind !== 'here') return <NotHere xomoni={xomoni} page="overview" what="Account health" />;
  const accounts = answer?.ok && answer.what === 'health' ? answer.accounts : null;
  return (
    <div className={s.root}>
      <Notice>Read from Xomoni in this browser.</Notice>
      {loading && !accounts && <Spinner size="small" label="Reading Xomoni…" />}
      {answer && !answer.ok && <NoAnswer reason={answer.reason} />}
      {accounts?.length === 0 && <p className={s.text}>Xomoni doesn’t know an X account yet.</p>}
      <ul className={s.list} aria-label="Your X accounts">
        {(accounts ?? []).map((a) => (
          <li key={a.handle} className={mergeClasses(s.card, s.stack)}>
            <div className={s.row}>
              <p className={s.title}>@{a.handle}</p>
              <Badge appearance="tint" color={LEVEL_COLOR[a.level] ?? 'danger'}>
                Level {a.level}: {LEVEL_LABEL[a.level]}
              </Badge>
            </div>
            <p className={s.text}>{a.reason || 'All well: X hasn’t pushed back.'}</p>
            <p className={s.meta}>
              {a.fullStop
                ? 'Stopped for safety: nothing resumes until you decide in Xomoni.'
                : a.pace < 1
                  ? `Working at ${a.pace === 0.5 ? 'half' : 'a quarter'} of its usual pace${a.reducedUntil ? ` until ${formatDate(a.reducedUntil)}` : ''}.`
                  : 'Working at its usual pace: a fifth of X’s limits at most.'}
              {a.resumeAt && a.resumeAt > now && ` Jobs may resume after ${formatTime(a.resumeAt)}.`}
            </p>
          </li>
        ))}
      </ul>
      <div>
        <Button appearance="subtle" size="small" icon={<ArrowClockwise16Regular />} onClick={reload}>
          Read again
        </Button>
      </div>
    </div>
  );
}

/** Watch (#233): each search tab, when it last looked, and the newest posts it found. */
export function WatchPlace({ xomoni, now }: { xomoni: XomoniControls; now: number }) {
  const s = useStyles();
  const { answer, loading, reload } = useXomoniRead(xomoni, { what: 'watch' });
  if (xomoni.presence.kind !== 'here') return <NotHere xomoni={xomoni} page="watch" what="Watch" />;
  const tabs = answer?.ok && answer.what === 'watch' ? answer.tabs : null;
  return (
    <div className={s.root}>
      <Notice>
        Read from Xomoni in this browser. Watch looks while Xomoni’s dashboard is open; change the searches in Settings.
      </Notice>
      {loading && !tabs && <Spinner size="small" label="Reading Xomoni…" />}
      {answer && !answer.ok && <NoAnswer reason={answer.reason} />}
      {tabs?.length === 0 && <p className={s.text}>No searches yet.</p>}
      {(tabs ?? []).map((tab) => (
        <section key={tab.query} className={mergeClasses(s.card, s.stack)} aria-label={`Watch: ${tab.query}`}>
          <div className={s.row}>
            <p className={s.title}>{tab.query}</p>
            <span className={s.meta}>
              {tab.checkedAt ? `Looked ${relativeTime(new Date(tab.checkedAt).toISOString(), now)}` : 'Not looked yet'}
            </span>
          </div>
          {tab.error && <p className={s.text}>{tab.error}</p>}
          {tab.posts.length === 0 && !tab.error ? (
            <p className={s.meta}>Nothing found yet.</p>
          ) : (
            <ul className={s.list}>
              {tab.posts.map((p) => (
                <li key={p.id} className={s.item}>
                  <span className={s.meta}>
                    {p.name ? `${p.name} ` : ''}@{p.handle}
                    {p.time ? ` · ${relativeTime(new Date(p.time).toISOString(), now)}` : ''}
                  </span>
                  <p className={s.body}>{p.text}</p>
                  <a className={s.meta} href={postUrl(p.id)} target="_blank" rel="noreferrer noopener">
                    Open on X <Open12Regular />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <div>
        <Button appearance="subtle" size="small" icon={<ArrowClockwise16Regular />} onClick={reload}>
          Read again
        </Button>
      </div>
    </div>
  );
}
