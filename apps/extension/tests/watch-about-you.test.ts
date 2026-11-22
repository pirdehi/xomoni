import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobContext } from '../src/engine/context';
import { runWatch } from '../src/engine/watch';
import {
  db,
  markWatchSeen,
  saveWatchResult,
  saveWatchTabs,
  setReadyTab,
  setWatchQueries,
  upsertAccount,
  watchResults,
  watchSeen,
  watchTabs,
} from '../src/shared/db';
import { extractTweets } from '../src/shared/graphql';
import { checkMoveText } from '../src/shared/move-file';
import { exportData, importData } from '../src/shared/move';
import type { ActionResult, ActorCommand, ContentState } from '../src/shared/messages';
import {
  NEW_ACCOUNT_DAYS,
  type WatchPost,
  type WatchResult,
  type WatchTab,
  accountAge,
  badgeText,
  isNewAccount,
  normalizeTabs,
  readyQuery,
  searchUrl,
  unseenNewAccounts,
  withQueries,
} from '../src/shared/watch';
import { showWatchBadge, watchBadgeCount } from '../src/ui/watch-badge';

// Watch's ready tabs and the new accounts in them (#391, ADR-0021): the queries for the signed-in account, the age
// of an author's account read from X's search answer, the 30-day line, and the toolbar's count.

const ACCOUNT = '9000000000000000777';
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 22, 12);

const post = (id: string, accountCreatedAt?: number): WatchPost => ({
  id,
  handle: `author_${id}`,
  name: '',
  text: `post ${id}`,
  time: NOW - 60_000,
  ...(accountCreatedAt !== undefined && { accountCreatedAt }),
});

const result = (query: string, posts: WatchPost[], over: Partial<WatchResult> = {}): WatchResult => ({
  query,
  checkedAt: NOW,
  posts,
  error: '',
  ...over,
});

describe('the ready tabs’ searches (#391)', () => {
  it('search mentions by others and replies to the account, for handles with _ and digits', () => {
    expect(readyQuery('mentions', 'xomoni_fixture')).toBe('@xomoni_fixture -from:xomoni_fixture');
    expect(readyQuery('replies', 'xomoni_fixture')).toBe('to:xomoni_fixture');
    expect(readyQuery('mentions', 'Ada_99')).toBe('@Ada_99 -from:Ada_99');
    expect(readyQuery('replies', '_1')).toBe('to:_1');
  });

  it('search nothing for a handle X wouldn’t have, so no other search can slip in', () => {
    for (const handle of ['', 'has space', 'a-b', 'x OR y', '@ada', 'way_too_long_for_a_handle_on_x']) {
      expect(readyQuery('mentions', handle)).toBe('');
      expect(readyQuery('replies', handle)).toBe('');
    }
  });

  it('follow the account: each ready tab takes the handle it is given, other tabs keep their own', () => {
    const tabs: WatchTab[] = [
      { id: 'tab-1', query: '#xomoni' },
      { id: 'mentions', query: '', ready: 'mentions' },
      { id: 'replies', query: 'stale', ready: 'replies' },
    ];
    expect(withQueries(tabs, 'ada').map((t) => t.query)).toEqual(['#xomoni', '@ada -from:ada', 'to:ada']);
    expect(withQueries(tabs, 'bea').map((t) => t.query)).toEqual(['#xomoni', '@bea -from:bea', 'to:bea']);
  });

  it('are kept by name only, after the first two tabs and before the person’s own, and a forged one is dropped', () => {
    const tabs = normalizeTabs([
      { id: 'tab-3', query: 'third' },
      { id: 'replies', query: 'to:someone_else', ready: 'replies' },
      { id: 'tab-1', query: 'first' },
      { id: 'mentions', query: '', ready: 'mentions' },
      // Not a ready tab's name, or a name with another kind: never a ready tab.
      { id: 'tab-9', query: '', ready: 'mentions' },
      { id: 'mentions', query: '', ready: 'replies' },
      { id: 'blocked', query: '', ready: 'blocked' },
    ]);
    expect(tabs).toEqual([
      { id: 'tab-1', query: 'first' },
      { id: 'tab-2', query: '' },
      { id: 'mentions', query: '', ready: 'mentions' },
      { id: 'replies', query: '', ready: 'replies' },
      { id: 'tab-3', query: 'third' },
    ]);
  });
});

