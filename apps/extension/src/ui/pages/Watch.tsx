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
import { type SyntheticEvent, useState } from 'react';
import { runner } from '../../engine/platform';
import { watchJob } from '../../engine/runner';
import { addWatchTab, db, removeWatchTab, setWatchQuery, watchResults, watchTabs } from '../../shared/db';
import {
  MAX_QUERY_LENGTH,
  WATCH_EVERY_MS,
  WATCH_POSTS,
  WATCH_TABS,
  type WatchResult,
  type WatchTab,
  isInitialTab,
  normalizeQuery,
} from '../../shared/watch';
import { fmtAgo, postUrl } from '../format';
import { startJob, useRunner } from '../hooks';
import type { PageProps } from '../navigation';
import { Button, Callout, Card, EmptyState, Field, PageHeader, useNow } from '../components/ui';

const useStyles = makeStyles({
  tabs: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: tokens.spacingHorizontalS },
  panel: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
  form: { display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
  query: { flexGrow: 1, minWidth: '240px' },
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
});

const tabLabel = (tab: WatchTab, index: number) => tab.query || `Tab ${index + 1}`;

/**
 * Watch (#158, ADR-0021): up to five tabs, two by default, each following a phrase or #hashtag in X's search. The
 * watch job checks each about once a minute, within the read budget, and this page shows the newest posts. It
 * only reads: every post links to X, where the person likes or replies themselves.
 */
export function WatchPage({ account }: PageProps) {
  const styles = useStyles();
  const run = useRunner();
  const tabs = useLiveQuery(() => watchTabs(account.id), [account.id]);
  const results = useLiveQuery(() => watchResults(account.id), [account.id]);
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
            <Button
              variant="primary"
              icon={<Play16Regular />}
              onClick={() => void start()}
              disabled={otherJob || !anyQuery}
            >
              Start watching
            </Button>
          )
        }
      />
      {otherJob && (
        <Callout tone="neutral" icon={<Info20Regular />}>
          Watching waits while another job runs: Xomoni has one X window. Pause that job, or start watching once it
          ends.
        </Callout>
      )}
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
              onQuery={(query) => void setWatchQuery(account.id, current.id, query)}
              onRemove={isInitialTab(current) ? null : () => void removeTab(current)}
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
  onQuery,
  onRemove,
}: {
  tab: WatchTab;
  result: WatchResult | undefined;
  watching: boolean;
  onQuery: (query: string) => void;
  onRemove: (() => void) | null;
}) {
  const styles = useStyles();
  const now = useNow(5000);
  const [draft, setDraft] = useState(tab.query);
  const fresh = result && result.query === tab.query ? result : undefined;

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    onQuery(normalizeQuery(draft));
  };

  return (
    <div role="tabpanel" aria-label={tab.query || 'Empty tab'} className={styles.panel}>
      <form className={styles.form} onSubmit={submit}>
        <div className={styles.query}>
          <Field label="Phrase or #hashtag" hint={'A word, #hashtag or "exact phrase". X’s search operators work too.'}>
            <Input
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
