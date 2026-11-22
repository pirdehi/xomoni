import { describe, expect, it } from 'vitest';
import {
  archiveLikeDrafts,
  archiveTweetDrafts,
  classifyArchiveFile,
  parseArchiveAccount,
  parseYtd,
} from '../src/shared/archive';
import {
  draftsFromTimeline,
  extractErrors,
  extractProfile,
  extractTweets,
  incomingFromTimeline,
  opName,
  parseTweet,
  parseVariables,
} from '../src/shared/graphql';
import { estimateDuration, matchesFilter, parseIdList } from '../src/shared/filter';
import { estimateLikedAt, parseTwitterDate, snowflakeTime } from '../src/shared/time';
import { sweepUrls } from '../src/engine/cleanup';
import { isCheckPath, isLoginPath, needMessage, pageNeed } from '../src/shared/attention';
import type { CleanupFilter, Item } from '../src/shared/types';

const EPOCH = 1288834974657n;
const idAt = (ms: number, seq = 0n) => (((BigInt(ms) - EPOCH) << 22n) | seq).toString();
const ME = '1000';

function tweet(
  id: string,
  opts: {
    user?: string;
    handle?: string;
    created?: string;
    text?: string;
    replyTo?: string;
    replyToUser?: string;
    replyToHandle?: string;
    rt?: object;
    quoted?: object;
    likes?: number;
  } = {},
) {
  return {
    __typename: 'Tweet',
    rest_id: id,
    core: { user_results: { result: { rest_id: opts.user ?? ME, core: { screen_name: opts.handle ?? 'me' } } } },
    quoted_status_result: opts.quoted ? { result: opts.quoted } : undefined,
    legacy: {
      id_str: id,
      user_id_str: opts.user ?? ME,
      created_at: opts.created ?? 'Wed Oct 10 20:19:24 +0000 2018',
      full_text: opts.text ?? `text ${id}`,
      in_reply_to_status_id_str: opts.replyTo,
      in_reply_to_user_id_str: opts.replyToUser,
      in_reply_to_screen_name: opts.replyToHandle,
      favorite_count: opts.likes ?? 0,
      retweet_count: 0,
      reply_count: 0,
      retweeted_status_result: opts.rt ? { result: opts.rt } : undefined,
    },
  };
}

const entry = (entryId: string, sortIndex: string, result: object) => ({
  entryId,
  sortIndex,
  content: { itemContent: { tweet_results: { result } } },
});

describe('time', () => {
  it('decodes snowflake ids and rejects pre-snowflake ids', () => {
    const t = Date.UTC(2021, 4, 1, 12, 0, 0);
    expect(snowflakeTime(idAt(t))).toBe(t);
    expect(snowflakeTime('20')).toBeNull();
  });

  it('parses the legacy X date format', () => {
    expect(parseTwitterDate('Wed Oct 10 20:19:24 +0000 2018')).toBe(Date.UTC(2018, 9, 10, 20, 19, 24));
    expect(parseTwitterDate(undefined)).toBeNull();
  });

  it('only accepts plausible like times', () => {
    const created = Date.UTC(2020, 0, 1);
    const liked = Date.UTC(2021, 0, 1);
    expect(estimateLikedAt(idAt(liked), idAt(created), created)).toBe(liked);
    expect(estimateLikedAt(idAt(created), idAt(created), created)).toBeNull(); // sortIndex == post id
    expect(estimateLikedAt(idAt(Date.UTC(2019, 0, 1)), idAt(created), created)).toBeNull(); // before the post existed
    expect(estimateLikedAt(null, '1', created)).toBeNull();
  });
});

