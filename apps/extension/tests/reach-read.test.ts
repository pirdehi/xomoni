import 'fake-indexeddb/auto';
import { REACH_LIMITS, parseReachSummary } from '@xomoni/bridge';
import { beforeEach, describe, expect, it } from 'vitest';
import { readReach } from '../src/cloud/reach-read';
import { db, itemKey, kvSet, upsertAccount } from '../src/shared/db';
import type { Item } from '../src/shared/types';
import { setDismissed } from '../src/shared/vault/suspect-dismissals';
import { account, resetDb } from './support/fixtures';

/** An account with an X id, as the vault's months need. */
const ME = '1000';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 20, 12);

/** One of the person's posts made `daysAgo` days before NOW, seen `views` times a day before NOW. */
function post(id: string, daysAgo: number, views: number | undefined, over: Partial<Item> = {}): Item {
  const kind = over.kind ?? 'post';
  return {
    key: itemKey(ME, kind, id),
    accountId: ME,
    kind,
    id,
    targetId: id,
    createdAt: NOW - daysAgo * DAY,
    likedAt: null,
    text: `Post ${id}`,
    author: 'me',
    inReplyToId: null,
    selfReply: false,
    likes: 0,
    reposts: 0,
    replies: 0,
    sources: ['scan'],
    status: 'present',
    seenAt: NOW - DAY,
    statusAt: NOW,
    lastJobId: null,
    links: 0,
    media: 0,
    ...(views !== undefined && { views }),
    ...over,
  };
}

/** Thirty posts at about 1,000 views 31 to 54 days ago, twenty 11 to 29 days ago, and one at 100, 10 days ago. */
const POSTS = [
  ...Array.from({ length: 30 }, (_, i) => post(String(100 + i), 54 - i * 0.8, 950 + (i % 3) * 50)),
  ...Array.from({ length: 20 }, (_, i) => post(String(200 + i), 29 - i * 0.9, 950 + (i % 3) * 50)),
  post('1', 10, 100, { text: 'x'.repeat(500) }),
];

const month = new Date(NOW - 10 * DAY).toISOString().slice(0, 7);

async function seed() {
  await upsertAccount(account({ id: ME, verified: false }));
  await kvSet('activeAccount', ME);
  await db.items.bulkPut(POSTS);
  await db.labelMonths.put({
    accountId: ME,
    month,
    importedAt: NOW - DAY,
    labels: [{ name: 'SPAM_HIGH_RECALL', count: 1, scope: 'posts' }],
    postsInMonth: 25,
  });
}

describe('Reach as xomoni.com reads it (#431, ADR-0045 point 6, ADR-0028)', () => {
  beforeEach(resetDb);

  it('answers the active account’s period, within the limits, in a shape the website’s parser takes', async () => {
    await seed();
    const answer = await readReach({ rangeDays: 30, order: 'recent', offset: 0 }, NOW);
    expect(parseReachSummary(JSON.parse(JSON.stringify(answer)))).toEqual(answer);
    expect(answer).toMatchObject({ rangeDays: 30, csv: 0, live: 21, total: 21 });
    expect(answer.posts[0]).toMatchObject({ id: '1', impressions: 100, source: 'live' });
    expect(answer.posts[0]?.text).toHaveLength(REACH_LIMITS.text);
    expect(answer.posts[0]?.vsUsual).toBeCloseTo(0.1, 1);
    expect(answer.comparisons.map((c) => c.id)).toEqual(['links', 'media', 'premium']);
    expect(answer.months).toEqual([
      { month, labels: [{ name: 'SPAM_HIGH_RECALL', count: 1, scope: 'posts' }], postsInMonth: 25, eligible: null },
    ]);
    expect(answer.suspects).toHaveLength(1);
    expect(answer.suspects[0]).toMatchObject({ id: '1', month, label: 'SPAM_HIGH_RECALL', guess: true });
  });

  it('orders the posts most seen, least seen (settled only) or newest first, and pages them', async () => {
    await seed();
    await db.items.put(post('9', 2, 1));
    const best = await readReach({ rangeDays: 30, order: 'best', offset: 0 }, NOW);
    expect(best.posts[0]?.impressions).toBe(1_050);
    const worst = await readReach({ rangeDays: 30, order: 'worst', offset: 0 }, NOW);
    expect(worst.posts[0]?.id).toBe('1');
    expect(worst.posts.map((p) => p.id)).not.toContain('9');
    const page = await readReach({ rangeDays: 30, order: 'recent', offset: 20 }, NOW);
    // 22 posts in the period with the young one: the page from 20 holds the two oldest.
    expect(page.posts.map((p) => p.id)).toEqual(['201', '200']);
    expect((await readReach({ rangeDays: null, order: 'recent', offset: 0 }, NOW)).total).toBe(52);
  });

  it('leaves the dismissed suspects out, and never names one without a label month', async () => {
    await seed();
    await setDismissed(ME, '1', true);
    expect((await readReach({ rangeDays: 30, order: 'recent', offset: 0 }, NOW)).suspects).toEqual([]);
    await db.labelMonths.clear();
    await setDismissed(ME, '1', false);
    const none = await readReach({ rangeDays: 30, order: 'recent', offset: 0 }, NOW);
    expect(none.suspects).toEqual([]);
    expect(none.months).toEqual([]);
  });

  it('carries no infinite ratio, which JSON can’t', async () => {
    await upsertAccount(account({ id: ME }));
    await kvSet('activeAccount', ME);
    await db.items.bulkPut([
      ...Array.from({ length: 15 }, (_, i) => post(String(300 + i), 10 + i, 500, { links: 1 })),
      ...Array.from({ length: 15 }, (_, i) => post(String(400 + i), 10 + i, 0)),
    ]);
    const answer = await readReach({ rangeDays: 30, order: 'recent', offset: 0 }, NOW);
    const links = answer.comparisons.find((c) => c.id === 'links');
    expect(links?.verdict).toBe('clear-higher');
    expect(links?.ratio).toBeNull();
    expect(parseReachSummary(JSON.parse(JSON.stringify(answer)))).toEqual(answer);
  });

  it('answers nothing for a browser that knows no X account', async () => {
    expect(await readReach({ rangeDays: 30, order: 'best', offset: 0 }, NOW)).toEqual({
      rangeDays: 30,
      csv: 0,
      live: 0,
      comparisons: [],
      months: [],
      posts: [],
      total: 0,
      suspects: [],
    });
  });
});
