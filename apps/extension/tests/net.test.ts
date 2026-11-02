import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Net from '../src/content/net';
import type { RuntimeMessage } from '../src/shared/messages';

const { viewerIdFromCookie, viewerHandle } = vi.hoisted(() => ({
  viewerIdFromCookie: vi.fn<() => string | null>(),
  viewerHandle: vi.fn<() => string | null>(),
}));

// Who is signed in comes from X's cookie and page; the tests set it here.
vi.mock('../src/content/dom', () => ({ viewerIdFromCookie, viewerHandle }));

type Capture = Parameters<typeof Net.handleCapture>[0];

const VIEWER = '1000';
const NOW = Date.parse('2026-11-02T12:00:00Z');
const DELETE_URL = 'https://x.com/i/api/graphql/abc/DeleteTweet';
const DELETE_BODY = { data: { delete_tweet: { tweet_results: {} } } };

let net: typeof Net;
let sendMessage: Mock<(message: RuntimeMessage) => Promise<unknown>>;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  viewerIdFromCookie.mockReset().mockReturnValue(VIEWER);
  viewerHandle.mockReset().mockReturnValue('me');
  sendMessage = vi.fn<(message: RuntimeMessage) => Promise<unknown>>(() => Promise.resolve(undefined));
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  // A fresh module for each test: the waiters and the last timeline status live in it.
  vi.resetModules();
  net = await import('../src/content/net');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** One response as the page-world interceptor captures it; by default X confirming the deletion of post 1. */
function capture(over: Partial<Capture> = {}): Capture {
  return {
    op: 'DeleteTweet',
    url: DELETE_URL,
    status: 200,
    reqBody: JSON.stringify({ variables: { tweet_id: '1' } }),
    headers: {},
    body: JSON.stringify(DELETE_BODY),
    ...over,
  };
}

/** What `handleCapture` sent to the service worker. */
const sent = () => sendMessage.mock.calls.map(([message]) => message);

/** Lets a test see whether `promise` resolved yet, and with what. */
function watch<T>(promise: Promise<T>) {
  const state: { done: boolean; value?: T } = { done: false };
  void promise.then((value) => {
    state.done = true;
    state.value = value;
  });
  return state;
}

function tweetResult(id: string, authorId: string, handle: string) {
  return {
    __typename: 'Tweet',
    rest_id: id,
    core: { user_results: { result: { rest_id: authorId, core: { screen_name: handle } } } },
    legacy: {
      full_text: `post ${id}`,
      user_id_str: authorId,
      created_at: 'Sun Nov 01 10:00:00 +0000 2026',
      favorite_count: 2,
      retweet_count: 1,
      reply_count: 0,
    },
  };
}

/** A `UserTweets` response with one post per `[post id, author id]`, in timeline order. */
function timeline(...authors: [id: string, authorId: string][]) {
  const entries = authors.map(([id, authorId], i) => ({
    entryId: `tweet-${id}`,
    sortIndex: String(100 - i),
    content: {
      itemContent: { tweet_results: { result: tweetResult(id, authorId, authorId === VIEWER ? 'me' : 'other') } },
    },
  }));
  return JSON.stringify({ data: { user: { result: { timeline: { instructions: [{ entries }] } } } } });
}

const timelineCapture = (over: Partial<Capture> = {}) =>
  capture({
    op: 'UserTweets',
    url: `https://x.com/i/api/graphql/q/UserTweets?variables=${encodeURIComponent(JSON.stringify({ userId: VIEWER }))}`,
    reqBody: null,
    body: timeline(['1', VIEWER], ['2', '2000']),
    ...over,
  });

