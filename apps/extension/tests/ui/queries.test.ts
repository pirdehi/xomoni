// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/shared/db';
import {
  KINDS,
  LIBRARY_PAGE_SIZE,
  kindCounts,
  libraryPage,
  matchesSearch,
  useKindCounts,
  useYearHistogram,
  yearHistogram,
} from '../../src/ui/queries';
import { ME, resetDb } from '../support/fixtures';
import { countReads, installReadCounter } from '../support/reads';
import { item } from '../support/shell';

describe('inventory queries', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('lists every kind in display order', () => {
    expect(KINDS).toEqual(['post', 'reply', 'repost', 'like']);
  });

  it('counts present and removed items per kind, leaving out gone items and other accounts', async () => {
    await db.items.bulkAdd([
      item('post', 'present'),
      item('post', 'present'),
      item('post', 'deleted'),
      item('post', 'gone'),
      item('reply', 'deleted'),
      item('like', 'present'),
      item('post', 'present', { accountId: 'someone-else', key: 'someone-else:post:x' }),
    ]);
    const { result } = renderHook(() => useKindCounts(ME));

    await waitFor(() => {
      expect(result.current).toEqual({
        post: { present: 2, deleted: 1 },
        reply: { present: 0, deleted: 1 },
        repost: { present: 0, deleted: 0 },
        like: { present: 1, deleted: 0 },
      });
    });
  });

  it('updates the counts when the inventory changes', async () => {
    const { result } = renderHook(() => useKindCounts(ME));
    await waitFor(() => {
      expect(result.current?.repost).toEqual({ present: 0, deleted: 0 });
    });

    await db.items.add(item('repost', 'present'));
    await waitFor(() => {
      expect(result.current?.repost).toEqual({ present: 1, deleted: 0 });
    });
  });

  it('counts only the account’s own, not those of an account whose id starts with its id (#390)', async () => {
    const other = `${ME}0`;
    await db.items.bulkAdd([
      item('post', 'present'),
      item('post', 'gone'),
      item('like', 'deleted'),
      item('post', 'present', { accountId: other, key: `${other}:post:a` }),
      item('post', 'deleted', { accountId: other, key: `${other}:post:b` }),
      item('like', 'present', { accountId: other, key: `${other}:like:c` }),
    ]);
    expect(await kindCounts(ME)).toEqual({
      post: { present: 1, deleted: 0 },
      reply: { present: 0, deleted: 0 },
      repost: { present: 0, deleted: 0 },
      like: { present: 0, deleted: 1 },
    });
    expect((await kindCounts(other)).post).toEqual({ present: 1, deleted: 1 });
  });

  it('has no counts without an account', async () => {
    const { result } = renderHook(() => useKindCounts(undefined));
    // Let the live query settle, then check it still reports nothing.
    await db.items.count();
    expect(result.current).toBeUndefined();
  });

  it('counts present items per year and fills empty years in between', async () => {
    await db.items.bulkAdd([
      item('post', 'present', { createdAt: new Date(2017, 3, 1).getTime() }),
      item('post', 'present', { createdAt: new Date(2017, 8, 1).getTime() }),
      item('reply', 'present', { createdAt: new Date(2017, 8, 2).getTime() }),
      item('post', 'present', { createdAt: new Date(2020, 0, 1).getTime() }),
      item('post', 'deleted', { createdAt: new Date(2018, 0, 1).getTime() }),
      item('like', 'present', { createdAt: new Date(2019, 0, 1).getTime() }),
    ]);
    const { result } = renderHook(() => useYearHistogram(ME, ['post', 'reply']));

    await waitFor(() => {
      expect(result.current).toEqual([
        { year: 2017, values: { post: 2, reply: 1 } },
        { year: 2018, values: {} },
        { year: 2019, values: {} },
        { year: 2020, values: { post: 1 } },
      ]);
    });
  });

  it('returns an empty histogram for an empty inventory, and none without an account', async () => {
    const empty = renderHook(() => useYearHistogram(ME, ['like']));
    await waitFor(() => {
      expect(empty.result.current).toEqual([]);
    });

    const none = renderHook(() => useYearHistogram(undefined, ['like']));
    await db.items.count();
    expect(none.result.current).toBeUndefined();
  });

  it('counts a year by local time, and leaves out items without a date (#390)', async () => {
    await db.items.bulkAdd([
      item('post', 'present', { createdAt: new Date(2018, 11, 31, 23, 59, 59, 999).getTime() }),
      item('post', 'present', { createdAt: new Date(2019, 0, 1).getTime() }),
      item('post', 'present', { createdAt: 0 }),
      item('post', 'gone', { createdAt: new Date(2019, 5, 1).getTime() }),
    ]);
    expect(await yearHistogram(ME, ['post'])).toEqual([
      { year: 2018, values: { post: 1 } },
      { year: 2019, values: { post: 1 } },
    ]);
  });

  it('recounts when the kinds change', async () => {
    await db.items.bulkAdd([
      item('post', 'present', { createdAt: new Date(2016, 0, 1).getTime() }),
      item('like', 'present', { createdAt: new Date(2016, 0, 1).getTime() }),
    ]);
    const { result, rerender } = renderHook(({ kinds }) => useYearHistogram(ME, kinds), {
      initialProps: { kinds: ['post'] as ('post' | 'like')[] },
    });
    await waitFor(() => {
      expect(result.current).toEqual([{ year: 2016, values: { post: 1 } }]);
    });

    rerender({ kinds: ['post', 'like'] });
    await waitFor(() => {
      expect(result.current).toEqual([{ year: 2016, values: { post: 1, like: 1 } }]);
    });
  });
});

