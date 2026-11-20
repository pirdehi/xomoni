'use client';
// Comments on xomoni.com (#256), in two tabs. *Your replies*, read from Xomoni in this browser (ADR-0028), found by
// date, likes, whom they answer and words, and picked for a cleanup that Xomoni starts only after its own
// confirmation (ADR-0027). *Replies to you* (`replies-to-you.tsx`, ADR-0030). What the place shows is X content: it
// stays in this page's memory, and is never stored, logged or sent. On Fluent UI (ADR-0019).
import {
  Badge,
  Button,
  Checkbox,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Spinner,
  Switch,
  Tab,
  TabList,
  makeStyles,
  mergeClasses,
  tokens,
  typographyStyles,
} from '@fluentui/react-components';
import { ArrowClockwise16Regular, Open12Regular, Open16Regular, Search16Regular } from '@fluentui/react-icons';
import { MAX_PLAN_IDS, type RepliesFilter, type ReplyItem } from '@xomoni/bridge';
import { useState } from 'react';
import { type XomoniControls, useXomoniRead } from '@/modules/extension/ui/xomoni-actions';
import { FIRST_DAY } from '../domain/cleanup-plan';
import { DEFAULT_REPLIES_FORM, type RepliesForm, pickedPlan, toRepliesFilter, typedHandle } from '../domain/comments';
import { formatCount } from './charts';
import { useSettled } from './cleanup-place';
import { RepliesToYou } from './replies-to-you';
import { NoAnswer, NotHere, Notice, formatDate, postUrl } from './xomoni-places';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalL },
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
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: tokens.spacingHorizontalL },
  center: { alignItems: 'center' },
  field: { minWidth: '150px', maxWidth: '220px', flexGrow: 1 },
  search: { minWidth: '200px', maxWidth: '360px', flexGrow: 2 },
  people: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
  list: { display: 'grid', rowGap: tokens.spacingVerticalS, margin: 0, padding: 0, listStyleType: 'none' },
  item: {
    display: 'flex',
    alignItems: 'flex-start',
    columnGap: tokens.spacingHorizontalS,
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  itemBody: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalXS, minWidth: 0, flexGrow: 1 },
  body: { ...typographyStyles.body1, margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  // Stays in view while the list scrolls, so the picks can be handed over from anywhere in it.
  picked: { position: 'sticky', bottom: tokens.spacingVerticalM, zIndex: 1, boxShadow: tokens.shadow8 },
});

/**
 * Comments (#256). *Your replies*: the person's replies still on X, found by date, likes, whom they answer and words,
 * with whom they reply to most. Picked replies go to Xomoni, which opens its Cleanup page with only those; nothing is
 * removed until the person confirms there. *Replies to you*: what others replied, as Xomoni kept it (ADR-0030). The
 * filter and the picks stay while the other tab is open.
 */
