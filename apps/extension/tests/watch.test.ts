import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type JobContext, Stop } from '../src/engine/context';
import { WATCH_TITLE, watchJob } from '../src/engine/runner';
import { NOTHING_TO_WATCH, NO_RESULTS_SHOWN, runWatch } from '../src/engine/watch';
import {
  addWatchTab,
  db,
  removeWatchTab,
  saveWatchResult,
  saveWatchTabs,
  setWatchQuery,
  watchResults,
  watchTabs,
} from '../src/shared/db';
import type { ActionResult, ActorCommand, ContentState } from '../src/shared/messages';
import {
  MAX_QUERY_LENGTH,
  WATCH_EVERY_MS,
  type WatchPost,
  type WatchTab,
  initialTabs,
  isInitialTab,
  newTabId,
  nextCheck,
  normalizeQuery,
  normalizeTabs,
  searchUrl,
} from '../src/shared/watch';

const ACCOUNT = 'acct-w';

const post = (id: string, text = `post ${id}`): WatchPost => ({
  id,
  handle: 'someone',
  name: 'Some One',
  text,
  time: 1,
});

describe('Watch tabs and queries (#158)', () => {
  it('starts with two empty tabs that can’t be removed', () => {
    expect(initialTabs()).toEqual([
      { id: 'tab-1', query: '' },
      { id: 'tab-2', query: '' },
    ]);
    expect(isInitialTab({ id: 'tab-2', query: 'x' })).toBe(true);
    expect(isInitialTab({ id: 'tab-3', query: 'x' })).toBe(false);
  });

  it('keeps stored tabs in order, at most five, and puts the two initial ones back', () => {
    const stored = [
      { id: 'tab-4', query: '  #a   b ' },
      { id: 'tab-3', query: 'c' },
      { id: 'tab-3', query: 'duplicate' },
      { id: 7, query: 'bad id' },
      { id: 'tab-9', query: null },
      { id: 'tab-5', query: 'e' },
      { id: 'tab-6', query: 'f' },
    ];
    expect(normalizeTabs(stored)).toEqual([
      { id: 'tab-1', query: '' },
      { id: 'tab-2', query: '' },
      { id: 'tab-3', query: 'c' },
      { id: 'tab-4', query: '#a b' },
      { id: 'tab-5', query: 'e' },
    ]);
    expect(normalizeTabs(null)).toEqual(initialTabs());
    expect(normalizeTabs('not a list')).toEqual(initialTabs());
  });

  it('numbers a new tab after the highest one', () => {
    expect(newTabId(initialTabs())).toBe('tab-3');
    expect(newTabId([...initialTabs(), { id: 'tab-5', query: '' }])).toBe('tab-6');
  });

  it('gives X’s “Latest” search a trimmed, encoded query of at most 100 characters', () => {
    expect(normalizeQuery('  "open   source"\n ')).toBe('"open source"');
    expect(normalizeQuery('x'.repeat(150))).toHaveLength(MAX_QUERY_LENGTH);
    expect(searchUrl('#برنامه_نویس')).toBe(
      `https://x.com/search?q=${encodeURIComponent('#برنامه_نویس')}&src=typed_query&f=live`,
    );
    expect(searchUrl('a&b=c')).toContain('q=a%26b%3Dc&');
  });

  it('checks the longest overdue tab with a query first, and a new or changed query at once', () => {
    const now = 1_000_000;
    const tabs: WatchTab[] = [
      { id: 'tab-1', query: '#a' },
      { id: 'tab-2', query: '' },
      { id: 'tab-3', query: '#c' },
    ];
    const at = (query: string, checkedAt: number) => ({ query, checkedAt, posts: [], error: '' });
    expect(nextCheck(tabs, { 'tab-1': at('#a', now - 10_000), 'tab-3': at('#c', now - 30_000) }, now)).toEqual({
      tab: tabs[2],
      at: now - 30_000 + WATCH_EVERY_MS,
    });
    expect(nextCheck(tabs, { 'tab-1': at('#a', now), 'tab-3': at('#old', now) }, now)).toEqual({
      tab: tabs[2],
      at: now,
    });
    expect(nextCheck(tabs, {}, now)?.at).toBe(now);
    expect(nextCheck([{ id: 'tab-1', query: '' }], {}, now)).toBeNull();
  });
});

