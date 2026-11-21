import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobContext, NeedsYou, Stop } from '../src/engine/context';
import { Limiter } from '../src/engine/limiter';
import { NotReady, type EnginePorts } from '../src/engine/ports';
import { createCleanupJob, Runner, type RunnerState } from '../src/engine/runner';
import type * as Timers from '../src/engine/timers';
import { db, itemKey, recordConsent, upsertAccount } from '../src/shared/db';
import type { ActorCommand, PageInfo } from '../src/shared/messages';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { DAY } from '../src/shared/time';
import type { CleanupFilter, Job } from '../src/shared/types';
import { ACCOUNT, page, stubLocks } from './support/engine';
import { resetDb } from './support/fixtures';

// X's notice of a limited or suspended account is read before anything the job does reaches X (#375, PLAYBOOK C3,
// C4). The content script answers from the start of a page load, while X's page is still the empty shell its web app
// draws the page into: a notice read then is missed, and the job used to go on to load pages and pace its first delete.
// X shows some notices on Home only, so a run reads a fresh Home first, even when the X window is on another page,
// loaded at the reading pace and counted like any page load (#377).

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
/** The person's profile, drawn, as the X window shows it when they left it there. */
const PROFILE = page({ path: '/me', url: 'https://x.com/me' });
/** X's Home as Xomoni loads it: the shell first, drawn a moment later. */
const HOME_SHELL = SHELL;
const HOME = 'https://x.com/home';

/** What reached X and what the job waited for, in order: `open`, `load <url>`, `<command>` and `wait <reason>`. */
let events: string[] = [];

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
  ctx.limiter = new Limiter(DEFAULT_SETTINGS, ACCOUNT, new AbortController().signal, (reason) => {
    waits.push(reason);
    events.push(`wait ${reason}`);
  });
  return { ctx, waits };
}

/**
 * Every request the job asked of X, in order: opening the X window (which loads Home), page loads, and commands other
 * than reading the page (`ping`).
 */
const jobRequests = () => events.filter((e) => !e.startsWith('wait '));

beforeEach(async () => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 22, 12, 0, 0));
  stubLocks();
  await resetDb();
  // Xomoni knows the account and its handle from earlier, and the person accepted the risks for it.
  await recordConsent(ACCOUNT);
  await upsertAccount({ id: ACCOUNT, handle: 'me' });
  events = [];
  // Unless a test says otherwise, the job opens the X window, which loads a fresh Home.
  xTab.current.mockResolvedValueOnce(null).mockResolvedValue(7);
  xTab.open.mockImplementation(async () => {
    events.push('open');
    return 7;
  });
  xTab.keepLoaded.mockResolvedValue();
  xTab.discarded.mockResolvedValue(false);
  xTab.waitReady.mockResolvedValue(SHELL);
  loads(drawn());
  xTab.send.mockImplementation(async (command) => {
    events.push(command.cmd);
    return { kind: 'tweets', count: 2, http: 200, unavailable: false };
  });
});

