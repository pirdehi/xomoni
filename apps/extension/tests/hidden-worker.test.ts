import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobContext, NeedsYou, Stop } from '../src/engine/context';
import { Limiter } from '../src/engine/limiter';
import { chromePorts } from '../src/engine/platform';
import type * as Timers from '../src/engine/timers';
import type * as WorkerTabModule from '../src/engine/worker-tab';
import { NEED_TITLE, needMessage, pageNeed } from '../src/shared/attention';
import { db } from '../src/shared/db';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import type { Job } from '../src/shared/types';
import { ACCOUNT, page } from './support/engine';

const { worker } = vi.hoisted(() => ({ worker: { ping: vi.fn(), send: vi.fn(), navigate: vi.fn() } }));

// The real sleep runs on a Web Worker, which tests don't have; the worker tab needs Chrome.
vi.mock('../src/engine/timers', async (importOriginal) => ({
  ...(await importOriginal<typeof Timers>()),
  sleep: async () => {},
}));
vi.mock('../src/engine/worker-tab', async (importOriginal) => ({
  ...(await importOriginal<typeof WorkerTabModule>()),
  workerTab: worker,
}));

const MINUTE = 60_000;

function setup() {
  const job = { id: 'j', accountId: ACCOUNT, stats: { matched: 0, done: 0, skipped: 0, failed: 0, scanned: 0 } } as Job;
  const attention = vi.fn();
  const ctx = new JobContext(job, new AbortController().signal, { status: () => {}, attention }, chromePorts);
  ctx.settings = DEFAULT_SETTINGS;
  ctx.limiter = new Limiter(DEFAULT_SETTINGS, ACCOUNT, new AbortController().signal, () => {});
  const cooldown = vi.spyOn(ctx.limiter, 'cooldown').mockResolvedValue();
  return { ctx, job, attention, cooldown };
}

/** Each `ping` moves the clock on by `step`, so waits that check the time end without real waiting. */
function pingsTaking(step: number, ...pages: ReturnType<typeof page>[]) {
  vi.useFakeTimers({ toFake: ['Date'] });
  let n = 0;
  worker.ping.mockImplementation(async () => {
    vi.setSystemTime(Date.now() + step);
    return pages[Math.min(n++, pages.length - 1)];
  });
}

const messages = async () => (await db.logs.toArray()).map((l) => l.message);

beforeEach(async () => {
  await Promise.all([db.logs.clear(), db.jobs.clear()]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('pageNeed: a hidden X window needs the person (#118, PLAYBOOK F5)', () => {
  it('asks for the window on screen when everything else is fine', () => {
    expect(pageNeed(page({ hidden: true }), ACCOUNT)).toBe('hidden');
    expect(pageNeed(page(), ACCOUNT)).toBeNull();
  });

  it('puts login, X checks and the account first, and a hidden window before a pop-up', () => {
    expect(pageNeed(page({ hidden: true, loggedIn: false, viewerId: null }), ACCOUNT)).toBe('login');
    expect(pageNeed(page({ hidden: true, challenge: true }), ACCOUNT)).toBe('verify');
    expect(pageNeed(page({ hidden: true, viewerId: 'someone-else' }), ACCOUNT)).toBe('account');
    expect(pageNeed(page({ hidden: true, obstructed: true }), ACCOUNT)).toBe('hidden');
  });

  it('says what to do and why', () => {
    expect(needMessage('hidden', 'me')).toMatch(/Chrome pauses pages it doesn’t show/);
    expect(needMessage('hidden', 'me')).toMatch(/not minimized, not fully covered/);
    expect(NEED_TITLE.hidden).toBe('Show the Xomoni window');
  });
});

describe('verifyPage: never acts in a hidden window (#118)', () => {
  it('waits for the person before an action', async () => {
    worker.ping.mockResolvedValue(page({ hidden: true }));
    const err = await setup()
      .ctx.verifyPage()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NeedsYou);
    expect((err as NeedsYou).need).toBe('hidden');
  });

  it('does not try to close a pop-up it cannot see close', async () => {
    worker.ping.mockResolvedValue(page({ hidden: true, obstructed: true }));
    const err = await setup()
      .ctx.verifyPage()
      .catch((e: unknown) => e);
    expect((err as NeedsYou).need).toBe('hidden');
    expect(worker.send).not.toHaveBeenCalled();
  });
});

describe('settle: a failure in a hidden window is not the post’s (#118)', () => {
  const item = { key: 'k', id: '1' };

  it('waits for the person without counting a failure', async () => {
    const { ctx, job } = setup();
    worker.ping.mockResolvedValue(page({ hidden: true }));
    const result = { outcome: 'failed', message: 'Another menu is open on the X page' } as const;
    const err = await ctx.settle('delete', item, result).catch((e: unknown) => e);
    expect((err as NeedsYou).need).toBe('hidden');
    expect(job.stats.failed).toBe(0);
    expect(await messages()).toEqual([
      'Not counted as failed: the Xomoni window was hidden — Another menu is open on the X page',
    ]);
  });

  it('still counts a failure in a window on screen', async () => {
    const { ctx, job } = setup();
    worker.ping.mockResolvedValue(page());
    expect(await ctx.settle('delete', item, { outcome: 'failed', message: 'No "Delete" option' })).toBe(true);
    expect(job.stats.failed).toBe(1);
  });
});

describe('waitForYou: a hidden window (#118)', () => {
  const hidden = () => new NeedsYou('hidden', needMessage('hidden', 'me'));

  it('continues by itself once the window has been on screen for 5 seconds', async () => {
    const { ctx, job, attention, cooldown } = setup();
    pingsTaking(1500, page({ hidden: true }), page({ hidden: true }), page());
    const request = hidden();
    await ctx.waitForYou(request);
    expect(attention.mock.calls).toEqual([[request], [null]]);
    expect(job.state).toBe('running');
    expect(cooldown).toHaveBeenCalledOnce();
    expect(await messages()).toContain('X is ready again — continuing');
  });

  it('is never “X keeps asking for the same thing”, however often the window is covered', async () => {
    const { ctx } = setup();
    pingsTaking(3000, page());
    for (let i = 0; i < 6; i++) await ctx.waitForYou(hidden());
  });

  it('still gives up on a real X request that keeps coming back', async () => {
    const { ctx } = setup();
    pingsTaking(3000, page());
    const login = () => new NeedsYou('login', needMessage('login', 'me'));
    for (let i = 0; i < 3; i++) await ctx.waitForYou(login());
    await expect(ctx.waitForYou(login())).rejects.toThrow(/X keeps asking for the same thing/);
  });

  it('pauses the job after an hour with the window still hidden', async () => {
    const { ctx } = setup();
    pingsTaking(20 * MINUTE, page({ hidden: true }));
    const err = await ctx.waitForYou(hidden()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Stop);
    expect((err as Stop).state).toBe('paused');
    expect((err as Stop).message).toMatch(/^Waited an hour for you\. The Xomoni window is hidden/);
  });
});
