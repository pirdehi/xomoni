import {
  Body1,
  Body1Strong,
  Caption1,
  Input,
  Link,
  Tab,
  TabList,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  Add16Regular,
  Delete16Regular,
  Info20Regular,
  Open16Regular,
  Pause16Regular,
  Play16Regular,
  Search20Regular,
  Warning20Regular,
} from '@fluentui/react-icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { type SyntheticEvent, useEffect, useEffectEvent, useId, useState } from 'react';
import { runner } from '../../engine/platform';
import { watchJob } from '../../engine/runner';
import {
  addWatchTab,
  db,
  markWatchSeen,
  removeWatchTab,
  setReadyTab,
  setWatchQuery,
  watchResults,
  watchSeen,
  watchTabs,
} from '../../shared/db';
import {
  MAX_QUERY_LENGTH,
  READY_TABS,
  READY_TAB_LABELS,
  type ReadyTab,
  WATCH_EVERY_MS,
  WATCH_POSTS,
  WATCH_TABS,
  type WatchResult,
  type WatchTab,
  accountAge,
  isInitialTab,
  isNewAccount,
  normalizeQuery,
  readyQuery,
  unseenNewAccounts,
  withQueries,
} from '../../shared/watch';
import { fmtAgo, postUrl } from '../format';
import { startJob, useRunner } from '../hooks';
import type { PageProps } from '../navigation';
import { Badge, Button, Callout, Card, EmptyState, Field, PageHeader, Toggle, useNow } from '../components/ui';