export function CommentsPlace({ xomoni, now }: { xomoni: XomoniControls; now: number }) {
  const s = useStyles();
  const [form, setForm] = useState<RepliesForm>(DEFAULT_REPLIES_FORM);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [tab, setTab] = useState<'mine' | 'theirs'>('mine');
  const result = toRepliesFilter(form, now);
  // Settled by its text, so typing a word or a handle asks Xomoni once it pauses.
  const settled = useSettled('filter' in result ? JSON.stringify(result.filter) : '', 300);

  if (xomoni.presence.kind !== 'here')
    return (
      <NotHere
        xomoni={xomoni}
        page="library"
        what="Comments"
        says="Your replies, and the replies you get, are read from Xomoni on your computer, in this browser: they never reach our servers. Open this page in the browser where Xomoni runs, signed in to this account."
      />
    );

  const set = <K extends keyof RepliesForm>(key: K, value: RepliesForm[K]) => setForm({ ...form, [key]: value });
  const pick = (ids: readonly string[], on: boolean) => {
    const next = new Set(picked);
    for (const id of ids) {
      if (!on) next.delete(id);
      else if (next.size < MAX_PLAN_IDS) next.add(id);
    }
    setPicked(next);
  };
  return (
    <div className={s.root}>
      <Notice>Read from Xomoni in this browser: replies never reach our servers.</Notice>
      <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value === 'theirs' ? 'theirs' : 'mine')}>
        <Tab value="mine">Your replies</Tab>
        <Tab value="theirs">Replies to you</Tab>
      </TabList>
      {tab === 'theirs' ? (
        <RepliesToYou xomoni={xomoni} now={now} />
      ) : (
        <>
          <section className={s.card} aria-labelledby="find-title">
            <h2 id="find-title" className={s.title}>
              Find your replies
            </h2>
            <div className={s.row}>
              <Field label="From" className={s.field}>
                <Input type="date" min={FIRST_DAY} value={form.from} onChange={(_, d) => set('from', d.value)} />
              </Field>
              <Field label="Through" className={s.field}>
                <Input type="date" min={FIRST_DAY} value={form.through} onChange={(_, d) => set('through', d.value)} />
              </Field>
              <Field label="At most … likes" className={s.field}>
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={form.likes}
                  onChange={(_, d) => set('likes', d.value)}
                />
              </Field>
              <Field label="Replying to" className={s.field}>
                <Input
                  contentBefore="@"
                  placeholder="anyone"
                  value={typedHandle(form.who)}
                  onChange={(_, d) => set('who', d.value)}
                />
              </Field>
              <Field label="Words" className={s.search}>
                <Input
                  contentBefore={<Search16Regular />}
                  placeholder="In the text"
                  value={form.words}
                  onChange={(_, d) => set('words', d.value)}
                />
              </Field>
            </div>
            <Switch
              label="Include replies in your own threads"
              checked={form.threads}
              onChange={(_, d) => set('threads', d.checked)}
            />
            {'problem' in result && (
              <MessageBar intent="warning">
                <MessageBarBody>{result.problem}</MessageBarBody>
              </MessageBar>
            )}
          </section>
          {settled && (
            <Replies
              key={settled}
              xomoni={xomoni}
              filter={JSON.parse(settled) as RepliesFilter}
              who={typedHandle(form.who)}
              onWho={(handle) => set('who', handle)}
              picked={picked}
              onPick={pick}
            />
          )}
          {picked.size > 0 && (
            <section className={mergeClasses(s.card, s.picked)} aria-label="Picked replies">
              <div className={mergeClasses(s.row, s.center)}>
                <span className={s.text} role="status">
                  {formatCount(picked.size)} {picked.size === 1 ? 'reply' : 'replies'} picked
                  {picked.size >= MAX_PLAN_IDS && ` (the most at a time)`}
                </span>
                <Button
                  appearance="primary"
                  icon={<Open16Regular />}
                  disabled={xomoni.busy === 'plan'}
                  onClick={() => void xomoni.request({ kind: 'plan', plan: pickedPlan([...picked], Date.now()) })}
                >
                  Review and remove in Xomoni
                </Button>
                <Button appearance="subtle" onClick={() => setPicked(new Set())}>
                  Clear
                </Button>
              </div>
              <p className={s.meta}>
                Xomoni opens its Cleanup page with only these replies. Nothing is removed until you confirm there.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** The replies matching `filter`, 100 at a time, with whom the person replies to most; one list per filter. */
function Replies({
  xomoni,
  filter,
  who,
  onWho,
  picked,
  onPick,
}: {
  xomoni: XomoniControls;
  filter: RepliesFilter;
  who: string;
  onWho: (handle: string) => void;
  picked: ReadonlySet<string>;
  onPick: (ids: readonly string[], on: boolean) => void;
}) {
  const s = useStyles();
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState<ReplyItem[]>([]);
  const { answer, loading, reload } = useXomoniRead(xomoni, { what: 'replies', filter, offset });
  if (answer && !answer.ok) return <NoAnswer reason={answer.reason} doing="list your replies" />;
  const page = answer?.ok && answer.what === 'replies' ? answer.page : null;
  if (!page) return loading ? <Spinner size="small" label="Reading your replies in Xomoni…" /> : null;
  // While the next page is read, the answer is still the last one: each reply is listed once.
  const listed = new Set(more.map((item) => item.id));
  const items = [...more, ...page.items.filter((item) => !listed.has(item.id))];
  const shown = items.map((item) => item.id);
  const next = page.next;
  const allPicked = shown.length > 0 && shown.every((id) => picked.has(id));
  const somePicked = shown.some((id) => picked.has(id));
  const full = picked.size >= MAX_PLAN_IDS;
  return (
    <>
      {page.people.length > 0 && (
        <section className={s.card} aria-labelledby="people-title">
          <h2 id="people-title" className={s.title}>
            You reply most to
          </h2>
          <div className={s.people}>
            {page.people.map((person) => {
              const chosen = person.handle.toLowerCase() === who.toLowerCase();
              return (
                <Button
                  key={person.handle}
                  size="small"
                  appearance={chosen ? 'primary' : 'outline'}
                  aria-pressed={chosen}
                  onClick={() => onWho(chosen ? '' : person.handle)}
                >
                  @{person.handle} · {formatCount(person.replies)}
                </Button>
              );
            })}
          </div>
          <p className={s.meta}>Your own threads are left out. Pick someone to see only your replies to them.</p>
        </section>
      )}
      <section className={s.card} aria-labelledby="list-title">
        <div className={mergeClasses(s.row, s.center)}>
          <h2 id="list-title" className={s.title}>
            {formatCount(page.matching)} of {formatCount(page.total)} {page.total === 1 ? 'reply' : 'replies'}
          </h2>
          {loading && <Spinner size="extra-tiny" />}
          <Button appearance="subtle" size="small" icon={<ArrowClockwise16Regular />} onClick={reload}>
            Read again
          </Button>
        </div>
        {items.length === 0 ? (
          <p className={s.text}>
            {page.total === 0 ? 'Xomoni knows none of your replies yet.' : 'None of your replies match.'}
          </p>
        ) : (
          <>
            <Checkbox
              label={`Pick all ${formatCount(items.length)} shown`}
              checked={allPicked ? true : somePicked ? 'mixed' : false}
              disabled={full && !allPicked && !somePicked}
              onChange={(_, d) => onPick(shown, d.checked === true)}
            />
            <ul className={s.list} aria-label="Your replies">
              {items.map((item) => (
                <ReplyRow key={item.id} item={item} picked={picked.has(item.id)} full={full} onPick={onPick} />
              ))}
            </ul>
          </>
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

/** One reply: whom it answers, when, what it got, its text, and the box that picks it. */
function ReplyRow({
  item,
  picked,
  full,
  onPick,
}: {
  item: ReplyItem;
  picked: boolean;
  full: boolean;
  onPick: (ids: readonly string[], on: boolean) => void;
}) {
  const s = useStyles();
  const day = formatDate(item.createdAt);
  return (
    <li className={s.item}>
      <Checkbox
        aria-label={`Pick your reply of ${day}`}
        checked={picked}
        disabled={full && !picked}
        onChange={(_, d) => onPick([item.id], d.checked === true)}
      />
      <div className={s.itemBody}>
        <div className={mergeClasses(s.row, s.center)}>
          <span className={s.meta}>
            {item.replyTo ? `To @${item.replyTo}` : 'To someone Xomoni hasn’t seen yet'} · {day} ·{' '}
            {formatCount(item.likes)} {item.likes === 1 ? 'like' : 'likes'} · {formatCount(item.replies)}{' '}
            {item.replies === 1 ? 'reply' : 'replies'}
          </span>
          {item.thread && (
            <Badge appearance="tint" color="informative" size="small">
              Your thread
            </Badge>
          )}
        </div>
        <p className={s.body}>{item.text || '(no text)'}</p>
        <a className={s.meta} href={postUrl(item.id)} target="_blank" rel="noreferrer noopener">
          Open on X <Open12Regular />
        </a>
      </div>
    </li>
  );
}
