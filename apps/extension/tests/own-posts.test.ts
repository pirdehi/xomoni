import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runCleanup } from '../src/engine/cleanup';
import { JobContext, Stop } from '../src/engine/context';
import { Limiter } from '../src/engine/limiter';
import type { EnginePorts, XTab } from '../src/engine/ports';
import type * as Timers from '../src/engine/timers';
import { db, itemKey } from '../src/shared/db';
import type { ActorCommand } from '../src/shared/messages';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import type { Item, Job } from '../src/shared/types';
import { ACCOUNT, page } from './support/engine';

// The real sleep runs on a Web Worker, which tests don't have.
vi.mock('../src/engine/timers', async (importOriginal) => ({
  ...(await importOriginal<typeof Timers>()),
  sleep: async () => {},
}));

const NOW = Date.now();

const post = (id: string): Item => ({
  key: itemKey(ACCOUNT, 'post', id),
  accountId: ACCOUNT,
  kind: 'post',
  id,
  targetId: id,
  createdAt: NOW - 400 * 86_400_000,
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
  seenAt: NOW,
  statusAt: NOW,
  lastJobId: null,
});

const send = vi.fn<(command: ActorCommand) => Promise<unknown>>();

/** A deep-clean run over the inventory; the worker tab answers every canary `ok` and every delete `done`. */
function deepClean() {
  send.mockImplementation(async (command) => {
    if (command.cmd === 'canary') return { verdict: 'ok', message: 'ok' };
    if (command.cmd === 'delete') return { outcome: 'done' };
    throw new Error(`unexpected command ${command.cmd}`);
  });
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
      options: { sweep: false, deep: true, ghostLikes: false },
      stats: { matched: 0, done: 0, skipped: 0, failed: 0, scanned: 0 },
    },
    handle: 'me',
    attempted: new Set<string>(),
    preflighted: new Set<string>(),
    signal: new AbortController().signal,
    navigate: vi.fn(async (_url: string) => ({ kind: 'tweets', count: 1, http: 200 })),
    verifyPage: vi.fn(async () => {}),
    limiter: { before: vi.fn(async () => {}) },
    settle: vi.fn(async () => true),
    leaveAlone: vi.fn(async (_item: Pick<Item, 'id'>, _message: string) => {}),
    checkpoint: vi.fn(),
    log: vi.fn(async () => 0),
    save: vi.fn(async () => {}),
    setPhase: vi.fn(async () => {}),
    status: vi.fn(),
    xTab: { send, ping: vi.fn(async () => page()) },
  };
  return { ctx, run: () => runCleanup(ctx as unknown as JobContext) };
}

const commands = (cmd: ActorCommand['cmd']) => send.mock.calls.map(([c]) => c).filter((c) => c.cmd === cmd);

beforeEach(async () => {
  send.mockReset();
  await db.items.clear();
});

describe('the deep clean acts on the person’s own posts only (#144)', () => {
  it('names the account’s handle in every delete and in the check before it', async () => {
    await db.items.bulkAdd([post('1'), post('2')]);
    const { run } = deepClean();
    await run();
    expect(commands('canary')).toEqual([{ cmd: 'canary', action: 'delete', id: '1', handle: 'me' }]);
    expect(commands('delete')).toEqual([
      { cmd: 'delete', id: '1', handle: 'me', keep: [] },
      { cmd: 'delete', id: '2', handle: 'me', keep: [] },
    ]);
  });

  it('leaves an inventory row whose id isn’t an X id alone, and never opens a page for it', async () => {
    await db.items.bulkAdd([post('1'), post('2/../../settings')]);
    const { ctx, run } = deepClean();
    await run();
    expect(ctx.leaveAlone).toHaveBeenCalledWith(
      expect.objectContaining({ id: '2/../../settings' }),
      'its id isn’t an X post id',
    );
    expect(ctx.navigate.mock.calls.map(([url]) => url)).toEqual(['https://x.com/me/status/1']);
    expect(commands('delete')).toEqual([{ cmd: 'delete', id: '1', handle: 'me', keep: [] }]);
  });
});