describe('graphql parsing', () => {
  it('decodes the HTML entities X escapes post text with, as X’s page shows it (#370)', () => {
    const escaped = 'R&amp;D notes &lt;3 &gt; Q&amp;A: &quot;fish&quot; &#39;n&#x27; chips';
    const shown = 'R&D notes <3 > Q&A: "fish" \'n\' chips';
    expect(parseTweet(tweet('1', { text: escaped }), null)?.text).toBe(shown);
    // One pass: a post that reads "&lt;" on X arrives as &amp;lt; and stays "&lt;".
    expect(parseTweet(tweet('1', { text: 'x &amp;lt; y &amp;amp; AT&T' }), null)?.text).toBe('x &lt; y &amp; AT&T');
    // A long post's text, and a reposted post's, are decoded too.
    const long = { ...tweet('2'), note_tweet: { note_tweet_results: { result: { text: 'Long R&amp;D &lt;3' } } } };
    expect(parseTweet(long, null)?.text).toBe('Long R&D <3');
    const repost = tweet('3', {
      text: 'RT @friend: Fish &amp; chips',
      rt: tweet('4', { user: '9', text: 'Fish &amp; chips' }),
    });
    const [draft] = draftsFromTimeline(
      'UserTweets',
      extractTweets({ entries: [entry('tweet-3', '1', repost)] }),
      ME,
      {},
    );
    expect(draft).toMatchObject({ kind: 'repost', text: 'Fish & chips' });
    // A like, from the person's Likes timeline, and someone's reply to the person.
    const liked = extractTweets({
      entries: [entry('tweet-5', '1', tweet('5', { user: '9', text: '&lt;3 &amp; more' }))],
    });
    expect(draftsFromTimeline('Likes', liked, ME, { userId: ME })[0]?.text).toBe('<3 & more');
    const reply = tweet('6', { user: '9', handle: 'friend', text: 'Q&amp;A?', replyTo: '1', replyToUser: ME });
    expect(incomingFromTimeline('UserTweetsAndReplies', [parseTweet(reply, null)!], ME)[0]?.text).toBe('Q&A?');
  });

  it('reads quotes, bookmarks, views and whether a post quotes another (#249)', () => {
    const base = tweet('1');
    const withCounts = {
      ...base,
      views: { count: '1234', state: 'EnabledWithCount' },
      legacy: { ...base.legacy, quote_count: 2, bookmark_count: 5, is_quote_status: true },
    };
    expect(parseTweet(withCounts, null)).toMatchObject({ quotes: 2, bookmarks: 5, views: 1234, quote: true });
    expect(parseTweet(base, null)).toMatchObject({ quotes: 0, bookmarks: 0, views: null, quote: false });
    for (const count of ['12a', '', '-3', 1.5, -1]) {
      expect(parseTweet({ ...base, views: { count } }, null)?.views).toBeNull();
    }
    expect(parseTweet({ ...base, views: { count: 77 } }, null)?.views).toBe(77);
  });

  it('keeps those counts on the viewer’s own posts only, never on likes or reposts', () => {
    const own = { ...tweet('1'), views: { count: '10' }, legacy: { ...tweet('1').legacy, quote_count: 1 } };
    const [post] = draftsFromTimeline('UserTweets', [parseTweet(own, null)!], ME, {});
    expect(post).toMatchObject({ kind: 'post', quotes: 1, bookmarks: 0, views: 10, quote: false });
    const liked = parseTweet({ ...tweet('2', { user: '9', handle: 'x' }), views: { count: '10' } }, '1')!;
    const [like] = draftsFromTimeline('Likes', [liked], ME, { userId: ME });
    expect(like).not.toHaveProperty('views');
    expect(like).not.toHaveProperty('quotes');
  });

  it('reads op names and variables', () => {
    const url =
      'https://x.com/i/api/graphql/abc123/UserTweets?variables=%7B%22userId%22%3A%221000%22%7D&features=%7B%7D';
    expect(opName(url)).toBe('UserTweets');
    expect(parseVariables(url, null)).toEqual({ userId: '1000' });
    expect(
      parseVariables('https://x.com/i/api/graphql/q/DeleteTweet', JSON.stringify({ variables: { tweet_id: '9' } })),
    ).toEqual({ tweet_id: '9' });
  });

  it('extracts timeline tweets without descending into quoted or reposted posts', () => {
    const quoted = tweet('900', { user: '2', handle: 'other' });
    const source = tweet('800', { user: '3', handle: 'author', text: 'original' });
    const json = {
      data: {
        user: {
          result: {
            timeline: {
              timeline: {
                instructions: [
                  {
                    type: 'TimelineAddEntries',
                    entries: [
                      entry('tweet-1', '30', tweet('1', { quoted })),
                      entry('tweet-2', '20', {
                        __typename: 'TweetWithVisibilityResults',
                        tweet: tweet('2', { replyTo: '1', replyToUser: ME }),
                      }),
                      entry('tweet-3', '10', tweet('3', { rt: source })),
                      {
                        entryId: 'profile-conversation-1',
                        sortIndex: '5',
                        content: {
                          items: [
                            {
                              item: {
                                itemContent: {
                                  tweet_results: { result: tweet('4', { user: '5', handle: 'x', replyTo: '77' }) },
                                },
                              },
                            },
                          ],
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
    };
    const tweets = extractTweets(json);
    expect(tweets.map((t) => t.id)).toEqual(['1', '2', '3', '4']);
    expect(tweets[2]?.source?.id).toBe('800');

    const drafts = draftsFromTimeline('UserTweets', tweets, ME, {});
    expect(drafts.map((d) => [d.kind, d.id, d.targetId])).toEqual([
      ['post', '1', '1'],
      ['reply', '2', '2'],
      ['repost', '3', '800'],
    ]);
    expect(drafts[1]?.selfReply).toBe(true);
    expect(drafts[2]?.author).toBe('author');
  });

  it('reads whom a reply answers (#256), and only a handle X could have', () => {
    const tweets = [
      tweet('1', { replyTo: '77', replyToUser: '5', replyToHandle: 'Ada_L' }),
      tweet('2', { replyTo: '78', replyToUser: '6', replyToHandle: 'not a handle' }),
      tweet('3', { replyTo: '1', replyToUser: ME, replyToHandle: 'me' }),
      // X names the author a post mentions first even when it answers nothing: not a reply.
      tweet('4', { replyToHandle: 'ada_l' }),
    ].map((t) => parseTweet(t, null));
    expect(tweets.map((t) => t?.inReplyToHandle)).toEqual(['Ada_L', null, 'me', 'ada_l']);
    const drafts = draftsFromTimeline(
      'UserTweetsAndReplies',
      tweets.filter((t) => t !== null),
      ME,
      {},
    );
    expect(drafts.map((d) => [d.kind, d.replyTo])).toEqual([
      ['reply', 'Ada_L'],
      ['reply', undefined],
      ['reply', 'me'],
      ['post', undefined],
    ]);
    expect(drafts[1]).not.toHaveProperty('replyTo');
  });

  it('picks the replies others wrote to the viewer, never the viewer’s own, others’ threads or reposts (ADR-0030)', () => {
    const parsed = [
      tweet('10', { user: '7', handle: 'bob', replyTo: '1', replyToUser: ME, text: 'nice one' }),
      tweet('11', { replyTo: '10', replyToUser: '7' }),
      tweet('12', { user: '8', handle: 'carol', replyTo: '99', replyToUser: '8' }),
      tweet('13', { user: '9', handle: 'not a handle', replyTo: '1', replyToUser: ME }),
      tweet('14', { user: '7', handle: 'bob', replyTo: '1', replyToUser: ME, rt: tweet('15', { user: '3' }) }),
      tweet('16', { user: '', handle: 'ghost', replyTo: '1', replyToUser: ME }),
    ].map((t) => parseTweet(t, null));
    const tweets = parsed.filter((t) => t !== null);
    expect(incomingFromTimeline('TweetDetail', tweets, ME)).toEqual([
      { id: '10', author: 'bob', text: 'nice one', createdAt: Date.UTC(2018, 9, 10, 20, 19, 24), toId: '1' },
    ]);
    // A post without a time is left out, and the Likes timeline is about what the viewer liked.
    const timeless = tweets.map((t) => (t.id === '10' ? { ...t, createdAt: 0 } : t));
    expect(incomingFromTimeline('TweetDetail', timeless, ME)).toEqual([]);
    expect(incomingFromTimeline('Likes', tweets, ME)).toEqual([]);
  });

  it('records likes only from the viewer’s own Likes timeline, with checked like times', () => {
    const created = Date.UTC(2020, 0, 1);
    const tweets = [
      {
        ...extractTweets({
          e: [entry('tweet-a', idAt(Date.UTC(2022, 0, 2)), tweet(idAt(created, 1n), { user: '7' }))],
        })[0]!,
      },
      {
        ...extractTweets({
          e: [entry('tweet-b', idAt(Date.UTC(2022, 0, 1)), tweet(idAt(created, 2n), { user: '8' }))],
        })[0]!,
      },
    ];
    expect(draftsFromTimeline('Likes', tweets, ME, { userId: '999' })).toEqual([]);
    const drafts = draftsFromTimeline('Likes', tweets, ME, { userId: ME });
    expect(drafts.map((d) => d.kind)).toEqual(['like', 'like']);
    expect(drafts[0]?.likedAt).toBe(Date.UTC(2022, 0, 2));

    // Out-of-order sortIndexes mean they are not like times: drop all estimates.
    const shuffled = draftsFromTimeline('Likes', [tweets[1]!, tweets[0]!], ME, { userId: ME });
    expect(shuffled.every((d) => d.likedAt === null)).toBe(true);

    // Posts X marks as no longer liked are not recorded as likes.
    const unliked = [{ ...tweets[0]!, favorited: false }, tweets[1]!];
    expect(draftsFromTimeline('Likes', unliked, ME, { userId: ME }).map((d) => d.id)).toEqual([tweets[1]!.id]);
  });

  it('reads whether X shows the account as Premium (#33)', () => {
    const premium = (value: unknown) =>
      extractProfile({ data: { user: { result: { rest_id: ME, is_blue_verified: value, legacy: {} } } } })?.verified;
    expect([premium(true), premium(false), premium('yes'), premium(undefined)]).toEqual([true, false, null, null]);
  });

  it('reads profiles and errors', () => {
    const profile = extractProfile({
      data: {
        user: {
          result: {
            rest_id: ME,
            core: { screen_name: 'me', name: 'Me', created_at: 'Wed Oct 10 20:19:24 +0000 2018' },
            legacy: { statuses_count: 12, favourites_count: 3 },
          },
        },
      },
    });
    expect(profile).toMatchObject({ id: ME, handle: 'me', postsCount: 12, likesCount: 3, verified: null });
    expect(extractErrors({ errors: [{ message: 'nope', extensions: { code: 226 } }] })).toEqual([
      { code: 226, message: 'nope' },
    ]);
  });
});

describe('archive', () => {
  it('classifies only the files Xomoni needs', () => {
    expect(classifyArchiveFile('archive/data/tweets.js')).toBe('tweets');
    expect(classifyArchiveFile('tweets-part1.js')).toBe('tweets');
    expect(classifyArchiveFile('like.js')).toBe('likes');
    expect(classifyArchiveFile('account.js')).toBe('account');
    expect(classifyArchiveFile('tweet-headers.js')).toBeNull();
    expect(classifyArchiveFile('deleted-tweets.js')).toBeNull();
  });

  it('parses tweets, reposts, replies and likes', () => {
    const tweets = parseYtd(
      `window.YTD.tweets.part0 = ${JSON.stringify([
        {
          tweet: {
            id_str: '11',
            created_at: 'Wed Oct 10 20:19:24 +0000 2018',
            full_text: 'hello',
            favorite_count: '4',
          },
        },
        { tweet: { id_str: '12', created_at: 'Wed Oct 10 20:19:24 +0000 2018', full_text: 'RT @someone: hi' } },
        {
          tweet: {
            id_str: '13',
            created_at: 'Wed Oct 10 20:19:24 +0000 2018',
            full_text: '@a ok',
            in_reply_to_status_id_str: '5',
            in_reply_to_user_id_str: '42',
            in_reply_to_screen_name: 'a',
          },
        },
        {
          tweet: {
            id_str: '14',
            created_at: 'Wed Oct 10 20:19:24 +0000 2018',
            full_text: 'odd',
            in_reply_to_status_id_str: '6',
            in_reply_to_screen_name: '<b>',
          },
        },
        {
          tweet: {
            id_str: '15',
            created_at: 'Wed Oct 10 20:19:24 +0000 2018',
            full_text: 'RT @someone: hi',
            in_reply_to_status_id_str: '7',
            in_reply_to_screen_name: 'someone',
          },
        },
      ])}`,
    );
    const drafts = archiveTweetDrafts(tweets, ME, 'me');
    expect(drafts.map((d) => [d.kind, d.targetId, d.author, d.replyTo])).toEqual([
      ['post', '11', 'me', undefined],
      ['repost', '', 'someone', undefined],
      // Whom a reply answers (#256), when the archive names a real handle; never on a repost.
      ['reply', '13', 'me', 'a'],
      ['reply', '14', 'me', undefined],
      ['repost', '', 'someone', undefined],
    ]);
    expect(drafts[0]?.likes).toBe(4);
    expect(drafts[2]?.selfReply).toBe(false);

    const likeId = idAt(Date.UTC(2019, 5, 1));
    const likes = archiveLikeDrafts(
      parseYtd(`window.YTD.like.part0 = [{"like":{"tweetId":"${likeId}","fullText":"nice"}}]`),
    );
    expect(likes[0]).toMatchObject({ kind: 'like', id: likeId, createdAt: Date.UTC(2019, 5, 1) });

    expect(
      parseArchiveAccount(parseYtd('window.YTD.account.part0 = [{"account":{"accountId":"1000","username":"me"}}]')),
    ).toEqual({ accountId: ME, handle: 'me' });
  });

  it('decodes the HTML entities of the archive’s escaped text, as X’s page shows it (#370)', () => {
    const tweets = parseYtd(
      `window.YTD.tweets.part0 = ${JSON.stringify([
        {
          tweet: {
            id_str: '11',
            created_at: 'Wed Oct 10 20:19:24 +0000 2018',
            full_text: 'R&amp;D &lt;3 &gt; &quot;x&quot;',
          },
        },
        { tweet: { id_str: '12', created_at: 'Wed Oct 10 20:19:24 +0000 2018', full_text: 'RT @someone: Q&amp;A' } },
      ])}`,
    );
    expect(archiveTweetDrafts(tweets, ME, 'me').map((d) => [d.kind, d.author, d.text])).toEqual([
      ['post', 'me', 'R&D <3 > "x"'],
      // Still a repost, of @someone: the decoded text starts as the escaped one did.
      ['repost', 'someone', 'RT @someone: Q&A'],
    ]);
    const likeId = idAt(Date.UTC(2019, 5, 1));
    const likes = archiveLikeDrafts([{ like: { tweetId: likeId, fullText: 'Fish &amp; chips &#39;n&#39; &lt;3' } }]);
    expect(likes[0]?.text).toBe("Fish & chips 'n' <3");
  });
});

describe('cleanup rules', () => {
  const base: CleanupFilter = {
    target: 'post',
    before: Date.UTC(2024, 0, 1),
    after: null,
    keepMinLikes: null,
    keepKeywords: [],
    keepIds: [],
    skipSelfReplies: true,
  };
  const item = (patch: Partial<Item>): Item => ({
    key: 'k',
    accountId: ME,
    kind: 'post',
    id: '1',
    targetId: '1',
    createdAt: Date.UTC(2020, 0, 1),
    likedAt: null,
    text: 'hello world',
    author: 'me',
    inReplyToId: null,
    selfReply: false,
    likes: 0,
    reposts: 0,
    replies: 0,
    sources: ['scan'],
    status: 'present',
    seenAt: 0,
    statusAt: 0,
    lastJobId: null,
    ...patch,
  });

  it('matches by date and honors every keep rule', () => {
    expect(matchesFilter(base, item({}))).toBe(true);
    expect(matchesFilter(base, item({ createdAt: Date.UTC(2024, 5, 1) }))).toBe(false);
    expect(matchesFilter({ ...base, after: Date.UTC(2021, 0, 1) }, item({}))).toBe(false);
    expect(matchesFilter({ ...base, keepMinLikes: 10 }, item({ likes: 10 }))).toBe(false);
    expect(matchesFilter({ ...base, keepKeywords: ['world'] }, item({}))).toBe(false);
    expect(matchesFilter({ ...base, keepIds: ['1'] }, item({}))).toBe(false);
    expect(matchesFilter(base, item({ status: 'deleted' }))).toBe(false);
    expect(matchesFilter(base, item({ kind: 'reply' }))).toBe(false);
    expect(matchesFilter({ ...base, target: 'reply' }, item({ kind: 'reply', selfReply: true }))).toBe(false);
    expect(
      matchesFilter({ ...base, target: 'reply', skipSelfReplies: false }, item({ kind: 'reply', selfReply: true })),
    ).toBe(true);
  });

  it('removes only the picked posts when the plan names them (#256), still under every keep rule', () => {
    const picked = { ...base, target: 'reply' as const, skipSelfReplies: false, onlyIds: ['1', '3'] };
    expect(matchesFilter(picked, item({ kind: 'reply' }))).toBe(true);
    expect(matchesFilter(picked, item({ kind: 'reply', id: '2' }))).toBe(false);
    expect(matchesFilter({ ...picked, keepKeywords: ['hello'] }, item({ kind: 'reply' }))).toBe(false);
    expect(matchesFilter(picked, item({ kind: 'reply', status: 'deleted' }))).toBe(false);
    expect(matchesFilter(picked, item({ kind: 'reply', createdAt: Date.UTC(2024, 5, 1) }))).toBe(false);
  });

  it('keeps a post by a word with &, < or >, whether its copy holds X’s escaped text or the text X shows (#370)', () => {
    // A copy stored before Xomoni decoded X's text, or from an older Xomoni's move file, still holds X's escaped text.
    const escaped = item({ text: 'R&amp;D notes &lt;3 &gt; Q&amp;A' });
    const shown = item({ text: 'R&D notes <3 > Q&A' });
    for (const word of ['r&d', '<3', '> q&a', 'R&D']) {
      expect(matchesFilter({ ...base, keepKeywords: [word] }, escaped)).toBe(false);
      expect(matchesFilter({ ...base, keepKeywords: [word] }, shown)).toBe(false);
    }
    // A like and a repost are kept the same way: nothing on X's page checks their text again before they are undone.
    const like = item({ kind: 'like', text: 'Fish &amp; chips' });
    expect(matchesFilter({ ...base, target: 'like', keepKeywords: ['fish & chips'] }, like)).toBe(false);
    const repost = item({ kind: 'repost', text: 'Fish &amp; chips' });
    expect(matchesFilter({ ...base, target: 'repost', keepKeywords: ['fish & chips'] }, repost)).toBe(false);
    // A word that isn't in the post, in either form, keeps nothing.
    expect(matchesFilter({ ...base, keepKeywords: ['r&b', '<4'] }, escaped)).toBe(true);
    expect(matchesFilter({ ...base, keepKeywords: ['r&b', '<4'] }, shown)).toBe(true);
  });

  it('uses the like time for likes when known', () => {
    const like = item({ kind: 'like', createdAt: Date.UTC(2020, 0, 1), likedAt: Date.UTC(2024, 6, 1) });
    expect(matchesFilter({ ...base, target: 'like' }, like)).toBe(false);
    expect(matchesFilter({ ...base, target: 'like' }, { ...like, likedAt: null })).toBe(true);
  });

  it('parses pasted post links and ids', () => {
    expect(parseIdList('https://x.com/me/status/1234567890123 and 98765432\nfoo')).toEqual([
      '1234567890123',
      '98765432',
    ]);
  });

  it('takes no id from digits inside a handle or other text (#61)', () => {
    expect(parseIdList('@user12345678, https://x.com/user1234567/status/111222333444, 555666777')).toEqual([
      '111222333444',
      '555666777',
    ]);
    expect(parseIdList('order 123456789x and x123456789')).toEqual([]);
    expect(parseIdList('https://twitter.com/me/statuses/123456789?s=20')).toEqual(['123456789']);
  });

  it('takes a post pasted twice, as a link and as its id, once (#367)', () => {
    expect(
      parseIdList(
        'https://x.com/me/status/111222333444\n111222333444, https://twitter.com/me/status/111222333444?s=20',
      ),
    ).toEqual(['111222333444']);
    expect(parseIdList('555666777 111222333444 555666777')).toEqual(['555666777', '111222333444']);
  });

  it('estimates duration with batch breaks and daily caps', () => {
    const rule = {
      minDelay: 6,
      maxDelay: 12,
      batchSize: 30,
      batchPauseMin: 180,
      batchPauseMax: 360,
      hourlyCap: 150,
      dailyCap: 1000,
    };
    expect(estimateDuration(0, rule)).toBe(0);
    expect(estimateDuration(150, rule)).toBeGreaterThanOrEqual(3600 * 1000);
    expect(estimateDuration(2500, rule)).toBeGreaterThan(2 * 86_400_000);
  });

  it('builds scoped search URLs', () => {
    const [url = ''] = sweepUrls({ ...base, target: 'reply' }, 'me');
    const q = new URL(url).searchParams.get('q');
    expect(q).toBe('from:me until:2024-01-02 filter:replies');
    expect(new URL(url).searchParams.get('f')).toBe('live');
    expect(sweepUrls({ ...base, target: 'like' }, 'me')).toEqual(['https://x.com/me/likes']);
  });

  it('sweeps the profile before search when it holds every post (#15, PLAYBOOK E2)', () => {
    const [profile, search] = sweepUrls({ ...base, target: 'post' }, 'me', 1200);
    expect(profile).toBe('https://x.com/me');
    expect(search).toContain('https://x.com/search?');
    expect(sweepUrls({ ...base, target: 'reply' }, 'me', 3199)[0]).toBe('https://x.com/me/with_replies');
    // Too many posts for the profile to reach the old ones, or X's count unknown: search only.
    expect(sweepUrls({ ...base, target: 'post' }, 'me', 3200)).toHaveLength(1);
    expect(sweepUrls({ ...base, target: 'post' }, 'me')).toHaveLength(1);
  });
});

describe('attention', () => {
  const page = { loggedIn: true, locked: false, challenge: false, viewerId: ME };

  it('recognises X login and check pages', () => {
    expect(isLoginPath('/i/flow/login')).toBe(true);
    expect(isLoginPath('/login')).toBe(true);
    expect(isLoginPath('/home')).toBe(false);
    expect(isCheckPath('/account/access')).toBe(true);
    expect(isCheckPath('/account/login_challenge')).toBe(true);
    expect(isCheckPath('/i/flow/consent_flow')).toBe(true);
    expect(isCheckPath('/i/flow/login')).toBe(false);
    expect(isCheckPath('/search')).toBe(false);
  });

  it('says what the person has to do, most basic first', () => {
    expect(pageNeed(page, ME)).toBeNull();
    expect(pageNeed({ ...page, loggedIn: false, viewerId: null }, ME)).toBe('login');
    expect(pageNeed({ ...page, locked: true, challenge: true }, ME)).toBe('verify');
    expect(pageNeed({ ...page, challenge: true }, ME)).toBe('verify');
    expect(pageNeed({ ...page, viewerId: '2000' }, ME)).toBe('account');
    expect(pageNeed({ ...page, loggedIn: false, viewerId: '2000' }, ME)).toBe('login');
  });

  it('names the account to log in to', () => {
    expect(needMessage('login', 'me')).toContain('@me');
    expect(needMessage('account', '')).toContain('your account');
  });
});