describe('new accounts (#391)', () => {
  it('are made fewer than 30 days before the check: 29 days and 23 hours is new, 30 days is not', () => {
    expect(NEW_ACCOUNT_DAYS).toBe(30);
    expect(isNewAccount(NOW, NOW)).toBe(true);
    expect(isNewAccount(NOW - 6 * DAY, NOW)).toBe(true);
    expect(isNewAccount(NOW - 30 * DAY + 1, NOW)).toBe(true);
    expect(isNewAccount(NOW - 30 * DAY, NOW)).toBe(false);
    expect(isNewAccount(NOW - 400 * DAY, NOW)).toBe(false);
  });

  it('are never guessed: no date, or a date after the check, is no badge', () => {
    expect(isNewAccount(undefined, NOW)).toBe(false);
    expect(isNewAccount(null, NOW)).toBe(false);
    expect(isNewAccount(NaN, NOW)).toBe(false);
    expect(isNewAccount(NOW + DAY, NOW)).toBe(false);
  });

  it('say their age in words', () => {
    expect(accountAge(NOW - 6 * DAY, NOW)).toBe('account made 6 days ago');
    expect(accountAge(NOW - DAY, NOW)).toBe('account made 1 day ago');
    expect(accountAge(NOW - 3_600_000, NOW)).toBe('account made today');
  });

  it('come from the user X sent with each post: its core date, its older legacy one, or none', () => {
    const answer = (users: unknown[]) => ({
      data: {
        search_by_raw_query: {
          search_timeline: {
            timeline: {
              instructions: [
                {
                  entries: users.map((user, i) => ({
                    entryId: `tweet-900000000000000070${String(i)}`,
                    sortIndex: String(i),
                    content: {
                      itemContent: {
                        tweet_results: {
                          result: {
                            rest_id: `900000000000000070${String(i)}`,
                            core: { user_results: { result: user } },
                            legacy: { id_str: `900000000000000070${String(i)}`, full_text: 'hi' },
                          },
                        },
                      },
                    },
                  })),
                },
              ],
            },
          },
        },
      },
    });
    const tweets = extractTweets(
      answer([
        { core: { screen_name: 'new_one', created_at: 'Mon Nov 16 10:00:00 +0000 2026' } },
        { core: { screen_name: 'old_one' }, legacy: { created_at: 'Tue Mar 01 10:00:00 +0000 2011' } },
        { core: { screen_name: 'no_date' } },
        { core: { screen_name: 'bad_date', created_at: 'yesterday' } },
      ]),
    );
    expect(tweets.map((t) => [t.authorHandle, t.authorCreatedAt])).toEqual([
      ['new_one', Date.UTC(2026, 10, 16, 10)],
      ['old_one', Date.UTC(2011, 2, 1, 10)],
      ['no_date', null],
      ['bad_date', null],
    ]);
  });
});

describe('the heads-up (#391)', () => {
  const tabs: WatchTab[] = [
    { id: 'tab-1', query: '#xomoni' },
    { id: 'mentions', query: '@me -from:me', ready: 'mentions' },
    { id: 'replies', query: 'to:me', ready: 'replies' },
  ];

  it('counts the unseen posts from new accounts in the ready tabs only', () => {
    const results = {
      'tab-1': result('#xomoni', [post('1', NOW - DAY)]),
      mentions: result('@me -from:me', [post('2', NOW - DAY), post('3', NOW - 400 * DAY), post('4')]),
      replies: result('to:me', [post('5', NOW - 29 * DAY), post('6', NOW - 2 * DAY)]),
    };
    expect(unseenNewAccounts(tabs, results, {})).toEqual({ mentions: 1, replies: 2 });
    expect(unseenNewAccounts(tabs, results, { replies: ['5'] })).toEqual({ mentions: 1, replies: 1 });
    expect(unseenNewAccounts(tabs, results, { mentions: ['2'], replies: ['5', '6'] })).toEqual({});
  });

  it('judges an account’s age at its check, and leaves out a check that failed', () => {
    const results = {
      // 31 days old at the check, though only a day before "now" it was 29: the check's time decides.
      mentions: result('@me -from:me', [post('7', NOW - 29 * DAY)], { checkedAt: NOW + 2 * DAY }),
      replies: result('to:me', [post('8', NOW - DAY)], { error: 'X didn’t show the search results this time' }),
    };
    expect(unseenNewAccounts(tabs, results, {})).toEqual({});
  });

  it('puts the count on the toolbar badge: nothing for none, 99+ past 99', () => {
    expect(badgeText(0)).toBe('');
    expect(badgeText(1)).toBe('1');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(120)).toBe('99+');
  });
});

