import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobContext } from '../src/engine/context';
import { Limiter } from '../src/engine/limiter';
import type * as Timers from '../src/engine/timers';
import { db, getViewCap, setViewCap, upsertAccount } from '../src/shared/db';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import type { Job } from '../src/shared/types';
import { VIEW_CAP_MIN_SEEN, learnViewCap, unexplainedRefusal, viewCapFreeAt } from '../src/shared/x-limits';

// The real sleep runs on a Web Worker, which tests don't have; waits end at once and are recorded instead.
vi.mock('../src/engine/timers', async (importOriginal) => ({
  ...(await importOriginal<typeof Timers>()),
  sleep: async () => {},
}));

const ACCOUNT = 'acct-1';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 2, 12);

describe('the daily view cap rules (PLAYBOOK A4, #28)', () => {
  it('takes only a 429 that names no reset and no used-up window as unexplained', () => {
    expect(unexplainedRefusal({ status: 429, remaining: null, reset: null })).toBe(true);
    expect(unexplainedRefusal({ status: 429, remaining: 5, reset: null })).toBe(true);
    expect(unexplainedRefusal({ status: 429, remaining: 0, reset: null })).toBe(false);
    expect(unexplainedRefusal({ status: 429, remaining: null, reset: NOW + 60_000 })).toBe(false);
    expect(unexplainedRefusal({ status: 200, remaining: null, reset: null })).toBe(false);
  });

  it('learns 80% of the posts seen, only from enough of them, and never raises a cap', () => {
    expect(learnViewCap(VIEW_CAP_MIN_SEEN - 1, null, NOW)).toBeNull();
    expect(learnViewCap(1000, null, NOW)).toEqual({ cap: 800, seen: 1000, learnedAt: NOW });
    const earlier = { cap: 600, seen: 750, learnedAt: NOW - DAY };
    expect(learnViewCap(1000, earlier, NOW)).toBeNull();
    expect(learnViewCap(500, earlier, NOW)).toEqual({ cap: 400, seen: 500, learnedAt: NOW });
  });

  it('frees up when enough of the day’s oldest pages age out', () => {
    const seen = [
      { ts: NOW - 20 * HOUR, posts: 300 },
      { ts: NOW - 10 * HOUR, posts: 300 },
      { ts: NOW - HOUR, posts: 300 },
      { ts: NOW - 2 * DAY, posts: 999 },
    ];
    expect(viewCapFreeAt(seen, 1000, NOW)).toBe(NOW);
    expect(viewCapFreeAt(seen, 900, NOW)).toBe(NOW - 20 * HOUR + DAY);
    expect(viewCapFreeAt(seen, 500, NOW)).toBe(NOW - 10 * HOUR + DAY);
  });
});

describe('the limiter counts posts seen and keeps to a learned cap', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    await Promise.all([db.reads.clear(), db.logs.clear(), db.kv.clear(), db.accounts.clear()]);
    await upsertAccount({ id: ACCOUNT, handle: 'me', verified: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const limiter = (onWait = vi.fn<(reason: string, until: number) => void>()) =>
    new Limiter(DEFAULT_SETTINGS, ACCOUNT, new AbortController().signal, onWait);

  it('adds the posts each page showed to its stored row, so later runs count them', async () => {
    const first = limiter();
    await first.init();
    first.after('read', 'done', 'userTimeline');
    first.seen(20);
    first.after('read', 'done', 'userTimeline');
    first.seen(15);
    first.seen(5);
    expect(first.postsSeen).toBe(40);
    await vi.waitFor(async () => expect((await db.reads.toArray()).map((r) => r.posts)).toEqual([20, 20]));

    const next = limiter();
    await next.init();
    expect(next.postsSeen).toBe(40);
  });

  it('learns a cap once enough was seen, stores it, and only ever lowers it', async () => {
    const l = limiter();
    await l.init();
    l.after('read', 'done', 'search');
    l.seen(50);
    expect(await l.learnViewCap()).toBeNull();

    l.seen(950);
    expect(await l.learnViewCap()).toEqual({ cap: 800, seen: 1000, learnedAt: NOW });
    expect(await getViewCap(ACCOUNT)).toMatchObject({ cap: 800 });
    expect(await l.learnViewCap()).toBeNull();
  });

  it('waits before a page load once the posts seen today reach the learned cap', async () => {
    await setViewCap(ACCOUNT, { cap: 100, seen: 125, learnedAt: NOW - HOUR });
    await db.reads.add({ accountId: ACCOUNT, budget: 'userTimeline', ts: NOW - 3 * HOUR, posts: 120 });
    const onWait = vi.fn<(reason: string, until: number) => void>();
    const l = limiter(onWait);
    await l.init();
    expect(l.learnedViewCap).toMatchObject({ cap: 100 });

    await l.before('read', 'userTimeline');
    const capWait = onWait.mock.calls.find(([reason]) => reason.startsWith('Daily view cap learned from X'));
    expect(capWait?.[1]).toBeGreaterThanOrEqual(NOW - 3 * HOUR + DAY);
  });
});

describe('a refused page teaches the cap (JobContext.pageRateLimit)', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    await Promise.all([db.reads.clear(), db.logs.clear(), db.kv.clear(), db.limits.clear()]);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function context() {
    const ctx = new JobContext({ id: 'j', accountId: ACCOUNT } as Job, new AbortController().signal, {
      status: () => {},
      attention: () => {},
    });
    ctx.limiter = new Limiter(DEFAULT_SETTINGS, ACCOUNT, new AbortController().signal, () => {});
    await db.reads.add({ accountId: ACCOUNT, budget: 'userTimeline', ts: NOW - HOUR, posts: 1000 });
    await ctx.limiter.init();
    return ctx;
  }
  const refuse = (reset: number | null) =>
    db.limits.put({
      key: `${ACCOUNT}:UserTweets`,
      accountId: ACCOUNT,
      op: 'UserTweets',
      limit: null,
      remaining: null,
      reset,
      status: 429,
      at: NOW,
    });

  it('learns the cap from a 429 X does not explain, and says so in the log', async () => {
    const ctx = await context();
    await refuse(null);
    expect(await ctx.pageRateLimit(NOW - 1000)).toMatchObject({ outcome: 'rate_limited' });
    expect(await getViewCap(ACCOUNT)).toMatchObject({ cap: 800, seen: 1000 });
    const log = await db.logs.toArray();
    expect(log.map((e) => e.message).join('\n')).toMatch(/now stops at 800 posts a day/);
  });

  it('learns nothing from a 429 that names X’s reset time', async () => {
    const ctx = await context();
    await refuse(NOW + 10 * 60_000);
    expect(await ctx.pageRateLimit(NOW - 1000)).toMatchObject({ outcome: 'rate_limited' });
    expect(await getViewCap(ACCOUNT)).toBeNull();
  });
});
