import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobContext, KEPT_RATE_LIMITING, MAX_QUOTA_RETRIES, Stop, loadPage } from '../src/engine/context';
import { Limiter } from '../src/engine/limiter';
import type { EnginePorts } from '../src/engine/ports';
import { Runner, createScanJob } from '../src/engine/runner';
import { runScan } from '../src/engine/scan';
import { runDueChecks } from '../src/engine/samples';
import type * as Timers from '../src/engine/timers';
import { db, recordConsent, upsertAccount } from '../src/shared/db';
import type { ActionResult, ActorCommand, ContentState, PageInfo } from '../src/shared/messages';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import type { Job } from '../src/shared/types';
import { ACCOUNT, page, stubLocks } from './support/engine';
import { resetDb } from './support/fixtures';

// X's 429 on a read is X's first warning, as on any other job (#392, PLAYBOOK A2, A5, ADR-0013): a page or a scroll
// X refuses for its quota goes on the risk ladder, the job waits for X's reset and loads the same page again, and
// after 3 such waits it pauses. A read used to pass over the refused page, go on to its next pages and end Completed,
// with no warning from X recorded.

// The real sleep runs on a Web Worker, which tests don't have; here it moves the fake clock forward instead.
vi.mock('../src/engine/timers', async (importOriginal) => {
  const actual = await importOriginal<typeof Timers>();
  return {
    ...actual,
    sleep: async (ms: number, signal?: AbortSignal) => {
      if (signal?.aborted) throw new actual.Aborted();
      vi.setSystemTime(Date.now() + Math.max(0, ms));
    },
  };
});

/** What `pageRateLimit` gives for a page X refused for its quota. */
const LIMIT: ActionResult = {
  outcome: 'rate_limited',
  resetAt: null,
  message: 'Profile timeline: X’s rate limit reached',
};

/** One page load as the fake X answers it: what the page shows, and whether X refused it for its quota. */
interface Load {
  kind: ContentState['kind'];
  limited?: boolean;
}

/** Just enough of a JobContext for `runScan` and `loadPage`: each page load answers with the next of `loads`. */
function fakeContext(scan: Job['scan'], loads: Load[]) {
  const queue = [...loads];
  let current: Load = { kind: 'empty' };
  const job = {
    id: 'j',
    accountId: ACCOUNT,
    kind: 'scan',
    scan,
    phase: '',
    stats: { matched: 0, done: 0, skipped: 0, failed: 0, scanned: 0 },
  } as unknown as Job;
  return {
    job,
    handle: 'me',
    navigate: vi.fn(async (_url: string) => {
      current = queue.shift() ?? { kind: 'empty' };
      return { kind: current.kind, count: current.kind === 'tweets' ? 3 : 0, http: current.limited ? 429 : 200 };
    }),
    pageRateLimit: vi.fn(async (_since: number) => (current.limited ? LIMIT : null)),
    settle: vi.fn(async () => false),
    scroll: vi.fn(async () => ({ added: 0, total: 3, atEnd: true, lastTime: null })),
    setPhase: vi.fn(async (phase: string) => {
      job.phase = phase;
    }),
    save: vi.fn(async () => {}),
    status: vi.fn(),
  };
}
const asContext = (ctx: ReturnType<typeof fakeContext>) => ctx as unknown as JobContext;
const loaded = (ctx: ReturnType<typeof fakeContext>) => ctx.navigate.mock.calls.map((call) => call[0]);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 22, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('loadPage: a page X refuses for its quota (#392)', () => {
  it('goes through settle, then loads the same page again', async () => {
    const ctx = fakeContext('posts', [{ kind: 'error', limited: true }, { kind: 'tweets' }]);
    expect(await loadPage(asContext(ctx), 'https://x.com/me')).toMatchObject({ kind: 'tweets' });
    expect(loaded(ctx)).toEqual(['https://x.com/me', 'https://x.com/me']);
    expect(ctx.settle).toHaveBeenCalledExactlyOnceWith('read', null, LIMIT);
  });

  it('pauses the job once X refused the page after 3 waits for its reset', async () => {
    const ctx = fakeContext(
      'posts',
      Array.from({ length: 6 }, () => ({ kind: 'error' as const, limited: true })),
    );
    const err = await loadPage(asContext(ctx), 'https://x.com/me').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Stop);
    expect(err).toMatchObject({ state: 'paused', message: KEPT_RATE_LIMITING });
    expect(ctx.navigate).toHaveBeenCalledTimes(MAX_QUOTA_RETRIES + 1);
    expect(ctx.settle).toHaveBeenCalledTimes(MAX_QUOTA_RETRIES);
  });

  it('returns a page that failed for another reason as it is, with nothing on the risk ladder', async () => {
    const ctx = fakeContext('posts', [{ kind: 'timeout' }]);
    expect(await loadPage(asContext(ctx), 'https://x.com/me')).toMatchObject({ kind: 'timeout' });
    expect(ctx.navigate).toHaveBeenCalledOnce();
    expect(ctx.settle).not.toHaveBeenCalled();
  });

  it('never asks about X’s quota for a page that shows posts, or X’s empty state', async () => {
    for (const kind of ['tweets', 'empty'] as const) {
      const ctx = fakeContext('posts', [{ kind }]);
      await loadPage(asContext(ctx), 'https://x.com/me');
      expect(ctx.pageRateLimit).not.toHaveBeenCalled();
    }
  });
});