describe('the toolbar’s badge (#391)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the count on Xomoni’s button and says it in the button’s name, then clears both', async () => {
    const action = {
      setBadgeText: vi.fn(() => Promise.resolve()),
      setBadgeBackgroundColor: vi.fn(() => Promise.resolve()),
      setTitle: vi.fn(() => Promise.resolve()),
    };
    vi.stubGlobal('chrome', { action });
    await showWatchBadge(3);
    expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: '3' });
    expect(action.setTitle).toHaveBeenLastCalledWith({
      title: 'Open Xomoni dashboard: 3 posts from new accounts in Watch',
    });
    await showWatchBadge(0);
    expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
    expect(action.setTitle).toHaveBeenLastCalledWith({ title: 'Open Xomoni dashboard' });
  });

  it('does nothing where the browser has no toolbar button to badge', async () => {
    vi.stubGlobal('chrome', {});
    await expect(showWatchBadge(2)).resolves.toBeUndefined();
  });
});

describe('storage of the ready tabs (#391)', () => {
  beforeEach(async () => {
    await db.kv.clear();
    await db.accounts.clear();
  });

  it('turns a ready tab on after the others and off with its results, and counts it toward five', async () => {
    expect(await setReadyTab(ACCOUNT, 'mentions', true)).toBe(true);
    expect((await watchTabs(ACCOUNT)).map((t) => t.id)).toEqual(['tab-1', 'tab-2', 'mentions']);
    await saveWatchResult(ACCOUNT, 'mentions', result('@me -from:me', [post('1', NOW - DAY)]));
    await markWatchSeen(ACCOUNT, 'mentions', ['1']);

    expect(await setReadyTab(ACCOUNT, 'mentions', false)).toBe(true);
    expect((await watchTabs(ACCOUNT)).map((t) => t.id)).toEqual(['tab-1', 'tab-2']);
    expect(await watchResults(ACCOUNT)).toEqual({});
    expect(await watchSeen(ACCOUNT)).toEqual({});

    // Two of the person's own and both ready tabs fill the five, after the first two.
    await saveWatchTabs(ACCOUNT, [
      { id: 'tab-1', query: 'a' },
      { id: 'tab-2', query: 'b' },
      { id: 'tab-3', query: 'c' },
      { id: 'tab-4', query: 'd' },
    ]);
    expect(await setReadyTab(ACCOUNT, 'replies', true)).toBe(true);
    expect(await setReadyTab(ACCOUNT, 'mentions', true)).toBe(false);
    expect((await watchTabs(ACCOUNT)).map((t) => t.id)).toEqual(['tab-1', 'tab-2', 'replies', 'tab-3', 'tab-4']);
  });

  it('leaves the ready tabs and their results as they are when xomoni.com sets the searches (ADR-0029)', async () => {
    await setReadyTab(ACCOUNT, 'replies', true);
    await saveWatchResult(ACCOUNT, 'replies', result('to:me', [post('1')]));
    await setWatchQueries(ACCOUNT, ['one', 'two', 'three', 'four', 'five']);
    const tabs = await watchTabs(ACCOUNT);
    expect(tabs.map((t) => [t.id, t.query])).toEqual([
      ['tab-1', 'one'],
      ['tab-2', 'two'],
      ['replies', ''],
      ['tab-3', 'three'],
      ['tab-4', 'four'],
    ]);
    expect(Object.keys(await watchResults(ACCOUNT))).toEqual(['replies']);
  });

  it('remembers what was seen, a few checks’ worth, and reads damaged storage as nothing seen', async () => {
    await markWatchSeen(ACCOUNT, 'replies', ['1', '2']);
    await markWatchSeen(ACCOUNT, 'replies', ['2', '3']);
    expect(await watchSeen(ACCOUNT)).toEqual({ replies: ['1', '2', '3'] });
    await markWatchSeen(
      ACCOUNT,
      'replies',
      Array.from({ length: 80 }, (_, i) => String(100 + i)),
    );
    expect((await watchSeen(ACCOUNT)).replies).toHaveLength(50);

    await db.kv.put({ key: `watchSeen:${ACCOUNT}`, value: { replies: 'not a list', mentions: [1, '9'] } });
    expect(await watchSeen(ACCOUNT)).toEqual({ mentions: ['9'] });
  });

  it('count for the toolbar for the account the dashboard shows, and nothing without one', async () => {
    await setReadyTab(ACCOUNT, 'mentions', true);
    await saveWatchResult(ACCOUNT, 'mentions', result('@me -from:me', [post('1', NOW - DAY), post('2', NOW - DAY)]));
    expect(await watchBadgeCount(ACCOUNT)).toBe(2);
    await markWatchSeen(ACCOUNT, 'mentions', ['1']);
    expect(await watchBadgeCount(ACCOUNT)).toBe(1);
    expect(await watchBadgeCount('9000000000000000888')).toBe(0);
    expect(await watchBadgeCount(null)).toBe(0);
  });

  it('move to another Xomoni with the tab and each author’s account date (ADR-0032)', async () => {
    await upsertAccount({ id: ACCOUNT, handle: 'me' });
    await setReadyTab(ACCOUNT, 'replies', true);
    await saveWatchResult(ACCOUNT, 'replies', result('to:me', [post('1', NOW - 2 * DAY), post('2')]));
    const { text } = await exportData({ app: '0.5.2', now: NOW });
    const checked = await checkMoveText(text, NOW);
    if (!checked.ok) throw new Error(checked.message);

    await db.kv.clear();
    await importData(checked.file, NOW);
    expect((await watchTabs(ACCOUNT)).some((t) => t.ready === 'replies')).toBe(true);
    expect((await watchResults(ACCOUNT)).replies?.posts.map((p) => p.accountCreatedAt)).toEqual([
      NOW - 2 * DAY,
      undefined,
    ]);
  });
});

