import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Interrupted, JobContext, Stop, backoffMinutes, interruptionOf } from '../src/engine/context';
import { Limiter } from '../src/engine/limiter';
import type * as Timers from '../src/engine/timers';
import type * as WorkerTabModule from '../src/engine/worker-tab';
import { db } from '../src/shared/db';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import type { Job } from '../src/shared/types';

const { discarded, worker } = vi.hoisted(() => ({
  discarded: vi.fn(async () => false),
  worker: { navigate: vi.fn(), send: vi.fn(), ping: vi.fn() },
}));

// The real sleep runs on a Web Worker, which tests don't have; the worker tab needs Chrome.
vi.mock('../src/engine/timers', async (importOriginal) => ({
  ...(await importOriginal<typeof Timers>()),
  sleep: async () => {},
}));
vi.mock('../src/engine/worker-tab', async (importOriginal) => ({
  ...(await importOriginal<typeof WorkerTabModule>()),
  workerTab: { discarded: () => discarded(), ...worker },
}));

const ACCOUNT = 'acct-1';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function setup() {
  const job = { id: 'j', accountId: ACCOUNT, stats: { matched: 0, done: 0, skipped: 0, failed: 0, scanned: 0 } } as Job;
  const ctx = new JobContext(job, new AbortController().signal, { status: () => {}, attention: () => {} });
  ctx.settings = DEFAULT_SETTINGS;
  ctx.limiter = new Limiter(DEFAULT_SETTINGS, ACCOUNT, new AbortController().signal, () => {});
  const cooldown = vi.spyOn(ctx.limiter, 'cooldown').mockResolvedValue();
  /** Minutes until the end of the `n`th wait. */
  const waited = (n: number) => (cooldown.mock.calls[n]![0] - Date.now()) / MINUTE;
  return { ctx, job, cooldown, waited };
}

beforeEach(async () => {
  await db.logs.clear();
  discarded.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('interruptionOf: what an HTTP status means for the run (#23)', () => {
  it.each([
    [503, true, 'outage'],
    [500, true, 'outage'],
    [0, true, 'offline'],
    [200, false, 'offline'],
    [400, true, null],
    [404, true, null],
    [null, true, null],
    [undefined, true, null],
  ] as const)('HTTP %s, online %s → %s', (http, isOnline, kind) => {
    expect(interruptionOf(http, isOnline)).toBe(kind);
  });
});

describe('backoffMinutes', () => {
  it('doubles from 1 minute up to 30', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(backoffMinutes)).toEqual([1, 2, 4, 8, 16, 30, 30, 30]);
  });
});

describe('settle: X outages and dropped connections are not failed posts (PLAYBOOK F6)', () => {
  const item = { key: 'k', id: '1' };

  it('turns an X server error into an interruption without counting a failure', async () => {
    const { ctx, job } = setup();
    const err = await ctx.settle('delete', item, { outcome: 'failed', http: 503 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Interrupted);
    expect((err as Interrupted).kind).toBe('outage');
    expect(job.stats.failed).toBe(0);
    // Still logged with its outcome, so later runs count the request against X's quota.
    const [row] = await db.logs.toArray();
    expect(row).toMatchObject({ action: 'delete', outcome: 'failed', level: 'warn' });
  });

  it('treats a request that got no answer as a dropped connection', async () => {
    const { ctx } = setup();
    const err = await ctx.settle('unlike', item, { outcome: 'failed', http: 0 }).catch((e: unknown) => e);
    expect((err as Interrupted).kind).toBe('offline');
  });

  it('still counts other failures, which stop the job after two in a row', async () => {
    const { ctx, job } = setup();
    expect(await ctx.settle('delete', item, { outcome: 'failed', http: 400 })).toBe(true);
    expect(job.stats.failed).toBe(1);
    await expect(ctx.settle('delete', item, { outcome: 'failed', http: 400 })).rejects.toBeInstanceOf(Stop);
  });
});

describe('navigate: a failed page says nothing about the posts (PLAYBOOK F6)', () => {
  const page = {
    bootId: 'b',
    url: 'https://x.com/me/status/1',
    path: '/me/status/1',
    viewerId: ACCOUNT,
    handle: 'me',
    loggedIn: true,
    locked: false,
    challenge: false,
    restriction: null,
    lang: 'en',
    hidden: false,
  };

  beforeEach(() => {
    worker.navigate.mockResolvedValue(page);
    worker.ping.mockResolvedValue(page);
  });

  it('turns X’s error page after a 5xx into an interruption, so the post is not marked gone', async () => {
    worker.send.mockResolvedValue({ kind: 'error', count: 0, http: 503 });
    const err = await setup()
      .ctx.navigate(page.url)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Interrupted);
    expect((err as Interrupted).kind).toBe('outage');
  });

  it('returns X’s error page as it is when X answered normally', async () => {
    worker.send.mockResolvedValue({ kind: 'error', count: 0, http: 200 });
    expect(await setup().ctx.navigate(page.url)).toMatchObject({ kind: 'error' });
  });

  it('does not load a page while the browser is offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    worker.navigate.mockClear();
    const err = await setup()
      .ctx.navigate(page.url)
      .catch((e: unknown) => e);
    expect((err as Interrupted).kind).toBe('offline');
    expect(worker.navigate).not.toHaveBeenCalled();
  });
});

describe('waitOut (PLAYBOOK F5, F6)', () => {
  const outage = () => new Interrupted('outage', 'X answered HTTP 503');

  it('backs off 1, 2, 4 minutes while nothing moves', async () => {
    const { ctx, waited } = setup();
    for (let i = 0; i < 3; i++) await ctx.waitOut(outage());
    [1, 2, 4].forEach((minutes, n) => {
      expect(waited(n)).toBeGreaterThanOrEqual(minutes - 0.01);
      expect(waited(n)).toBeLessThanOrEqual(minutes * 1.2 + 0.01);
    });
  });

  it('starts again from 1 minute after progress', async () => {
    const { ctx, job, waited } = setup();
    await ctx.waitOut(outage());
    await ctx.waitOut(outage());
    job.stats.done++;
    await ctx.waitOut(outage());
    expect(waited(2)).toBeLessThanOrEqual(1.2 + 0.01);
  });

  it('pauses the job after three hours without progress', async () => {
    const { ctx } = setup();
    const start = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(start);
    await ctx.waitOut(outage());
    now.mockReturnValue(start + 3 * HOUR);
    const err = await ctx.waitOut(outage()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Stop);
    expect((err as Stop).state).toBe('paused');
  });

  it('waits for the browser to come back online, checking every 10 s', async () => {
    const network = { onLine: false };
    vi.stubGlobal('navigator', network);
    const { ctx, cooldown } = setup();
    cooldown.mockImplementation(async () => {
      if (cooldown.mock.calls.length === 2) network.onLine = true;
    });
    await ctx.waitOut(new Interrupted('offline', 'The internet connection dropped'));
    const reasons = cooldown.mock.calls.map((call) => call[1]);
    expect(reasons).toEqual([
      'Waiting for the internet connection',
      'Waiting for the internet connection',
      'Back online — continuing shortly',
    ]);
  });

  it('reloads a tab Chrome unloaded right away instead of backing off', async () => {
    discarded.mockResolvedValueOnce(true);
    const { ctx, cooldown } = setup();
    await ctx.waitOut(outage());
    expect(cooldown).not.toHaveBeenCalled();
    const logs = (await db.logs.toArray()).map((row) => row.message);
    expect(logs).toContain('Chrome unloaded the X tab to save memory; reloading it');
  });
});