describe('runScan: a read waits out X’s refusal instead of passing the page over (#392)', () => {
  it('reads the refused page once X’s window has reset, and only then goes on to the next', async () => {
    const ctx = fakeContext('complete', [{ kind: 'error', limited: true }, { kind: 'tweets' }, { kind: 'tweets' }]);
    await runScan(asContext(ctx));
    const [first, second, third] = loaded(ctx);
    expect(first).toBe('https://x.com/me');
    expect(second).toBe(first);
    expect(third).toBe('https://x.com/me/with_replies');
    expect(ctx.settle).toHaveBeenCalledExactlyOnceWith('read', null, LIMIT);
    expect(ctx.job.stats.scanned).toBeGreaterThan(0);
  });

  it('pauses when X keeps refusing, without reading any further page', async () => {
    const ctx = fakeContext(
      'complete',
      Array.from({ length: 9 }, () => ({ kind: 'error' as const, limited: true })),
    );
    const err = await runScan(asContext(ctx)).catch((e: unknown) => e);
    expect(err).toMatchObject({ state: 'paused', message: KEPT_RATE_LIMITING });
    expect(new Set(loaded(ctx))).toEqual(new Set(['https://x.com/me']));
  });

  it('still passes over a page that shows no posts for another reason, as before', async () => {
    const ctx = fakeContext('likes', [{ kind: 'timeout' }]);
    await runScan(asContext(ctx));
    expect(loaded(ctx)).toEqual(['https://x.com/me/likes']);
    expect(ctx.settle).not.toHaveBeenCalled();
  });
});

describe('a sample check on a post page X refuses (#392)', () => {
  it('goes on the risk ladder, stays queued, and is counted neither as applied nor as unclear', async () => {
    await resetDb();
    await db.checks.add({
      accountId: ACCOUNT,
      jobId: 'j',
      action: 'delete',
      postId: '1',
      at: Date.now() - 20 * 60_000,
      dueAt: Date.now() - 60_000,
    });
    const ctx = {
      ...fakeContext('posts', [{ kind: 'error', limited: true }]),
      checkpoint: vi.fn(),
      log: vi.fn(async () => 0),
      samples: { applied: 0, notApplied: 0, unclear: 0 },
    };
    await runDueChecks(asContext(ctx));
    expect(ctx.settle).toHaveBeenCalledExactlyOnceWith('read', null, LIMIT);
    expect(ctx.samples).toEqual({ applied: 0, notApplied: 0, unclear: 0 });
    expect(await db.checks.count()).toBe(1);
  });
});

// A whole run, on the real JobContext and Limiter, with the X window played by fakes (the engine's ports, #11).

const xTab = {
  current: vi.fn<() => Promise<number | null>>(),
  open: vi.fn<() => Promise<number>>(),
  focus: vi.fn<() => Promise<void>>(),
  keepLoaded: vi.fn<() => Promise<void>>(),
  discarded: vi.fn<() => Promise<boolean>>(),
  waitReady: vi.fn<(signal: AbortSignal, notBootId?: string) => Promise<PageInfo>>(),
  navigate: vi.fn<(url: string, signal: AbortSignal) => Promise<PageInfo>>(),
  ping: vi.fn<() => Promise<PageInfo | null>>(),
  send: vi.fn<(command: ActorCommand) => Promise<unknown>>(),
};
const ports: EnginePorts = {
  xTab: xTab as unknown as EnginePorts['xTab'],
  notifier: { notify: vi.fn(() => Promise.resolve()), clear: vi.fn() },
  presence: { away: vi.fn(() => Promise.resolve(false)), keepDisplayOn: vi.fn() },
};

