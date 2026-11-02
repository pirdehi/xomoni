// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://x.com/i/web/status/700"}
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCommand } from '../src/content/actor';
import { handleCapture, isUnavailable } from '../src/content/net';
import { JobContext } from '../src/engine/context';
import { Limiter } from '../src/engine/limiter';
import type * as Timers from '../src/engine/timers';
import { db, upsertItems } from '../src/shared/db';
import { unavailableTweetIds } from '../src/shared/graphql';
import type { ActionResult, ContentState } from '../src/shared/messages';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import type { Item, Job } from '../src/shared/types';

// The real sleep runs on a Web Worker, which tests don't have.
vi.mock('../src/engine/timers', async (importOriginal) => ({
  ...(await importOriginal<typeof Timers>()),
  sleep: async () => {},
}));

const ACCOUNT = 'acct-1';

/** A TweetDetail response whose focal post is a tombstone, with a normal reply under it. */
const tombstoneDetail = (id: string) => ({
  data: {
    threaded_conversation_with_injections_v2: {
      instructions: [
        {
          entries: [
            {
              entryId: `tweet-${id}`,
              content: {
                itemContent: {
                  tweet_results: {
                    result: { __typename: 'TweetTombstone', tombstone: { text: { text: 'This Post was deleted' } } },
                  },
                },
              },
            },
            {
              entryId: 'tweet-801',
              content: {
                itemContent: {
                  tweet_results: { result: { __typename: 'Tweet', rest_id: '801', legacy: { id_str: '801' } } },
                },
              },
            },
          ],
        },
      ],
    },
  },
});

/** A Likes page entry for a post from a suspended account: the result says so and keeps its id. */
const suspendedLike = (id: string) => ({
  data: {
    user: {
      result: {
        timeline: {
          timeline: {
            instructions: [
              {
                entries: [
                  {
                    entryId: `tweet-${id}`,
                    content: {
                      itemContent: {
                        tweet_results: { result: { __typename: 'TweetUnavailable', reason: 'Suspended', rest_id: id } },
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    },
  },
});

const capture = (op: string, json: unknown, status = 200) => ({
  op,
  url: `https://x.com/i/api/graphql/q/${op}`,
  status,
  reqBody: null,
  headers: {},
  body: JSON.stringify(json),
});

describe('posts X answers for but won’t show (PLAYBOOK E6, #32)', () => {
  it('reads their ids from tombstones and "unavailable" results, never from real posts', () => {
    expect(unavailableTweetIds(tombstoneDetail('700'))).toEqual(['700']);
    expect(unavailableTweetIds(suspendedLike('701'))).toEqual(['701']);
    expect(unavailableTweetIds({ data: {} })).toEqual([]);
    expect(unavailableTweetIds(null)).toEqual([]);
  });

  it('remembers them from X’s own timeline responses in the tab, but not from failed ones', () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(() => Promise.resolve()) } });
    handleCapture(capture('TweetDetail', tombstoneDetail('710')));
    handleCapture(capture('Likes', suspendedLike('711')));
    handleCapture(capture('TweetDetail', tombstoneDetail('712'), 500));
    expect([isUnavailable('710'), isUnavailable('711'), isUnavailable('712'), isUnavailable('801')]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    vi.unstubAllGlobals();
  });
});

describe('the content script skips them instead of failing', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(() => Promise.resolve()) } });
    // Signed in: the actor refuses to act for a logged-out tab.
    document.cookie = 'twid=u%3D1000';
  });
  afterEach(() => {
    document.cookie = 'twid=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('answers an unlike of an unavailable post with the unavailable skip', async () => {
    handleCapture(capture('Likes', suspendedLike('720')));
    const result = (await runCommand({ cmd: 'unlike', id: '720' })) as ActionResult;
    expect(result).toMatchObject({ outcome: 'not_found', unavailable: true });
  });

  it('still fails a post that is on the page without its buttons, when X did not say it is unavailable', async () => {
    document.body.innerHTML = `<article data-testid="tweet"><a href="/a/status/730"><time datetime="2020-01-01T00:00:00Z"></time></a></article>`;
    const result = (await runCommand({ cmd: 'unlike', id: '730' })) as ActionResult;
    expect(result).toMatchObject({ outcome: 'failed' });
    expect(result.unavailable).toBeUndefined();
  });

  it('flags the post page of an unavailable post', async () => {
    handleCapture(capture('TweetDetail', tombstoneDetail('700')));
    document.body.innerHTML = '<div data-testid="emptyState"></div>';
    const state = (await runCommand({ cmd: 'waitContent', timeoutMs: 100 })) as ContentState;
    expect(state.unavailable).toBe(true);
  });
});

describe('the engine counts them as skipped, apart, and never toward the failure stop', () => {
  beforeEach(async () => {
    await db.items.clear();
    await db.logs.clear();
  });

  it('marks the item gone, counts it as unavailable and resets the failures in a row', async () => {
    await upsertItems(
      ACCOUNT,
      [
        {
          kind: 'like',
          id: '740',
          targetId: '740',
          createdAt: 0,
          likedAt: null,
          text: '',
          author: 'gone',
          inReplyToId: null,
          selfReply: false,
          likes: 0,
          reposts: 0,
          replies: 0,
        },
      ],
      'scan',
    );
    const item = (await db.items.toArray())[0] as Item;
    const job = {
      id: 'j',
      accountId: ACCOUNT,
      stats: { matched: 0, done: 0, skipped: 0, failed: 0, scanned: 0 },
    } as Job;
    const ctx = new JobContext(job, new AbortController().signal, { status: () => {}, attention: () => {} });
    ctx.settings = DEFAULT_SETTINGS;
    ctx.limiter = new Limiter(DEFAULT_SETTINGS, ACCOUNT, new AbortController().signal, () => {});

    // With at most 2 failures in a row (the default), failed, unavailable, failed must not stop the job.
    expect(DEFAULT_SETTINGS.maxConsecutiveFailures).toBe(2);
    await ctx.settle('unlike', item, { outcome: 'failed', message: 'Like button not found' });
    await ctx.settle('unlike', item, { outcome: 'not_found', unavailable: true, message: 'unavailable on X' });
    await ctx.settle('unlike', item, { outcome: 'failed', message: 'Like button not found' });

    expect(job.stats).toMatchObject({ skipped: 1, unavailable: 1, failed: 2 });
    // A second failure right after the first does stop it: the unavailable post broke the run of failures.
    await expect(ctx.settle('unlike', item, { outcome: 'failed' })).rejects.toThrow('2 failures in a row');
  });
});