describe('runWatch with a ready tab (#391)', () => {
  beforeEach(async () => {
    await db.kv.clear();
    await db.accounts.clear();
  });

  it('searches the account’s handle as Xomoni last saw it, and keeps each author’s account date', async () => {
    await upsertAccount({ id: ACCOUNT, handle: 'renamed_99' });
    await saveWatchTabs(ACCOUNT, [{ id: 'replies', query: 'to:someone_else', ready: 'replies' }]);
    const urls: string[] = [];
    const found = [post('1', NOW - DAY), post('2')];
    let checks = 0;
    const ctx = {
      job: { id: 'w', accountId: ACCOUNT, stats: { done: 0, scanned: 0 } },
      checkpoint: () => {
        if (checks++ >= 1) throw new Error('stop');
      },
      navigate: vi.fn((url: string) => {
        urls.push(url);
        return Promise.resolve({ kind: 'tweets', count: 2, http: 200, unavailable: false } satisfies ContentState);
      }),
      xTab: {
        send: vi.fn((command: ActorCommand) =>
          Promise.resolve((command.cmd === 'readPosts' ? found : null) as unknown as ActionResult),
        ),
      },
      limiter: { cooldown: vi.fn(() => Promise.resolve()) },
      save: vi.fn(() => Promise.resolve()),
    } as unknown as JobContext;

    await expect(runWatch(ctx)).rejects.toThrow('stop');
    expect(urls).toEqual([searchUrl('to:renamed_99')]);
    expect((await watchResults(ACCOUNT)).replies).toMatchObject({ query: 'to:renamed_99', posts: found });
  });
});