/** X's answer to the profile's timeline, as the interceptor stores it: a 429 with X's reset 15 minutes away. */
const refuseTimeline = () =>
  db.limits.put({
    key: `${ACCOUNT}:UserTweets`,
    accountId: ACCOUNT,
    op: 'UserTweets',
    limit: 150,
    remaining: 0,
    reset: Date.now() + 15 * 60_000,
    status: 429,
    at: Date.now(),
  });

describe('a read X refuses with a 429, run to its end (#392)', () => {
  // Noon: within the default active hours, so the job's waits are its pace and X's reset only.
  beforeEach(async () => {
    vi.resetAllMocks();
    stubLocks();
    await resetDb();
    await recordConsent(ACCOUNT);
    await upsertAccount({ id: ACCOUNT, handle: 'me' });
    // The X window is open on Home; every page Xomoni loads answers, drawn, with no notice.
    xTab.current.mockResolvedValue(7);
    xTab.keepLoaded.mockResolvedValue();
    xTab.discarded.mockResolvedValue(false);
    xTab.waitReady.mockResolvedValue(page());
    xTab.ping.mockResolvedValue(page());
    xTab.navigate.mockImplementation(async (url) => page({ url, path: new URL(url).pathname }));
    // X refuses the profile's posts every time: its page shows X's error.
    xTab.send.mockImplementation(async (command) => {
      if (command.cmd === 'waitContent') {
        await refuseTimeline();
        return { kind: 'error', count: 0, http: 429, unavailable: false };
      }
      if (command.cmd === 'clearPage') return { cleared: false };
      throw new Error(`unexpected command ${command.cmd}`);
    });
  });

  it('puts the account on the risk ladder and never ends Completed or Healthy', async () => {
    const job = await createScanJob(ACCOUNT, 'Read: Posts', 'posts');

    await new Runner(ports).start(job.id);

    const done = (await db.jobs.get(job.id))!;
    expect(done.state).not.toBe('completed');
    // The first 429 is Caution and a wait for X's reset; the second within the hour is Retreat, which stops the job.
    expect((await db.risk.toArray()).map((e) => e.kind)).toEqual(['rate_limited', 'rate_limited']);
    expect(done.state).toBe('blocked');
    expect(done.stateReason).toContain('Risk level 2 (Retreat)');
    expect(done.health?.summary).not.toMatch(/^Healthy/);
    const logs = (await db.logs.toArray()).map((l) => l.message);
    expect(logs.some((m) => m.startsWith('X rate limit hit; resuming at '))).toBe(true);
  });
});

describe('JobContext.scroll: a scroll X refuses for its quota (#392)', () => {
  it('goes through settle like a refused page', async () => {
    const ctx = new JobContext(
      { id: 'j', accountId: ACCOUNT, stats: { matched: 0, done: 0, skipped: 0, failed: 0, scanned: 0 } } as Job,
      new AbortController().signal,
      { status: () => {}, attention: () => {} },
      ports,
    );
    ctx.settings = DEFAULT_SETTINGS;
    ctx.limiter = new Limiter(DEFAULT_SETTINGS, ACCOUNT, new AbortController().signal, () => {});
    vi.spyOn(ctx.limiter, 'before').mockResolvedValue();
    const settle = vi.spyOn(ctx, 'settle').mockResolvedValue(false);
    xTab.send.mockImplementation(async (command) => {
      if (command.cmd !== 'scroll') throw new Error(`unexpected command ${command.cmd}`);
      await refuseTimeline();
      return { added: 0, total: 3, atEnd: false, lastTime: null };
    });

    await ctx.scroll();

    expect(settle).toHaveBeenCalledExactlyOnceWith('read', null, expect.objectContaining({ outcome: 'rate_limited' }));
  });

  it('asks nothing about X’s quota when the scroll showed new posts', async () => {
    const ctx = new JobContext(
      { id: 'j', accountId: ACCOUNT, stats: { matched: 0, done: 0, skipped: 0, failed: 0, scanned: 0 } } as Job,
      new AbortController().signal,
      { status: () => {}, attention: () => {} },
      ports,
    );
    ctx.settings = DEFAULT_SETTINGS;
    ctx.limiter = new Limiter(DEFAULT_SETTINGS, ACCOUNT, new AbortController().signal, () => {});
    vi.spyOn(ctx.limiter, 'before').mockResolvedValue();
    const rateLimit = vi.spyOn(ctx, 'pageRateLimit');
    xTab.send.mockResolvedValue({ added: 4, total: 7, atEnd: false, lastTime: null });

    await ctx.scroll();

    expect(rateLimit).not.toHaveBeenCalled();
  });
});
