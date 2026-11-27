import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db, itemKey } from '../src/shared/db';
import type { Item } from '../src/shared/types';
import { reachPosts } from '../src/shared/vault/reach';
import { reachComparisons } from '../src/shared/vault/reach-compare';
import { baseline } from '../src/shared/vault/reach-stats';
import { suspectPosts } from '../src/shared/vault/suspects';
import type { LabelMonth } from '../src/shared/vault/under-the-hood';
import { ME } from './support/fixtures';

// Reach at a heavy X user's size (#431, P5.4.3, docs/TESTING.md): 50,000 posts with their views, a link on one in
// three and photos on one in four, over two years, and 24 months of X's labels. Each step has a budget, as the
// plan sets it: the posts read under a second, the three comparisons of 2,000 resamples under half a second, and the
// suspected posts of 24 months under half a second. X's index is played, as filling fake-indexeddb with 50,000 rows
// would take minutes; the browser's own read is timed in `apps/web/e2e/extension/scale.spec.ts`.

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 25, 12);
const COUNT = 50_000;

/** A post of the account, `n` of 50,000, made over the two years before NOW, with views that vary by a pattern. */
function post(n: number): Item {
  const id = String(1_800_000_000_000_000_000n + BigInt(n));
  const createdAt = NOW - 730 * DAY + Math.floor((n * 730 * DAY) / COUNT);
  return {
    key: itemKey(ME, 'post', id),
    accountId: ME,
    kind: 'post',
    id,
    targetId: id,
    createdAt,
    likedAt: null,
    text: `Post ${String(n)}`,
    author: 'me',
    inReplyToId: null,
    selfReply: false,
    likes: n % 50,
    reposts: n % 7,
    replies: n % 11,
    views: 200 + ((n * 7919) % 5_000),
    links: n % 3 === 0 ? 1 : 0,
    media: n % 4 === 0 ? 1 : 0,
    sources: ['scan'],
    status: 'present',
    seenAt: createdAt + 30 * DAY,
    statusAt: createdAt,
    lastJobId: null,
  };
}

/** 24 months of X's report, each with one label on 3 posts. */
const MONTHS: LabelMonth[] = Array.from({ length: 24 }, (_, i) => {
  const d = new Date(NOW - (i + 1) * 30 * DAY);
  return {
    month: `${String(d.getUTCFullYear())}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
    labels: [{ name: 'SPAM_HIGH_RECALL', count: 3, scope: 'posts' }],
  };
});

/** How long `run` takes, in ms. */
async function timed<T>(run: () => T | Promise<T>): Promise<{ value: T; ms: number }> {
  const start = performance.now();
  const value = await run();
  return { value, ms: performance.now() - start };
}

afterEach(() => vi.restoreAllMocks());

describe('Reach at 50,000 posts (#431, P5.4.3)', () => {
  it('reads the posts under a second, compares them under half a second, and guesses over 24 months as fast', async () => {
    const many = Array.from({ length: COUNT }, (_, n) => post(n));
    vi.spyOn(db.items, 'where').mockImplementation((() => ({
      between: (lower: readonly unknown[]) => ({
        toArray: () => Promise.resolve(lower[1] === 'post' ? many : []),
      }),
    })) as never);

    const read = await timed(() => reachPosts(ME, { from: 0, to: NOW, timeZone: 'UTC' }));
    expect(read.value).toHaveLength(COUNT);
    expect(read.ms).toBeLessThan(1_000);

    const compared = await timed(() => reachComparisons(read.value, []));
    expect(compared.value.map((c) => c.id)).toEqual(['links', 'media', 'premium']);
    expect(compared.value.find((c) => c.id === 'links')?.result.verdict).not.toBe('not-enough-data');
    expect(compared.ms).toBeLessThan(500);

    const guessed = await timed(() => suspectPosts(read.value, MONTHS, new Set(), baseline(read.value)));
    expect(guessed.value).toHaveLength(24);
    expect(guessed.ms).toBeLessThan(500);
  });
});