describe('waitForNet: confirmation from X’s own response', () => {
  it('resolves with the mutation X answered for the matching post', async () => {
    const waiting = net.waitForNet(['DeleteTweet', 'DeleteRetweet'], (vars) => vars.tweet_id === '1');

    net.handleCapture(capture());

    expect(await waiting).toEqual({
      op: 'DeleteTweet',
      status: 200,
      headers: {},
      variables: { tweet_id: '1' },
      json: DELETE_BODY,
      at: NOW,
    });
  });

  it('ignores other operations and other posts, and gives up after its timeout', async () => {
    const waiting = watch(net.waitForNet(['DeleteTweet'], (vars) => vars.tweet_id === '1', 1_000));

    net.handleCapture(capture({ op: 'DeleteRetweet', url: 'https://x.com/i/api/graphql/abc/DeleteRetweet' }));
    net.handleCapture(capture({ reqBody: JSON.stringify({ variables: { tweet_id: '2' } }) }));
    await vi.advanceTimersByTimeAsync(999);
    expect(waiting.done).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(waiting).toEqual({ done: true, value: null });
  });

  it('waits 15 seconds by default', async () => {
    const waiting = watch(net.waitForNet(['DeleteTweet'], () => true));
    await vi.advanceTimersByTimeAsync(14_999);
    expect(waiting.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(waiting).toEqual({ done: true, value: null });
  });

  it('is never resolved by a response that is not a mutation', async () => {
    const waiting = watch(net.waitForNet(['UserTweets'], () => true, 1_000));

    net.handleCapture(timelineCapture());
    await vi.advanceTimersByTimeAsync(0);
    expect(waiting.done).toBe(false);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(waiting.value).toBeNull();
  });

  it('answers every matching waiter once, then forgets them', async () => {
    const match = vi.fn((vars: Record<string, unknown>) => vars.tweet_id === '1');
    const first = net.waitForNet(['DeleteTweet'], match);
    const second = net.waitForNet(['DeleteTweet'], match);

    net.handleCapture(capture());
    net.handleCapture(capture());

    expect(await first).toMatchObject({ op: 'DeleteTweet' });
    expect(await second).toMatchObject({ op: 'DeleteTweet' });
    expect(match).toHaveBeenCalledTimes(2);
  });

  it('reads the variables of a GET request from its URL', async () => {
    const waiting = net.waitForNet(['DeleteTweet'], (vars) => vars.tweet_id === '5');
    const variables = encodeURIComponent(JSON.stringify({ tweet_id: '5' }));

    net.handleCapture(capture({ reqBody: null, url: `${DELETE_URL}?variables=${variables}` }));

    expect(await waiting).toMatchObject({ variables: { tweet_id: '5' } });
  });

  it.each([
    ['an HTML error page', '<html>Something went wrong</html>'],
    ['an empty body', ''],
  ])('passes on %s as no JSON', async (_, body) => {
    const waiting = net.waitForNet(['DeleteTweet'], () => true);

    net.handleCapture(capture({ status: 503, body }));

    expect(await waiting).toMatchObject({ status: 503, json: null });
  });
});

describe('lastTimelineStatus (PLAYBOOK F6)', () => {
  it('is null before the page loaded a timeline, then the status of the last timeline request', () => {
    expect(net.lastTimelineStatus()).toBeNull();

    net.handleCapture(timelineCapture({ status: 503, body: '' }));
    expect(net.lastTimelineStatus()).toBe(503);

    net.handleCapture(timelineCapture({ op: 'SearchTimeline', status: 0, body: '' }));
    expect(net.lastTimelineStatus()).toBe(0);

    net.handleCapture(capture({ status: 500 }));
    expect(net.lastTimelineStatus()).toBe(0);
  });

  it('is kept even when nobody is signed in', () => {
    viewerIdFromCookie.mockReturnValue(null);
    net.handleCapture(timelineCapture({ status: 200 }));
    expect(net.lastTimelineStatus()).toBe(200);
  });
});

describe('handleCapture: what goes to the service worker', () => {
  it('sends nothing while nobody is signed in, but still confirms actions', async () => {
    viewerIdFromCookie.mockReturnValue(null);
    const waiting = net.waitForNet(['DeleteTweet'], () => true);

    net.handleCapture(timelineCapture({ headers: { 'x-rate-limit-limit': '50', 'x-rate-limit-remaining': '1' } }));
    net.handleCapture(capture());

    expect(await waiting).toMatchObject({ op: 'DeleteTweet' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('reports X’s rate-limit headers for the operation (PLAYBOOK A1)', () => {
    const reset = String(NOW / 1000 + 900);

    net.handleCapture(
      timelineCapture({
        headers: { 'x-rate-limit-limit': '50', 'x-rate-limit-remaining': '49', 'x-rate-limit-reset': reset },
        body: '',
      }),
    );

    expect(sent()).toEqual([
      {
        type: 'rate',
        obs: {
          key: `${VIEWER}:UserTweets`,
          accountId: VIEWER,
          op: 'UserTweets',
          limit: 50,
          remaining: 49,
          reset: NOW + 900_000,
          status: 200,
          at: NOW,
        },
      },
    ]);
  });

  it('moves the reset later when this computer’s clock runs ahead of X’s (PLAYBOOK F7)', () => {
    const date = new Date(NOW - 2 * 60_000).toUTCString();
    net.handleCapture(
      capture({ headers: { 'x-rate-limit-remaining': '3', 'x-rate-limit-reset': String(NOW / 1000), date } }),
    );
    expect(sent()).toEqual([expect.objectContaining({ obs: expect.objectContaining({ reset: NOW + 2 * 60_000 }) })]);
  });

  it('reports a 429 even without rate-limit headers', () => {
    net.handleCapture(capture({ status: 429, body: '' }));

    expect(sent()).toEqual([
      {
        type: 'rate',
        obs: {
          key: `${VIEWER}:DeleteTweet`,
          accountId: VIEWER,
          op: 'DeleteTweet',
          limit: null,
          remaining: null,
          reset: null,
          status: 429,
          at: NOW,
        },
      },
    ]);
  });

  it('reports no limits when X sent none, or none that are numbers', () => {
    net.handleCapture(capture());
    net.handleCapture(capture({ headers: { 'x-rate-limit-limit': 'many', 'x-rate-limit-remaining': '' } }));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('adds the viewer’s own posts from a timeline to the inventory', () => {
    net.handleCapture(timelineCapture());

    expect(sent()).toEqual([
      {
        type: 'ingest',
        accountId: VIEWER,
        handle: 'me',
        op: 'UserTweets',
        observedAt: NOW,
        drafts: [
          {
            kind: 'post',
            id: '1',
            targetId: '1',
            createdAt: Date.UTC(2026, 10, 1, 10),
            likedAt: null,
            text: 'post 1',
            author: 'me',
            inReplyToId: null,
            selfReply: false,
            likes: 2,
            reposts: 1,
            replies: 0,
          },
        ],
      },
    ]);
  });

  it('adds nothing from a timeline without the viewer’s posts, a failed one or one without data', () => {
    net.handleCapture(timelineCapture({ body: timeline(['2', '2000']) }));
    net.handleCapture(timelineCapture({ status: 404 }));
    net.handleCapture(timelineCapture({ body: JSON.stringify({ errors: [{ code: 88, message: 'Rate limit' }] }) }));
    net.handleCapture(timelineCapture({ body: 'not json' }));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('sends the viewer’s own profile, and not anyone else’s', () => {
    const profile = (id: string, handle: string) =>
      JSON.stringify({
        data: {
          user: {
            result: {
              rest_id: id,
              core: { screen_name: handle, name: 'Me', created_at: 'Thu Jan 01 00:00:00 +0000 2015' },
              legacy: { statuses_count: 10, favourites_count: 20, followers_count: 3, friends_count: 4 },
            },
          },
        },
      });
    const lookup = (body: string) =>
      capture({ op: 'UserByScreenName', url: 'https://x.com/i/api/graphql/u/UserByScreenName', reqBody: null, body });

    net.handleCapture(lookup(profile('2000', 'other')));
    expect(sendMessage).not.toHaveBeenCalled();

    net.handleCapture(lookup(profile(VIEWER, 'me')));
    expect(sent()).toEqual([
      {
        type: 'profile',
        profile: expect.objectContaining({
          id: VIEWER,
          handle: 'me',
          postsCount: 10,
          likesCount: 20,
          createdAt: Date.UTC(2015, 0, 1),
        }),
      },
    ]);
  });

  it('ignores the body of a mutation', () => {
    net.handleCapture(capture());
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('send', () => {
  const message: RuntimeMessage = {
    type: 'profile',
    profile: {
      id: VIEWER,
      handle: 'me',
      name: 'Me',
      avatar: '',
      postsCount: null,
      likesCount: null,
      followers: null,
      following: null,
      createdAt: null,
    },
  };

  it('passes the message to the service worker', () => {
    net.send(message);
    expect(sendMessage).toHaveBeenCalledWith(message);
  });

  it('swallows a service worker that does not answer', async () => {
    sendMessage.mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'));
    net.send(message);
    // An unhandled rejection would fail the run.
    await vi.advanceTimersByTimeAsync(0);
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it('swallows the error of a content script orphaned by an extension reload', () => {
    sendMessage.mockImplementation(() => {
      throw new Error('Extension context invalidated.');
    });
    expect(() => net.send(message)).not.toThrow();
  });
});

describe('resetAtFrom and clockAhead', () => {
  it('has no reset without a usable header, and no skew without a date', () => {
    expect(net.resetAtFrom({})).toBeNull();
    expect(net.resetAtFrom({ 'x-rate-limit-reset': 'soon' })).toBeNull();
    expect(net.resetAtFrom({ 'x-rate-limit-reset': '1800000000' }, NOW)).toBe(1_800_000_000_000);
    expect(net.clockAhead(null, NOW)).toBe(0);
  });
});
