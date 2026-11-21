import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobContext, NeedsYou, Stop } from '../src/engine/context';
import { Limiter } from '../src/engine/limiter';
import { NotReady, type EnginePorts } from '../src/engine/ports';
import { createCleanupJob, Runner, type RunnerState } from '../src/engine/runner';
import type * as Timers from '../src/engine/timers';
import { db, recordConsent, upsertAccount } from '../src/shared/db';
import type { ActorCommand, PageInfo } from '../src/shared/messages';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import type { CleanupFilter, Job } from '../src/shared/types';
import { ACCOUNT, page, stubLocks } from './support/engine';
import { resetDb } from './support/fixtures';

// X's notice of a limited or suspended account is read before anything the job does reaches X (#375, PLAYBOOK C3,
// C4). The content script answers from the start of a page load, while X's page is still the empty shell its web app
// draws the page into: a notice read then is missed, and the job used to go on to load pages and pace its first delete.

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

const LIMITED = 'Your account is temporarily limited';
const SUSPENDED = 'Your account is suspended';
/** X's Home as the content script first sees it: signed in, but not drawn yet, so no notice can show. */
const SHELL = page({ rendered: false, handle: null });
/** X's Home once its web app drew it, with `notice` at the top of the main column. */
const drawn = (notice: string | null = null) => page({ restriction: notice });

/** Local 3 am: outside the default active hours (8–23), so the job's first page load would wait first. */
const NIGHT = new Date(2026, 10, 22, 3, 0, 0).getTime();

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

/** A job context for `ACCOUNT` on the mocked X tab, with the default settings and a fresh limiter. */
function context(): { ctx: JobContext; waits: string[] } {
  const job = {
    id: 'j',
    accountId: ACCOUNT,
    stats: { matched: 0, done: 0, skipped: 0, failed: 0, scanned: 0 },
  } as Job;
  const ctx = new JobContext(job, new AbortController().signal, { status: () => {}, attention: () => {} }, ports);
  const waits: string[] = [];
  ctx.settings = DEFAULT_SETTINGS;
  ctx.limiter = new Limiter(DEFAULT_SETTINGS, ACCOUNT, new AbortController().signal, (reason) => waits.push(reason));
  return { ctx, waits };
}

/** Every request the job asked of X: page loads and commands other than reading the page (`ping`). */
const jobRequests = () => [
  ...xTab.navigate.mock.calls.map(([url]) => `load ${url}`),
  ...xTab.send.mock.calls.map(([command]) => command.cmd),
];