describe('Watch storage (#158)', () => {
  beforeEach(async () => {
    await db.kv.clear();
  });

  it('stores tabs per account, and forgets the results of a removed tab', async () => {
    expect(await watchTabs(ACCOUNT)).toEqual(initialTabs());
    const tabs = [...initialTabs(), { id: 'tab-3', query: '#c' }];
    await saveWatchTabs(ACCOUNT, tabs);
    await saveWatchResult(ACCOUNT, 'tab-1', { query: '', checkedAt: 1, posts: [], error: '' });
    await saveWatchResult(ACCOUNT, 'tab-3', { query: '#c', checkedAt: 2, posts: [post('1')], error: '' });
    expect(Object.keys(await watchResults(ACCOUNT))).toEqual(['tab-1', 'tab-3']);

    await saveWatchTabs(ACCOUNT, initialTabs());
    expect(await watchTabs(ACCOUNT)).toEqual(initialTabs());
    expect(Object.keys(await watchResults(ACCOUNT))).toEqual(['tab-1']);
    expect(await watchTabs('another')).toEqual(initialTabs());
  });

  it('adds tabs one at a time up to five, even on quick clicks, and never removes the first two', async () => {
    const ids = await Promise.all([1, 2, 3, 4].map(() => addWatchTab(ACCOUNT)));
    expect(ids).toEqual(['tab-3', 'tab-4', 'tab-5', null]);
    await removeWatchTab(ACCOUNT, 'tab-1');
    await removeWatchTab(ACCOUNT, 'tab-4');
    expect((await watchTabs(ACCOUNT)).map((t) => t.id)).toEqual(['tab-1', 'tab-2', 'tab-3', 'tab-5']);
  });

  it('sets one tab’s query, normalized', async () => {
    await setWatchQuery(ACCOUNT, 'tab-2', '  #a   b ');
    await setWatchQuery(ACCOUNT, 'tab-9', '#nowhere');
    expect(await watchTabs(ACCOUNT)).toEqual([
      { id: 'tab-1', query: '' },
      { id: 'tab-2', query: '#a b' },
    ]);
  });
});

describe('the watch job (#158)', () => {
  beforeEach(async () => {
    await db.jobs.clear();
  });

  it('is one per account: Start watching resumes the one not finished', async () => {
    const first = await watchJob(ACCOUNT);
    expect(first).toMatchObject({ kind: 'watch', title: WATCH_TITLE, state: 'queued', filter: null, scan: null });
    expect((await watchJob(ACCOUNT)).id).toBe(first.id);
    await db.jobs.update(first.id, { state: 'cancelled', finishedAt: Date.now() });
    expect((await watchJob(ACCOUNT)).id).not.toBe(first.id);
  });
});

/** Ends a test run of `runWatch`, which otherwise loops until paused. */
class End extends Error {}

/**
 * A watch run over fake ports with its own clock: `cooldown` moves the clock to the end of the wait, and the run
 * ends after `rounds` passes of its loop. `pages` answers each search in turn.
 */
function watchRun(pages: { content: ContentState; posts?: WatchPost[] }[], rounds = 4) {
  let clock = 10_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  let page = pages[0];
  const urls: string[] = [];
  const ctx = {
    job: { id: 'w', accountId: ACCOUNT, stats: { matched: 0, done: 0, skipped: 0, failed: 0, scanned: 0 } },
    checkpoint: vi.fn(() => {
      if (rounds-- <= 0) throw new End();
    }),
    navigate: vi.fn(async (url: string) => {
      urls.push(url);
      page = pages[Math.min(urls.length - 1, pages.length - 1)];
      return page!.content;
    }),
    xTab: {
      send: vi.fn(async (command: ActorCommand) => {
        if (command.cmd !== 'readPosts') throw new Error(`unexpected ${command.cmd}`);
        return (page?.posts ?? []).slice(0, command.limit);
      }),
    },
    limiter: {
      cooldown: vi.fn(async (until: number) => {
        clock = Math.max(clock, until);
      }),
    },
    pageRateLimit: vi.fn(async (): Promise<ActionResult | null> => null),
    settle: vi.fn(async () => false),
    save: vi.fn(async () => {}),
  };
  const run = async () => {
    try {
      await runWatch(ctx as unknown as JobContext);
    } catch (err) {
      if (!(err instanceof End)) throw err;
    }
  };
  return { ctx, urls, run, now: () => clock };
}

const tweets = (count: number): ContentState => ({ kind: 'tweets', count, http: 200, unavailable: false });