describe('libraryPage (#390)', () => {
  beforeAll(async () => {
    await installReadCounter();
  });
  beforeEach(async () => {
    await resetDb();
  });

  it('reads a large group of likes with one time once, not again for each bulk read', async () => {
    // Likes from X's archive of posts older than X's ids with a time all have 0: 2,500 of them, and a few newer.
    const likes = [
      ...Array.from({ length: 2_500 }, (_, n) =>
        item('like', 'present', { createdAt: 0, text: n % 500 ? `like ${String(n)}` : `like ${String(n)} launch` }),
      ),
      ...Array.from({ length: 30 }, (_, n) =>
        item('like', 'present', { createdAt: Date.UTC(2020, 0, 1 + n), text: `recent ${String(n)}` }),
      ),
    ];
    await db.items.bulkAdd(likes);
    const { result, reads } = await countReads(() =>
      libraryPage({ accountId: ME, kind: 'like', status: 'present', query: 'no such word', page: 0 }),
    );
    expect(result).toEqual([]);
    // Every like once, but for the edge of the first bulk read, and no cursor: reading the group again for each read
    // came to tens of thousands of rows.
    expect(reads.rows.items).toBeLessThanOrEqual(likes.length + 1_000);
    expect(reads.steps.items ?? 0).toBe(0);

    const found = (await libraryPage({ accountId: ME, kind: 'like', status: 'present', query: 'launch', page: 0 })).map(
      (i) => i.key,
    );
    const expected = likes
      .filter((i) => i.text.includes('launch'))
      .sort((a, b) => b.createdAt - a.createdAt || (a.key < b.key ? 1 : -1))
      .map((i) => i.key);
    expect(found).toEqual(expected);
  });

  it('pages a search newest first, as one walk down the list would, across bulk reads and equal times', async () => {
    // 2,700 posts in three moments, so a bulk read of 1,000 ends in the middle of posts posted at the same time.
    const posts = Array.from({ length: 2_700 }, (_, n) =>
      item('post', 'present', {
        createdAt: Date.UTC(2020, 0, 1 + Math.floor(n / 900)),
        text: n % 3 ? `post ${String(n)}` : `post ${String(n)} with a launch`,
        author: n % 50 ? 'me' : 'Ada',
      }),
    );
    await db.items.bulkAdd(posts);
    const newestFirst = [...posts].sort((a, b) => b.createdAt - a.createdAt || (a.key < b.key ? 1 : -1));
    const expected = (match: (text: string, author: string) => boolean, page: number) =>
      newestFirst
        .filter((p) => match(p.text.toLowerCase(), p.author.toLowerCase()))
        .slice(page * LIBRARY_PAGE_SIZE, (page + 1) * LIBRARY_PAGE_SIZE)
        .map((p) => p.key);
    const keys = async (query: string, page: number) =>
      (await libraryPage({ accountId: ME, kind: 'post', status: 'present', query, page })).map((p) => p.key);

    for (const page of [0, 1, 35, 36, 40]) {
      expect(await keys(' LAUNCH ', page)).toEqual(expected((text) => text.includes('launch'), page));
    }
    // An author, with or without the @, and words in the text.
    expect(await keys('@ada', 0)).toEqual(expected((_, author) => author.includes('ada'), 0));
    expect(await keys('@ada', 1)).toEqual(expected((_, author) => author.includes('ada'), 1));
    expect(await keys('nothing like it', 0)).toEqual([]);
    // Without a search, a page of the list as it is.
    expect(await keys('', 50)).toEqual(newestFirst.slice(50 * 25, 51 * 25).map((p) => p.key));
  });
});

// One rule for the rows Browse lists and the file *Export JSON* saves (#440).
describe('matchesSearch', () => {
  const post = { text: 'Our Launch went well', author: 'Alice_Smith' };

  it('matches everything for an empty search, or one of spaces', () => {
    expect(matchesSearch(post, '')).toBe(true);
    expect(matchesSearch(post, '   ')).toBe(true);
    expect(matchesSearch({ text: '', author: '' }, '')).toBe(true);
  });

  it('finds words in the text, in any case, with the spaces around the search left out', () => {
    expect(matchesSearch(post, 'launch')).toBe(true);
    expect(matchesSearch(post, '  LAUNCH WENT ')).toBe(true);
    expect(matchesSearch(post, 'lunch')).toBe(false);
  });

  it('finds an author with or without the @, in any case', () => {
    expect(matchesSearch(post, 'alice')).toBe(true);
    expect(matchesSearch(post, '@ALICE_smith')).toBe(true);
    expect(matchesSearch(post, '@bob')).toBe(false);
  });

  it('finds an @ written in the text', () => {
    expect(matchesSearch({ text: 'thanks @bob!', author: 'me' }, '@bob')).toBe(true);
  });

  it('reads markup as text, not as a pattern', () => {
    expect(matchesSearch({ text: 'a <b>bold</b> (claim)', author: 'me' }, '<b>bold')).toBe(true);
    expect(matchesSearch({ text: 'plain', author: 'me' }, '.*')).toBe(false);
  });
});