beforeEach(async () => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 22, 12, 0, 0));
  stubLocks();
  await resetDb();
  // Xomoni knows the account and its handle from earlier, and the person accepted the risks for it.
  await recordConsent(ACCOUNT);
  await upsertAccount({ id: ACCOUNT, handle: 'me' });
  xTab.current.mockResolvedValue(7);
  xTab.open.mockResolvedValue(7);
  xTab.keepLoaded.mockResolvedValue();
  xTab.discarded.mockResolvedValue(false);
  xTab.waitReady.mockResolvedValue(SHELL);
  xTab.navigate.mockResolvedValue(drawn());
  xTab.send.mockResolvedValue({ kind: 'tweets', count: 2, http: 200, unavailable: false });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('connect: X’s notice is read once X has drawn the page (#375, PLAYBOOK C3, C4)', () => {
  it.each([
    [LIMITED, 'restricted'],
    [SUSPENDED, 'suspended'],
  ])('stops on “%s” drawn after the page first answered, before anything reaches X', async (notice, risk) => {
    xTab.ping.mockResolvedValueOnce(SHELL).mockResolvedValue(drawn(notice));
    const { ctx, waits } = context();

    const err = await ctx.connect().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Stop);
    expect(err).toMatchObject({ state: 'blocked', risk });
    expect((err as Stop).message).toContain(`X shows a restriction on this account: “${notice}”.`);
    expect(jobRequests()).toEqual([]);
    expect(waits).toEqual([]);
  });

  it('waits for X to draw the page, then goes on when it shows no notice', async () => {
    const started = Date.now();
    // Null: the page is reloading and doesn't answer; it is looked at again.
    xTab.ping.mockResolvedValueOnce(SHELL).mockResolvedValueOnce(null).mockResolvedValue(drawn());
    const { ctx } = context();

    const info = await ctx.connect();

    expect(info).toMatchObject({ rendered: true, restriction: null, handle: 'me' });
    expect(xTab.ping).toHaveBeenCalledTimes(3);
    expect(Date.now() - started).toBe(1500);
    expect(jobRequests()).toEqual([]);
  });

  it('reads a page X already drew at once, without waiting', async () => {
    xTab.waitReady.mockResolvedValue(drawn(LIMITED));
    const { ctx } = context();

    await expect(ctx.connect()).rejects.toBeInstanceOf(Stop);
    expect(xTab.ping).not.toHaveBeenCalled();
  });

  it('asks the person at once on a page that needs them, as before X draws it', async () => {
    xTab.waitReady.mockResolvedValue({ ...SHELL, loggedIn: false, viewerId: null, path: '/i/flow/login' });
    const { ctx } = context();

    const err = await ctx.connect().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NeedsYou);
    expect((err as NeedsYou).need).toBe('login');
    expect(xTab.ping).not.toHaveBeenCalled();
    expect(jobRequests()).toEqual([]);
  });

  it('never goes on from a page X doesn’t draw: after 30 s it is waited out, with nothing sent or loaded', async () => {
    const started = Date.now();
    xTab.ping.mockResolvedValue(SHELL);
    const { ctx } = context();

    const err = await ctx.connect().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NotReady);
    expect((err as NotReady).message).toBe('X’s page did not finish loading in the X window');
    expect(Date.now() - started).toBe(30_000);
    expect(jobRequests()).toEqual([]);
  });
});

describe('navigate: a notice X shows with a page’s posts stops the job before it scrolls or acts there (#375)', () => {
  it('reads the page again once its posts are shown, and stops on the notice', async () => {
    xTab.ping.mockResolvedValue(drawn(LIMITED));
    const { ctx } = context();

    const err = await ctx.navigate('https://x.com/me').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Stop);
    expect(err).toMatchObject({ state: 'blocked', risk: 'restricted' });
    // The page load and the wait for its posts, and nothing after them.
    expect(jobRequests()).toEqual(['load https://x.com/me', 'waitContent']);
  });

  it('returns the page’s posts when X shows no notice', async () => {
    xTab.ping.mockResolvedValue(drawn());
    const { ctx } = context();

    expect(await ctx.navigate('https://x.com/me')).toMatchObject({ kind: 'tweets', count: 2 });
    expect(xTab.ping).toHaveBeenCalledTimes(1);
  });
});

describe('a cleanup started while X shows its notice (#375)', () => {
  const FILTER: CleanupFilter = {
    target: 'post',
    before: NIGHT,
    after: null,
    keepMinLikes: null,
    keepKeywords: [],
    keepIds: [],
    skipSelfReplies: false,
  };

  // Outside the active hours the job's first page load waits first: the path where it used to pace, then load X's
  // pages and pace its first delete, without ever reading Home again.
  it('stops on Home’s notice before it paces, loads a page or acts, even when its first step would wait', async () => {
    vi.setSystemTime(NIGHT);
    xTab.ping.mockResolvedValueOnce(SHELL).mockResolvedValue(drawn(LIMITED));
    const runner = new Runner(ports);
    const states: RunnerState['status'][] = [];
    runner.subscribe(() => states.push(runner.getState().status));
    const job = await createCleanupJob(ACCOUNT, 'Delete old posts', FILTER, {
      sweep: true,
      deep: true,
      ghostLikes: false,
    });

    await runner.start(job.id);

    expect(jobRequests()).toEqual([]);
    expect(states).not.toContain('waiting');
    const done = (await db.jobs.get(job.id))!;
    expect(done).toMatchObject({ state: 'blocked', stats: { done: 0, skipped: 0, failed: 0, scanned: 0 } });
    expect(done.stateReason).toContain(`X shows a restriction on this account: “${LIMITED}”.`);
    expect((await db.risk.toArray()).map((e) => e.kind)).toEqual(['restricted']);
  });
});
