import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobContext, NeedsYou, Stop } from '../src/engine/context';
import { Limiter } from '../src/engine/limiter';
import { chromePorts } from '../src/engine/platform';
import type * as Timers from '../src/engine/timers';
import type * as WorkerTabModule from '../src/engine/worker-tab';
import { needMessage } from '../src/shared/attention';
import { db } from '../src/shared/db';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import type { Job } from '../src/shared/types';
import { ACCOUNT, page } from './support/engine';

// What a job does when X needs the person (#20, #200, PLAYBOOK C2, D1, #345): the hour it waits for them at most, and
// what it does when X's answer to an action, rather than X's page, says so. The waiting itself, its five seconds in a
// row and the rest after an X check are in runner.test.ts and hidden-worker.test.ts.

const { worker, presence } = vi.hoisted(() => ({
  worker: { ping: vi.fn(), send: vi.fn(), navigate: vi.fn(), focus: vi.fn() },
  presence: { away: vi.fn(), keepDisplayOn: vi.fn() },
}));

// The real sleep runs on a Web Worker, which tests don't have; the worker tab needs Chrome.
vi.mock('../src/engine/timers', async (importOriginal) => ({
  ...(await importOriginal<typeof Timers>()),
  sleep: async () => {},
}));
vi.mock('../src/engine/worker-tab', async (importOriginal) => ({
  ...(await importOriginal<typeof WorkerTabModule>()),
  workerTab: worker,
}));
vi.mock('../src/engine/presence', () => ({ presence }));

const MINUTE = 60_000;

function setup() {
  const job = { id: 'j', accountId: ACCOUNT, stats: { matched: 0, done: 0, skipped: 0, failed: 0, scanned: 0 } } as Job;
  const ctx = new JobContext(job, new AbortController().signal, { status: () => {}, attention: () => {} }, chromePorts);
  ctx.settings = DEFAULT_SETTINGS;
  ctx.limiter = new Limiter(DEFAULT_SETTINGS, ACCOUNT, new AbortController().signal, () => {});
  vi.spyOn(ctx.limiter, 'cooldown').mockResolvedValue();
  return { ctx, job };
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

/** A post of the person's that a job was about to act on. */
const POST = { key: `${ACCOUNT}:post:9000000000000000101`, id: '9000000000000000101' };

beforeEach(async () => {
  await Promise.all([db.logs.clear(), db.jobs.clear(), db.risk.clear()]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('waitForYou: what X asks of the person (#20, #200)', () => {
  it('waits an hour for X’s login, not a day, then pauses the job', async () => {
    const { ctx } = setup();
    pingsTaking(5 * MINUTE, page({ loggedIn: false, viewerId: null }));
    const started = Date.now();

    const err = await ctx.waitForYou(new NeedsYou('login', needMessage('login', 'me'))).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Stop);
    expect((err as Stop).state).toBe('paused');
    expect((err as Stop).message).toBe(
      'Waited an hour for you. Log in to X as @me in the X window (including 2FA). Then resume the job.',
    );
    const waited = Date.now() - started;
    expect(waited).toBeGreaterThan(59 * MINUTE);
    expect(waited).toBeLessThan(2 * 60 * MINUTE);
  });

  it('loads X’s Home first when X’s answer to an action asked for the person, so X shows its prompt', async () => {
    const { ctx } = setup();
    worker.navigate.mockResolvedValue(page());
    pingsTaking(3000, page());

    await ctx.waitForYou(new NeedsYou('login', needMessage('login', 'me'), true));

    expect(worker.navigate).toHaveBeenCalledWith('https://x.com/home', expect.anything());
  });

  it('leaves the X window where it is when its page itself shows what X asks', async () => {
    const { ctx } = setup();
    pingsTaking(3000, page());

    await ctx.waitForYou(new NeedsYou('login', needMessage('login', 'me')));

    expect(worker.navigate).not.toHaveBeenCalled();
  });
});

describe('settle: X’s answer to an action asks for the person (#20, PLAYBOOK D1, C2)', () => {
  it('puts the post back when X answers that the person is logged out, never failed, and waits for a login', async () => {
    const { ctx, job } = setup();

    const err = await ctx
      .settle('delete', POST, { outcome: 'logged_out', message: 'X code 89' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NeedsYou);
    expect((err as NeedsYou).need).toBe('login');
    expect((err as NeedsYou).fromAction).toBe(true);
    expect(job.stats).toMatchObject({ done: 0, skipped: 0, failed: 0 });
    expect(await messages()).toContain('Logged out — X code 89');
    expect(await db.risk.count()).toBe(0);
  });

  it('counts a lock on the risk ladder, then waits for the person to unlock the account', async () => {
    const { ctx, job } = setup();

    const err = await ctx.settle('delete', POST, { outcome: 'locked', message: 'X code 326' }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NeedsYou);
    expect((err as NeedsYou).need).toBe('verify');
    expect((err as NeedsYou).fromAction).toBe(true);
    expect(job.stats).toMatchObject({ done: 0, skipped: 0, failed: 0 });
    expect(await messages()).toContain('Account locked — X code 326');
    expect((await db.risk.toArray()).map((event) => event.kind)).toEqual(['lock']);
  });
});