describe('runWatch (#158)', () => {
  beforeEach(async () => {
    await db.kv.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('searches each tab with a query and keeps its 10 newest posts, read only', async () => {
    await saveWatchTabs(ACCOUNT, [
      { id: 'tab-1', query: '#xomoni' },
      { id: 'tab-2', query: '' },
    ]);
    const posts = Array.from({ length: 12 }, (_, i) => post(String(100 + i)));
    const { ctx, urls, run } = watchRun([{ content: tweets(12), posts }], 1);
    await run();

    expect(urls).toEqual([searchUrl('#xomoni')]);
    expect(ctx.xTab.send).toHaveBeenCalledWith({ cmd: 'readPosts', limit: 10 });
    // Reading posts is the only command: Watch never likes, replies or posts.
    expect(ctx.xTab.send.mock.calls.every(([c]) => c.cmd === 'readPosts')).toBe(true);
    const saved = (await watchResults(ACCOUNT))['tab-1'];
    expect(saved).toMatchObject({ query: '#xomoni', error: '' });
    expect(saved?.posts.map((p) => p.id)).toEqual(posts.slice(0, 10).map((p) => p.id));
    expect(ctx.job.stats).toMatchObject({ done: 1, scanned: 10 });
    expect(ctx.save).toHaveBeenCalled();
  });

  it('checks each tab again about once a minute, the most overdue first', async () => {
    await saveWatchTabs(ACCOUNT, [
      { id: 'tab-1', query: '#a' },
      { id: 'tab-2', query: '#b' },
    ]);
    const { ctx, urls, run } = watchRun([{ content: tweets(1), posts: [post('1')] }], 5);
    await run();

    // Both at once, then a wait of a minute for the first, then both again.
    expect(urls).toEqual([searchUrl('#a'), searchUrl('#b'), searchUrl('#a'), searchUrl('#b')]);
    expect(ctx.limiter.cooldown.mock.calls).toEqual([[10_000_000 + WATCH_EVERY_MS, 'Next search: #a']]);
  });

  it('picks up a query changed on the Watch page while it runs', async () => {
    await saveWatchTabs(ACCOUNT, [
      { id: 'tab-1', query: '#old' },
      { id: 'tab-2', query: '' },
    ]);
    const { ctx, urls, run } = watchRun([{ content: tweets(1), posts: [post('1')] }], 3);
    ctx.limiter.cooldown.mockImplementationOnce(async () => {
      await saveWatchTabs(ACCOUNT, [
        { id: 'tab-1', query: '#new' },
        { id: 'tab-2', query: '' },
      ]);
    });
    await run();

    expect(urls).toEqual([searchUrl('#old'), searchUrl('#new')]);
    expect((await watchResults(ACCOUNT))['tab-1']?.query).toBe('#new');
  });

  it('pauses itself when no tab has a query', async () => {
    const { run, urls } = watchRun([{ content: tweets(0) }]);
    const err = await run().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Stop);
    expect(err).toMatchObject({ state: 'paused', message: NOTHING_TO_WATCH });
    expect(urls).toEqual([]);
  });

  it('stores an empty search as no posts, without an error', async () => {
    await saveWatchTabs(ACCOUNT, [
      { id: 'tab-1', query: '#quiet' },
      { id: 'tab-2', query: '' },
    ]);
    const { ctx, run } = watchRun([{ content: { kind: 'empty', count: 0, http: 200, unavailable: false } }], 1);
    await run();
    expect((await watchResults(ACCOUNT))['tab-1']).toMatchObject({ posts: [], error: '' });
    expect(ctx.xTab.send).not.toHaveBeenCalled();
  });

  it('keeps the last posts and says so when X shows no results', async () => {
    await saveWatchTabs(ACCOUNT, [
      { id: 'tab-1', query: '#a' },
      { id: 'tab-2', query: '' },
    ]);
    const { run } = watchRun(
      [
        { content: tweets(1), posts: [post('7')] },
        { content: { kind: 'timeout', count: 0, http: 0, unavailable: false } },
      ],
      3,
    );
    await run();
    const saved = (await watchResults(ACCOUNT))['tab-1'];
    expect(saved).toMatchObject({ error: NO_RESULTS_SHOWN });
    expect(saved?.posts.map((p) => p.id)).toEqual(['7']);
  });

  it('waits out X’s rate limit and stores nothing for that check', async () => {
    await saveWatchTabs(ACCOUNT, [
      { id: 'tab-1', query: '#busy' },
      { id: 'tab-2', query: '' },
    ]);
    const limited: ActionResult = { outcome: 'rate_limited', resetAt: 1, message: 'Search: X’s rate limit reached' };
    const { ctx, run } = watchRun([{ content: { kind: 'error', count: 0, http: 429, unavailable: false } }], 1);
    ctx.pageRateLimit.mockResolvedValue(limited);
    await run();

    expect(ctx.settle).toHaveBeenCalledWith('read', null, limited);
    expect(await watchResults(ACCOUNT)).toEqual({});
    expect(ctx.job.stats.done).toBe(0);
  });
});
