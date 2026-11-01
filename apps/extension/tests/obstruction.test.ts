import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobContext, NeedsYou, Stop } from '../src/engine/context';
import { Limiter } from '../src/engine/limiter';
import type * as Timers from '../src/engine/timers';
import type * as WorkerTabModule from '../src/engine/worker-tab';
import { db } from '../src/shared/db';
import type { PageInfo } from '../src/shared/messages';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import type { Job } from '../src/shared/types';

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

const ACCOUNT = '1000';
const PAGE: PageInfo = {
  bootId: 'b',
  url: 'https://x.com/home',
  path: '/home',
  viewerId: ACCOUNT,
  handle: 'me',
  loggedIn: true,
  locked: false,
  challenge: false,
  restriction: null,
  obstructed: false,
  lang: 'en',
  hidden: false,
};

function context() {
  const job = { id: 'j', accountId: ACCOUNT, stats: { matched: 0, done: 0, skipped: 0, failed: 0, scanned: 0 } } as Job;
  const ctx = new JobContext(job, new AbortController().signal, { status: () => {}, attention: () => {} });
  ctx.settings = DEFAULT_SETTINGS;
  ctx.limiter = new Limiter(DEFAULT_SETTINGS, ACCOUNT, new AbortController().signal, () => {});
  return ctx;
}

const messages = async () => (await db.logs.toArray()).map((l) => l.message);

beforeEach(async () => {
  await db.logs.clear();
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('verifyPage: pop-ups over X’s page before an action (#29, PLAYBOOK F3)', () => {
  it('closes a pop-up and goes on', async () => {
    worker.ping.mockResolvedValueOnce({ ...PAGE, obstructed: true }).mockResolvedValueOnce(PAGE);
    worker.send.mockResolvedValue({ clear: true, what: 'Unlock more on X' });
    await context().verifyPage();
    expect(worker.send).toHaveBeenCalledWith({ cmd: 'clearPage' });
    expect(await messages()).toContain('Closed a pop-up on X’s page: Unlock more on X');
  });

  it('waits for the person when the pop-up stays', async () => {
    worker.ping.mockResolvedValue({ ...PAGE, obstructed: true });
    worker.send.mockResolvedValue({ clear: false, what: 'Subscribe to Premium' });
    const err = await context()
      .verifyPage()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NeedsYou);
    expect((err as NeedsYou).need).toBe('obstruction');
    expect(await messages()).toContain('A pop-up on X’s page didn’t close: Subscribe to Premium');
  });

  it('leaves X’s login alone and asks the person to log in', async () => {
    worker.ping.mockResolvedValue({ ...PAGE, loggedIn: false, viewerId: null, obstructed: true });
    const err = await context()
      .verifyPage()
      .catch((e: unknown) => e);
    expect((err as NeedsYou).need).toBe('login');
    expect(worker.send).not.toHaveBeenCalled();
  });

  it('stops on a restriction notice instead of closing it', async () => {
    worker.ping.mockResolvedValue({ ...PAGE, obstructed: true, restriction: 'Your account is temporarily limited' });
    const err = await context()
      .verifyPage()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Stop);
    expect((err as Stop).state).toBe('blocked');
    expect(worker.send).not.toHaveBeenCalled();
  });
});
