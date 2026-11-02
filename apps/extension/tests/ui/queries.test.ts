// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/shared/db';
import { KINDS, useKindCounts, useYearHistogram } from '../../src/ui/queries';
import { ME, resetDb } from '../support/fixtures';
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