const useStyles = makeStyles({
  tabs: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: tokens.spacingHorizontalS },
  panel: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
  // The buttons line up with the input; the hint goes under the whole row, so it doesn't push them down (#240).
  form: { display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
  hint: { display: 'block', marginTop: `calc(-1 * ${tokens.spacingVerticalS})`, color: tokens.colorNeutralForeground3 },
  start: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', rowGap: tokens.spacingVerticalXXS },
  query: { flexGrow: 1, minWidth: '240px' },
  input: { width: '100%' },
  meta: { color: tokens.colorNeutralForeground3 },
  posts: { listStyleType: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' },
  post: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalXXS,
    paddingBlock: tokens.spacingVerticalM,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  author: { display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: tokens.spacingHorizontalS },
  text: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: 0 },
  open: { display: 'inline-flex', alignItems: 'center', columnGap: tokens.spacingHorizontalXXS },
  ready: { display: 'flex', flexWrap: 'wrap', gap: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalXXL}` },
  readyToggle: { flexBasis: '18rem', flexGrow: 1, minWidth: 0 },
  // The query a ready tab searches, as X's search gets it.
  code: { fontFamily: tokens.fontFamilyMonospace, overflowWrap: 'anywhere' },
  // The tab's mark: a dot in the warning color, with its count read out to assistive technology.
  mark: {
    display: 'inline-block',
    width: '8px',
    height: '8px',
    marginInlineStart: tokens.spacingHorizontalXS,
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorStatusWarningForeground1,
    verticalAlign: 'middle',
  },
  hidden: {
    position: 'absolute',
    width: '1px',
    height: '1px',
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
  },
});

const tabLabel = (tab: WatchTab, index: number) =>
  tab.ready ? READY_TAB_LABELS[tab.ready] : tab.query || `Tab ${index + 1}`;

/** What each ready tab finds, in a sentence under its switch. */
const READY_TAB_HINTS: Readonly<Record<ReadyTab, string>> = {
  mentions: 'Posts by others that name you.',
  replies: 'Replies to your posts.',
};

/**
 * Watch (#158, ADR-0021): up to five tabs, two by default, each following a phrase or #hashtag in X's search. The
 * watch job checks each about once a minute, within the read budget, and this page shows the newest posts. It
 * only reads: every post links to X, where the person likes or replies themselves.
 */
export function WatchPage({ account }: PageProps) {
  const styles = useStyles();
  const run = useRunner();
  const stored = useLiveQuery(() => watchTabs(account.id), [account.id]);
  // A ready tab's query is the account's own (#391), so it follows the account and its handle.
  const tabs = stored && withQueries(stored, account.handle);
  const results = useLiveQuery(() => watchResults(account.id), [account.id]);
  const seen = useLiveQuery(() => watchSeen(account.id), [account.id]);
  const unseen = tabs && results && seen ? unseenNewAccounts(tabs, results, seen) : {};
  const [full, setFull] = useState(false);
  const job = useLiveQuery(
    () =>
      db.jobs
        .where('accountId')
        .equals(account.id)
        .filter((j) => j.kind === 'watch' && j.finishedAt == null)
        .first(),
    [account.id],
  );
  const [selected, setSelected] = useState('tab-1');
  const current = tabs?.find((t) => t.id === selected) ?? tabs?.[0];

  const watching = run.status !== 'idle' && !!job && run.jobId === job.id;
  const otherJob = run.status !== 'idle' && !watching;
  const anyQuery = !!tabs?.some((t) => t.query);

  const addTab = async () => {
    const id = await addWatchTab(account.id);
    if (id) setSelected(id);
  };
  const removeTab = async (tab: WatchTab) => {
    await removeWatchTab(account.id, tab.id);
    setSelected('tab-1');
  };
  const start = async () => startJob((await watchJob(account.id)).id);
  const toggleReady = async (ready: ReadyTab, on: boolean) => {
    const done = await setReadyTab(account.id, ready, on);
    setFull(!done);
    if (done && on) setSelected(ready);
  };

  return (
    <>
      <PageHeader
        title="Watch"
        description={`Follow up to ${WATCH_TABS.max} phrases or #hashtags in X’s search. Xomoni checks each about once a minute, within its read limits, and shows the ${WATCH_POSTS} newest posts. It only reads: liking and replying are yours to do on X.`}
        actions={
          watching ? (
            <Button icon={<Pause16Regular />} onClick={() => runner.pause()} disabled={run.status === 'stopping'}>
              {run.status === 'stopping' ? 'Stopping…' : 'Pause watching'}
            </Button>
          ) : (
            <div className={styles.start}>
              <Button
                variant="primary"
                icon={<Play16Regular />}
                onClick={() => void start()}
                disabled={otherJob || !anyQuery}
              >
                Start watching
              </Button>
              {/* A disabled button says nothing on its own (#240). */}
              {!anyQuery && <Caption1 className={styles.meta}>Save a phrase or #hashtag first.</Caption1>}
            </div>
          )
        }
      />
      {otherJob && (
        <Callout tone="neutral" icon={<Info20Regular />}>
          Watching waits while another job runs: Xomoni has one X window. Pause that job, or start watching once it
          ends.
        </Callout>
      )}
      <Card
        title="About you"
        subtitle="Ready searches for what is said to and about you on X. Each counts as one of the five tabs. A post from an account made in the last 30 days is marked, from what X's search shows; the toolbar's badge counts the ones you haven't seen."
      >
        <div className={styles.ready}>
          {READY_TABS.map((ready) => {
            const on = !!tabs?.some((t) => t.ready === ready);
            const query = readyQuery(ready, account.handle);
            return (
              <div key={ready} className={styles.readyToggle}>
                <Toggle
                  checked={on}
                  onChange={(v) => void toggleReady(ready, v)}
                  disabled={!tabs || !query || (!on && tabs.length >= WATCH_TABS.max)}
                  label={READY_TAB_LABELS[ready]}
                  description={
                    <>
                      {READY_TAB_HINTS[ready]} Searches X for <span className={styles.code}>{query}</span>
                    </>
                  }
                />
              </div>
            );
          })}
        </div>
        {(full ||
          (tabs && tabs.length >= WATCH_TABS.max && READY_TABS.some((r) => !tabs.some((t) => t.ready === r)))) && (
          <Caption1 as="p" className={styles.meta}>
            {`All ${String(WATCH_TABS.max)} tabs are in use: remove a tab of your own to turn on another.`}
          </Caption1>
        )}
      </Card>
      <Card>
        <div className={styles.panel}>
          <div className={styles.tabs}>
            <TabList
              // Always a value: Fluent decides once whether a TabList is controlled.
              selectedValue={current?.id ?? selected}
              onTabSelect={(_, data) => setSelected(String(data.value))}
              aria-label="Watched searches"
            >
              {tabs?.map((tab, i) => (
                <Tab key={tab.id} value={tab.id}>
                  {tabLabel(tab, i)}
                  {unseen[tab.id] ? (
                    <>
                      <span className={styles.mark} aria-hidden />
                      <span className={styles.hidden}>
                        {`, ${String(unseen[tab.id])} new ${unseen[tab.id] === 1 ? 'account' : 'accounts'}`}
                      </span>
                    </>
                  ) : null}
                </Tab>
              ))}
            </TabList>
            <Button
              size="sm"
              variant="ghost"
              icon={<Add16Regular />}
              onClick={() => void addTab()}
              disabled={!tabs || tabs.length >= WATCH_TABS.max}
            >
              Add tab
            </Button>
          </div>
          {current && tabs && (
            <TabPanel
              // A new query, saved here or elsewhere, starts the field from it.
              key={`${current.id}:${current.query}`}
              tab={current}
              result={results?.[current.id]}
              watching={watching}
              onSeen={(ids) => void markWatchSeen(account.id, current.id, ids)}
              onQuery={(query) => void setWatchQuery(account.id, current.id, query)}
              onRemove={isInitialTab(current) || current.ready ? null : () => void removeTab(current)}
            />
          )}
        </div>
      </Card>
      <Caption1 as="p" block className={styles.meta}>
        Checks share Xomoni’s read limits with cleanups: at most 60 searches every 15 minutes, and 120 page loads an
        hour for an account not known to be Premium. More tabs, or a long day, space the checks further apart.
      </Caption1>
    </>
  );
}

/** One tab: its query, when it was last checked, and the newest posts of that check. */
function TabPanel({
  tab,
  result,
  watching,
  onSeen,
  onQuery,
  onRemove,
}: {
  tab: WatchTab;
  result: WatchResult | undefined;
  watching: boolean;
  /** The posts from new accounts the person now sees, for the toolbar's badge (#391). */
  onSeen: (ids: string[]) => void;
  onQuery: (query: string) => void;
  onRemove: (() => void) | null;
}) {
  const styles = useStyles();
  const now = useNow(5000);
  const [draft, setDraft] = useState(tab.query);
  const hintId = useId();
  const fresh = result && result.query === tab.query ? result : undefined;
  const fromNew = fresh?.posts.filter((post) => isNewAccount(post.accountCreatedAt, fresh.checkedAt)) ?? [];
  const newIds = fromNew.map((post) => post.id).join(' ');
  // A ready tab's posts from new accounts, once on screen, are seen: they leave the toolbar's count.
  const markSeen = useEffectEvent((ids: string[]) => onSeen(ids));
  useEffect(() => {
    if (tab.ready && newIds) markSeen(newIds.split(' '));
  }, [tab.ready, newIds]);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    onQuery(normalizeQuery(draft));
  };

  return (
    <div
      role="tabpanel"
      aria-label={tab.ready ? READY_TAB_LABELS[tab.ready] : tab.query || 'Empty tab'}
      className={styles.panel}
    >
      {tab.ready ? (
        <Caption1 as="p" className={styles.meta}>
          Searches X for <span className={styles.code}>{tab.query}</span>: your account’s, whichever account the X
          window is signed in to. Turn it off under About you.
        </Caption1>
      ) : (
        <>
          <form className={styles.form} onSubmit={submit}>
            <div className={styles.query}>
              <Field label="Phrase or #hashtag">
                <Input
                  className={styles.input}
                  dir="auto"
                  aria-describedby={hintId}
                  value={draft}
                  maxLength={MAX_QUERY_LENGTH}
                  placeholder="#hashtag"
                  onChange={(_, data) => setDraft(data.value)}
                />
              </Field>
            </div>
            <Button type="submit" disabled={normalizeQuery(draft) === tab.query}>
              Save
            </Button>
            {onRemove && (
              <Button variant="ghost" icon={<Delete16Regular />} onClick={onRemove}>
                Remove tab
              </Button>
            )}
          </form>
          <Caption1 id={hintId} className={styles.hint}>
            A word, #hashtag or "exact phrase". X’s search operators work too.
          </Caption1>
        </>
      )}

      {!tab.query ? (
        <EmptyState
          icon={<Search20Regular />}
          title="Nothing watched in this tab"
          body="Type a phrase or #hashtag and save it."
        />
      ) : !fresh ? (
        <Caption1 className={styles.meta}>
          {watching ? 'Searching soon…' : 'Not checked yet. Start watching to search X for it.'}
        </Caption1>
      ) : (
        <>
          <Caption1 className={styles.meta}>
            Checked {fmtAgo(fresh.checkedAt, now)}
            {watching &&
              ` · next check in about ${Math.max(0, Math.round((fresh.checkedAt + WATCH_EVERY_MS - now) / 1000))} s or when the read limits allow`}
          </Caption1>
          {fresh.error && (
            <Callout icon={<Warning20Regular />} tone="warn">
              {fresh.error}
            </Callout>
          )}
          {fresh.posts.length ? (
            <ul className={styles.posts} aria-label={`Newest posts for ${tab.query}`}>
              {fresh.posts.map((post) => (
                <li key={post.id} className={styles.post}>
                  <div className={styles.author}>
                    {post.name && <Body1Strong dir="auto">{post.name}</Body1Strong>}
                    <Caption1 className={styles.meta}>
                      @{post.handle}
                      {post.time != null && ` · ${fmtAgo(post.time, now)}`}
                    </Caption1>
                    {post.accountCreatedAt != null && isNewAccount(post.accountCreatedAt, fresh.checkedAt) && (
                      <Badge tone="warn">{accountAge(post.accountCreatedAt, now)}</Badge>
                    )}
                  </div>
                  <Body1 as="p" dir="auto" className={styles.text}>
                    {post.text}
                  </Body1>
                  <Link
                    href={postUrl(post.id, post.handle)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={styles.open}
                  >
                    <Open16Regular aria-hidden /> Open on X
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            !fresh.error && (
              <EmptyState
                icon={<Search20Regular />}
                title="No posts yet"
                body="X’s search shows nothing for this yet."
              />
            )
          )}
        </>
      )}
    </div>
  );
}