describe('the deep clean trusts a post’s id over its stored date (#145)', () => {
  /** A post id that carries `time`, as X's snowflake ids do. */
  const idAt = (time: number) => ((BigInt(time) - 1_288_834_974_657n) << 22n).toString();

  it('leaves a row alone whose date disagrees with its id, and never deletes it', async () => {
    // A recent post, stored with a date old enough for the rule: what a forged inventory row would look like.
    const recent = idAt(NOW - 86_400_000);
    await db.items.bulkAdd([post(recent)]);
    const { ctx, run } = deepClean();
    await run();
    expect(ctx.leaveAlone).toHaveBeenCalledWith(
      expect.objectContaining({ id: recent }),
      'its date doesn’t match its id',
    );
    expect(commands('delete')).toEqual([]);
  });

  it('deletes a row whose date agrees with its id, and sends the words the rule keeps', async () => {
    const old = idAt(NOW - 400 * 86_400_000);
    await db.items.bulkAdd([post(old)]);
    const { ctx, run } = deepClean();
    ctx.job.filter.keepKeywords = ['conference'] as never[];
    await run();
    expect(ctx.leaveAlone).not.toHaveBeenCalled();
    expect(commands('delete')).toEqual([{ cmd: 'delete', id: old, handle: 'me', keep: ['conference'] }]);
  });
});

/** A job context over fake ports, as the runner builds one. */
function context(xTab: Partial<XTab> = {}) {
  const job = {
    id: 'j',
    accountId: ACCOUNT,
    stats: { matched: 0, done: 0, skipped: 0, failed: 0, scanned: 0 },
  } as Job;
  const ports = {
    xTab: {
      current: async () => 7,
      open: async () => 7,
      keepLoaded: async () => {},
      waitReady: async () => page(),
      ping: async () => page(),
      ...xTab,
    },
    notifier: { notify: async () => {}, clear: () => {} },
    presence: { away: async () => false, keepDisplayOn: () => {} },
  } as unknown as EnginePorts;
  const ctx = new JobContext(job, new AbortController().signal, { status: () => {}, attention: () => {} }, ports);
  ctx.settings = DEFAULT_SETTINGS;
  ctx.limiter = new Limiter(DEFAULT_SETTINGS, ACCOUNT, new AbortController().signal, () => {});
  return { ctx, job };
}

describe('a refusal is left alone, never a failure (#144)', () => {
  beforeEach(async () => {
    await db.logs.clear();
  });

  it('counts it as skipped, keeps the post as it was, and logs why', async () => {
    const item = post('5');
    await db.items.add(item);
    const { ctx, job } = context();

    for (let i = 0; i < DEFAULT_SETTINGS.maxConsecutiveFailures + 1; i++) {
      await ctx.settle('delete', item, { outcome: 'skipped', message: 'not your post: X shows it by @someone' });
    }

    expect(job.stats).toMatchObject({ skipped: 3, failed: 0 });
    expect(await db.items.get(item.key)).toMatchObject({ status: 'present', lastJobId: 'j' });
    const logs = await db.logs.toArray();
    expect(logs.at(-1)).toMatchObject({
      level: 'warn',
      outcome: 'skipped',
      message: 'Left alone — not your post: X shows it by @someone',
    });
  });
});

describe('the account’s handle (#144)', () => {
  it('stops before acting when X shows a handle X wouldn’t allow', async () => {
    const { ctx } = context({ waitReady: async () => page({ handle: 'me/../settings' }) });
    const err = await ctx.connect().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Stop);
    expect((err as Stop).message).toMatch(/Could not determine your @handle/);
  });

  it('connects with a handle X allows', async () => {
    const { ctx } = context();
    await ctx.connect();
    expect(ctx.handle).toBe('me');
  });
});
