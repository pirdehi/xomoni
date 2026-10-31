import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runCleanup } from '../src/engine/cleanup';
import { JobContext, Stop } from '../src/engine/context';
import { db } from '../src/shared/db';
import type { ActionResult, ContentState } from '../src/shared/messages';
import type * as Timers from '../src/engine/timers';
import { DAY } from '../src/shared/time';
import type { Job } from '../src/shared/types';

// The real sleep runs on a Web Worker, which tests don't have.
vi.mock('../src/engine/timers', async (importOriginal) => ({
  ...(await importOriginal<typeof Timers>()),
  sleep: async () => {},
}));

const ACCOUNT = 'acct-1';
const NOW = Date.now();
const LIMIT: ActionResult = {
  outcome: 'rate_limited',
  resetAt: NOW + 60_000,
  message: 'Search: X’s rate limit reached',
};

interface Load {
  kind: ContentState['kind'];
  /** X answered this load with a 429. */
  limited?: boolean;
}

/** Just enough of a JobContext for the sweep: each navigation returns the next of `loads`. */
function fakeContext(loads: Load[], deep = false) {
  const queue = [...loads];
  let current: Load = { kind: 'empty' };
  const ctx = {
    job: {
      id: 'j',
      accountId: ACCOUNT,
      filter: {
        target: 'post',
        before: NOW,
        after: null,
        keepMinLikes: null,
        keepKeywords: [],
        keepIds: [],
        skipSelfReplies: false,
      },
      options: { sweep: true, deep, ghostLikes: false },
      stats: { matched: 0, done: 0, skipped: 0, failed: 0, scanned: 0 },
    },
    handle: 'me',
    attempted: new Set<string>(),
    navigate: vi.fn(async (_url: string) => {
      current = queue.shift() ?? { kind: 'empty' };
      return { kind: current.kind, count: 0 };
    }),
    pageRateLimit: vi.fn(async () => (current.limited ? LIMIT : null)),
    settle: vi.fn(async () => false),
    log: vi.fn(async (_level: string, _action: string, _message: string) => 0),
    save: vi.fn(async () => {}),
    setPhase: vi.fn(async () => {}),
    status: vi.fn(),
    limiter: { cooldown: vi.fn(async () => {}) },
  };
  return ctx;
}

const run = (ctx: ReturnType<typeof fakeContext>) => runCleanup(ctx as unknown as JobContext);
const logged = (ctx: ReturnType<typeof fakeContext>) => ctx.log.mock.calls.map((call) => call[2]);

describe('Sweep after a rate limit (#16, PLAYBOOK A5)', () => {
  it('loads the same search page again after X’s reset instead of abandoning it', async () => {
    const ctx = fakeContext([{ kind: 'error', limited: true }, { kind: 'empty' }]);
    await run(ctx);
    expect(ctx.navigate).toHaveBeenCalledTimes(2);
    const [first, second] = ctx.navigate.mock.calls.map((call) => call[0]);
    expect(first).toContain('https://x.com/search?');
    expect(second).toBe(first);
    // `settle` records the rate limit for the risk ladder and waits for X's reset.
    expect(ctx.settle).toHaveBeenCalledExactlyOnceWith('read', null, LIMIT);
    expect(logged(ctx)).toContain('Sweep: no more matching posts on X');
    expect(logged(ctx).some((m) => m.includes('continuing with the inventory'))).toBe(false);
  });

  it('pauses instead of falling back to the deep clean when X keeps rate-limiting search', async () => {
    const ctx = fakeContext(
      Array.from({ length: 4 }, () => ({ kind: 'error' as const, limited: true })),
      true,
    );
    const err = await run(ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Stop);
    expect((err as Stop).state).toBe('paused');
    expect(ctx.navigate).toHaveBeenCalledTimes(4);
    expect(ctx.settle).toHaveBeenCalledTimes(3);
    expect(ctx.setPhase).not.toHaveBeenCalledWith('deep');
  });

  it('tries a page that failed for another reason again before using the inventory', async () => {
    const ctx = fakeContext([{ kind: 'timeout' }, { kind: 'empty' }]);
    await run(ctx);
    expect(ctx.navigate).toHaveBeenCalledTimes(2);
    expect(ctx.limiter.cooldown).toHaveBeenCalledOnce();
    expect(ctx.settle).not.toHaveBeenCalled();
    expect(logged(ctx)).toContain('Sweep: no more matching posts on X');
  });

  it('hands over to the deep clean only after a page keeps failing for another reason', async () => {
    const ctx = fakeContext([{ kind: 'error' }, { kind: 'error' }, { kind: 'error' }], true);
    await run(ctx);
    expect(ctx.navigate).toHaveBeenCalledTimes(3);
    expect(ctx.limiter.cooldown).toHaveBeenCalledTimes(2);
    expect(ctx.settle).not.toHaveBeenCalled();
    expect(logged(ctx)).toContain('Sweep: the page did not load after 3 tries (error); continuing with the inventory');
    expect(ctx.setPhase).toHaveBeenCalledWith('deep');
  });
});

describe('JobContext.pageRateLimit', () => {
  const context = () =>
    new JobContext({ id: 'j', accountId: ACCOUNT } as Job, new AbortController().signal, {
      status: () => {},
      attention: () => {},
    });
  const observe = (op: string, at: number, patch: { status?: number; remaining?: number | null }) =>
    db.limits.put({
      key: `${ACCOUNT}:${op}`,
      accountId: ACCOUNT,
      op,
      limit: 50,
      remaining: patch.remaining ?? null,
      reset: NOW + 10 * 60_000,
      status: patch.status ?? 200,
      at,
    });

  beforeEach(async () => {
    await db.limits.clear();
  });

  it('reports a 429 on the page’s requests with X’s reset time', async () => {
    await observe('UserTweets', NOW, { status: 429 });
    expect(await context().pageRateLimit(NOW - 1000)).toMatchObject({
      outcome: 'rate_limited',
      resetAt: NOW + 10 * 60_000,
    });
  });

  it('treats nothing remaining in X’s window as a rate limit', async () => {
    await observe('UserTweetsAndReplies', NOW, { remaining: 0 });
    expect(await context().pageRateLimit(NOW - 1000)).toMatchObject({ outcome: 'rate_limited' });
  });

  it('ignores a 429 X sent before the page load, and other operations', async () => {
    await observe('UserTweets', NOW - DAY, { status: 429 });
    await observe('SearchTimeline', NOW, { status: 429 });
    expect(await context().pageRateLimit(NOW - 1000)).toBeNull();
  });
});
