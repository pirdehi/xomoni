// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://x.com/search?q=%23xomoni&src=typed_query&f=live"}
import { afterEach, describe, expect, it } from 'vitest';
import { runCommand } from '../src/content/actor';
import { accountMadeAt, handleCapture } from '../src/content/net';
import type { WatchPost } from '../src/shared/watch';

/** Every click on the page, which reading posts must never make. */
let clicks = 0;
document.addEventListener('click', () => clicks++, true);

/** A post on X's search page as X renders it: author line, linked timestamp, text and action buttons. */
const article = (id: string, handle: string, name: string, text: string, linked = true) => `
  <article data-testid="tweet">
    <div data-testid="User-Name">
      <div><a href="/${handle}" role="link"><span>${name}</span></a></div>
      <div><a href="/${handle}" role="link"><span>@${handle}</span></a></div>
    </div>
    ${linked ? `<a href="/${handle}/status/${id}"><time datetime="2026-11-05T08:00:00.000Z"></time></a>` : '<span>Ad</span>'}
    <div data-testid="tweetText">${text}</div>
    <button data-testid="like"></button><button data-testid="reply"></button>
  </article>`;

const readPosts = (limit: number) => runCommand({ cmd: 'readPosts', limit }) as Promise<WatchPost[]>;

afterEach(() => {
  document.body.innerHTML = '';
  clicks = 0;
});

/**
 * X's answer to the page's search, as the interceptor captures it (#391): a post by each author, with the date their
 * account was made where given (X's `core.created_at`).
 */
function searchAnswer(authors: [handle: string, created?: string][]) {
  const entries = authors.map(([handle, created], i) => ({
    entryId: `tweet-2${String(i)}`,
    sortIndex: String(i),
    content: {
      itemContent: {
        tweet_results: {
          result: {
            rest_id: `2${String(i)}`,
            core: {
              user_results: { result: { core: { screen_name: handle, ...(created && { created_at: created }) } } },
            },
            legacy: { id_str: `2${String(i)}`, full_text: 'a post' },
          },
        },
      },
    },
  }));
  handleCapture({
    op: 'SearchTimeline',
    url: 'https://x.com/i/api/graphql/q/SearchTimeline',
    status: 200,
    reqBody: null,
    headers: {},
    body: JSON.stringify({
      data: { search_by_raw_query: { search_timeline: { timeline: { instructions: [{ entries }] } } } },
    }),
  });
}

describe('when each author made their account, from the search’s own answer (#391)', () => {
  it('adds it to the posts read, where the answer said, and asks X for nothing', async () => {
    searchAnswer([
      ['new_one', 'Mon Nov 16 10:00:00 +0000 2026'],
      ['old_one', 'Tue Mar 01 10:00:00 +0000 2011'],
      ['no_date'],
    ]);
    document.body.innerHTML =
      article('20', 'New_One', 'New', 'Hello') +
      article('19', 'old_one', 'Old', 'Hi') +
      article('18', 'no_date', 'No date', 'Hey');
    const posts = await readPosts(10);
    expect(posts.map((p) => p.accountCreatedAt)).toEqual([
      Date.UTC(2026, 10, 16, 10),
      Date.UTC(2011, 2, 1, 10),
      undefined,
    ]);
    // Without a date, no field at all: never a guess.
    expect(posts[2]).not.toHaveProperty('accountCreatedAt');
    expect(clicks).toBe(0);
  });

  it('takes no date after now, and none from an answer X refused', () => {
    searchAnswer([['from_the_future', 'Mon Nov 16 10:00:00 +0000 2099']]);
    expect(accountMadeAt('from_the_future')).toBeNull();
    handleCapture({
      op: 'SearchTimeline',
      url: 'https://x.com/i/api/graphql/q/SearchTimeline',
      status: 429,
      reqBody: null,
      headers: {},
      body: JSON.stringify({ data: {} }),
    });
    expect(accountMadeAt('nobody_seen')).toBeNull();
  });
});

describe('reading the newest posts for Watch (#158)', () => {
  it('reads id, author, name, time and text in the page’s order, clicking nothing', async () => {
    document.body.innerHTML =
      article('20', 'ali', 'Ali', 'سلام به برنامه‌نویس‌ها #xomoni') + article('19', 'bea', 'Bea', 'Second post');
    expect(await readPosts(10)).toEqual([
      {
        id: '20',
        handle: 'ali',
        name: 'Ali',
        text: 'سلام به برنامه‌نویس‌ها #xomoni',
        time: Date.parse('2026-11-05T08:00:00.000Z'),
      },
      { id: '19', handle: 'bea', name: 'Bea', text: 'Second post', time: Date.parse('2026-11-05T08:00:00.000Z') },
    ]);
    expect(clicks).toBe(0);
  });

  it('stops at the limit, leaves out posts without a linked time (ads) and repeats', async () => {
    document.body.innerHTML = [
      article('1', 'a', 'A', 'one'),
      article('ad', 'brand', 'Brand', 'Buy now', false),
      article('1', 'a', 'A', 'one again'),
      article('2', 'b', 'B', 'two'),
      article('3', 'c', 'C', 'three'),
    ].join('');
    expect((await readPosts(2)).map((p) => p.id)).toEqual(['1', '2']);
    expect((await readPosts(10)).map((p) => p.id)).toEqual(['1', '2', '3']);
  });

  it('reads an author line without a display name as no name, and caps long text', async () => {
    document.body.innerHTML = article('5', 'e', '@e', 'x'.repeat(1500));
    const [only] = await readPosts(10);
    expect(only?.name).toBe('');
    expect(only?.text).toHaveLength(1000);
  });

  it('reads nothing from an empty page', async () => {
    expect(await readPosts(10)).toEqual([]);
  });
});