/** Makes every page load show `info` once it answers. */
function loads(info: PageInfo) {
  xTab.navigate.mockImplementation(async (url) => {
    events.push(`load ${url}`);
    return info;
  });
}

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
    expect(jobRequests()).toEqual(['open']);
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
    expect(jobRequests()).toEqual(['open']);
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
    expect(jobRequests()).toEqual(['open']);
  });

  it('never goes on from a page X doesn’t draw: after 30 s it is waited out, with nothing sent or loaded', async () => {
    const started = Date.now();
    xTab.ping.mockResolvedValue(SHELL);
    const { ctx } = context();

    const err = await ctx.connect().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NotReady);
    expect((err as NotReady).message).toBe('X’s page did not finish loading in the X window');
    expect(Date.now() - started).toBe(30_000);
    expect(jobRequests()).toEqual(['open']);
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

/** A cleanup of posts older than 3 am today. */
const CLEANUP_FILTER: CleanupFilter = {
  target: 'post',
  before: NIGHT,
  after: null,
  keepMinLikes: null,
  keepKeywords: [],
  keepIds: [],
  skipSelfReplies: false,
};

describe('a cleanup started while X shows its notice (#375)', () => {
  // Outside the active hours the job's first page load waits first: the path where it used to pace, then load X's
  // pages and pace its first delete, without ever reading Home again.
  it('stops on Home’s notice before it paces, loads a page or acts, even when its first step would wait', async () => {
    vi.setSystemTime(NIGHT);
    xTab.ping.mockResolvedValueOnce(SHELL).mockResolvedValue(drawn(LIMITED));
    const runner = new Runner(ports);
    const states: RunnerState['status'][] = [];
    runner.subscribe(() => states.push(runner.getState().status));
    const job = await createCleanupJob(ACCOUNT, 'Delete old posts', CLEANUP_FILTER, {
      sweep: true,
      deep: true,
      ghostLikes: false,
    });

    await runner.start(job.id);

    expect(jobRequests()).toEqual(['open']);
    expect(states).not.toContain('waiting');
    const done = (await db.jobs.get(job.id))!;
    expect(done).toMatchObject({ state: 'blocked', stats: { done: 0, skipped: 0, failed: 0, scanned: 0 } });
    expect(done.stateReason).toContain(`X shows a restriction on this account: “${LIMITED}”.`);
    expect((await db.risk.toArray()).map((e) => e.kind)).toEqual(['restricted']);
  });
});

describe('a run reads X’s Home first, even when the X window is on another page (#377)', () => {
  /** The X window is already open, on the person's profile, which shows no notice. */
  function onProfile() {
    xTab.current.mockReset().mockResolvedValue(7);
    xTab.waitReady.mockResolvedValue(PROFILE);
  }

  it.each([
    [LIMITED, 'restricted'],
    [SUSPENDED, 'suspended'],
  ])('loads Home at the reading pace and stops on “%s” there, with nothing else sent', async (notice, risk) => {
    onProfile();
    loads(HOME_SHELL);
    xTab.ping.mockResolvedValueOnce(HOME_SHELL).mockResolvedValue(drawn(notice));
    const { ctx } = context();

    const err = await ctx.connect().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Stop);
    expect(err).toMatchObject({ state: 'blocked', risk });
    expect((err as Stop).message).toContain(`X shows a restriction on this account: “${notice}”.`);
    // Waiting sends nothing to X: the pace, then Home, and nothing after it.
    expect(events).toEqual(['wait Pacing', `load ${HOME}`]);
  });

  it('counts the Home load against the read caps and X’s budget, like any page load', async () => {
    onProfile();
    const { ctx } = context();

    const info = await ctx.connect();

    expect(info).toMatchObject({ path: '/home', handle: 'me' });
    expect(jobRequests()).toEqual([`load ${HOME}`]);
    expect(ctx.limiter.usage('read')).toEqual({ hour: 1, day: 1 });
    expect(ctx.limiter.spent('userTimeline')).toBe(1);
    expect(await db.reads.count()).toBe(1);
  });

  it('waits for the read caps and one fifth of X’s budget before it loads Home, never past them', async () => {
    onProfile();
    // This account's page loads of the last few minutes already used its share.
    const now = Date.now();
    await db.reads.bulkAdd(
      Array.from({ length: 300 }, (_, i) => ({ accountId: ACCOUNT, budget: 'userTimeline', ts: now - 60_000 - i })),
    );
    const { ctx } = context();
    await ctx.limiter.init();

    await ctx.connect();

    expect(events.at(-1)).toBe(`load ${HOME}`);
    const waits = events.slice(0, -1);
    expect(waits.every((e) => e.startsWith('wait '))).toBe(true);
    expect(waits.some((e) => /cap of \d+ reached|share of X’s limit used/.test(e))).toBe(true);
  });

  it('outside the active hours, waits for them before it loads Home', async () => {
    vi.setSystemTime(NIGHT);
    onProfile();
    const { ctx } = context();

    await ctx.connect();

    expect(events[0]).toMatch(/^wait Outside active hours/);
    expect(events.at(-1)).toBe(`load ${HOME}`);
    expect(jobRequests()).toEqual([`load ${HOME}`]);
  });

  it('takes the X window it opened as Home: no second load, and the opening counts as one', async () => {
    xTab.waitReady.mockResolvedValue(drawn());
    const { ctx } = context();

    await ctx.connect();

    expect(jobRequests()).toEqual(['open']);
    expect(ctx.limiter.usage('read')).toEqual({ hour: 1, day: 1 });
    expect(ctx.limiter.spent('userTimeline')).toBe(1);
  });

  it('loads Home once a run: connecting again, as after the person logged in, loads nothing', async () => {
    onProfile();
    const { ctx } = context();

    await ctx.connect();
    await ctx.connect();

    expect(jobRequests()).toEqual([`load ${HOME}`]);
  });

  it('judges the page the X window shows first: its notice stops the job before Home is loaded', async () => {
    onProfile();
    xTab.waitReady.mockResolvedValue({ ...PROFILE, restriction: LIMITED });
    const { ctx } = context();

    await expect(ctx.connect()).rejects.toBeInstanceOf(Stop);
    expect(events).toEqual([]);
  });

  it('asks the person first on a page that needs them, without loading Home', async () => {
    onProfile();
    xTab.waitReady.mockResolvedValue({ ...PROFILE, loggedIn: false, viewerId: null, path: '/i/flow/login' });
    const { ctx } = context();

    const err = await ctx.connect().catch((e: unknown) => e);

    expect((err as NeedsYou).need).toBe('login');
    expect(events).toEqual([]);
  });

  it('waits out a Home X doesn’t draw, acting on nothing', async () => {
    onProfile();
    loads(HOME_SHELL);
    xTab.ping.mockResolvedValue(HOME_SHELL);
    const { ctx } = context();

    await expect(ctx.connect()).rejects.toBeInstanceOf(NotReady);
    expect(jobRequests()).toEqual([`load ${HOME}`]);
  });

  it('a cleanup started with the X window on the profile stops on Home’s notice, sending nothing else', async () => {
    // Two of the person's posts in the copy match; the card says so before the job touches X.
    for (const id of ['1001', '1002']) {
      await db.items.add({
        key: itemKey(ACCOUNT, 'post', id),
        accountId: ACCOUNT,
        kind: 'post',
        id,
        targetId: id,
        createdAt: NIGHT - 400 * DAY,
        likedAt: null,
        text: `post ${id}`,
        author: 'me',
        inReplyToId: null,
        selfReply: false,
        likes: 0,
        reposts: 0,
        replies: 0,
        sources: ['scan'],
        status: 'present',
        seenAt: NIGHT,
        statusAt: NIGHT,
        lastJobId: null,
      });
    }
    onProfile();
    loads(HOME_SHELL);
    xTab.ping.mockResolvedValueOnce(HOME_SHELL).mockResolvedValue(drawn(LIMITED));
    const runner = new Runner(ports);
    const job = await createCleanupJob(ACCOUNT, 'Delete old posts', CLEANUP_FILTER, {
      sweep: true,
      deep: true,
      ghostLikes: false,
    });

    await runner.start(job.id);

    expect(jobRequests()).toEqual([`load ${HOME}`]);
    const done = (await db.jobs.get(job.id))!;
    expect(done).toMatchObject({
      state: 'blocked',
      stats: { matched: 2, done: 0, skipped: 0, failed: 0, scanned: 0 },
    });
    expect(done.stateReason).toContain(`X shows a restriction on this account: “${LIMITED}”.`);
    expect((await db.risk.toArray()).map((e) => e.kind)).toEqual(['restricted']);
  });
});
