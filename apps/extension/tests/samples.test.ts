import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCleanup } from '../src/engine/cleanup';
import { type JobContext, Stop } from '../src/engine/context';
import { SAMPLE_RATE, runDueChecks, sampleAction } from '../src/engine/samples';
import type * as Timers from '../src/engine/timers';
import type * as WorkerTabModule from '../src/engine/worker-tab';
import { db, itemKey } from '../src/shared/db';
import type { ActorCommand, ContentState, VisibleTweet } from '../src/shared/messages';
import type { Item, SampleCheck } from '../src/shared/types';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));

// The real sleep runs on a Web Worker, which tests don't have; the worker tab needs Chrome.
vi.mock('../src/engine/timers', async (importOriginal) => ({
  ...(await importOriginal<typeof Timers>()),
  sleep: async () => {},
}));
vi.mock('../src/engine/worker-tab', async (importOriginal) => ({
  ...(await importOriginal<typeof WorkerTabModule>()),
  workerTab: { send },
}));

const ACCOUNT = 'acct-1';
const MINUTE = 60_000;

/** A run whose post pages show `page` and, when it has posts, `visible`. */
function fakeContext(page: ContentState['kind'] = 'tweets', visible: VisibleTweet[] = []) {
  send.mockImplementation(async (command: ActorCommand) => {
    if (command.cmd === 'visible') return visible;
    throw new Error(`unexpected command ${command.cmd}`);
  });
  return {
    job: { id: 'j', accountId: ACCOUNT, stats: { matched: 0, done: 0, skipped: 0, failed: 0, scanned: 0 } },
    navigate: vi.fn(async (_url: string) => ({ kind: page, count: visible.length, http: 200 })),
    checkpoint: vi.fn(),
    status: vi.fn(),
    log: vi.fn(async (_level: string, _action: string, _message: string) => 0),
  };
}
const asContext = (ctx: ReturnType<typeof fakeContext>) => ctx as unknown as JobContext;

const queue = (check: Partial<SampleCheck>) =>
  db.checks.add({
    accountId: ACCOUNT,
    jobId: 'j',
    action: 'delete',
    postId: '1',
    at: Date.now() - 20 * MINUTE,
    dueAt: Date.now() - MINUTE,
    ...check,
  });
const shown = (patch: Partial<VisibleTweet> = {}): VisibleTweet => ({
  id: '1',
  handle: 'me',
  time: null,
  liked: false,
  reposted: false,
  ...patch,
});

beforeEach(async () => {
  send.mockReset();
  await Promise.all([db.checks.clear(), db.risk.clear(), db.items.clear()]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sampleAction (#22, PLAYBOOK C5)', () => {
  it('queues about one in 25 confirmed actions, due 10–30 minutes later', async () => {
    const ctx = asContext(fakeContext());
    await sampleAction(ctx, 'delete', '1', () => SAMPLE_RATE / 2);
    await sampleAction(ctx, 'delete', '2', () => SAMPLE_RATE);
    await sampleAction(ctx, 'read', '3', () => 0);
    const checks = await db.checks.toArray();
    expect(checks.map((c) => c.postId)).toEqual(['1']);
    const wait = (checks[0].dueAt - checks[0].at) / MINUTE;
    expect(wait).toBeGreaterThanOrEqual(10);
    expect(wait).toBeLessThanOrEqual(30);
  });
});

describe('runDueChecks: catching a silent block (#22, PLAYBOOK C5)', () => {
  it('accepts a deleted post that X no longer shows, and drops the check', async () => {
    await queue({});
    const ctx = fakeContext('error');
    await runDueChecks(asContext(ctx));
    expect(ctx.navigate).toHaveBeenCalledWith('https://x.com/i/web/status/1');
    expect(await db.checks.count()).toBe(0);
    expect(await db.risk.count()).toBe(0);
  });

  it('stops everything when a deleted post is still there', async () => {
    await queue({});
    const err = await runDueChecks(asContext(fakeContext('tweets', [shown()]))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Stop);
    expect((err as Stop).state).toBe('blocked');
    expect((err as Stop).message).toMatch(/Risk level 4 \(Full stop\)/);
    expect((await db.risk.toArray()).map((e) => e.kind)).toEqual(['silent_block']);
  });

  it('stops when an unliked post still shows as liked, and accepts one that does not', async () => {
    await queue({ action: 'unlike' });
    await expect(runDueChecks(asContext(fakeContext('tweets', [shown({ liked: true })])))).rejects.toBeInstanceOf(Stop);
    await db.risk.clear();
    await queue({ action: 'unlike' });
    await runDueChecks(asContext(fakeContext('tweets', [shown({ liked: false })])));
    expect(await db.risk.count()).toBe(0);
  });

  it('stops when an undone repost still shows as reposted', async () => {
    await queue({ action: 'unretweet' });
    await expect(runDueChecks(asContext(fakeContext('tweets', [shown({ reposted: true })])))).rejects.toBeInstanceOf(
      Stop,
    );
  });

  it('does nothing before a check is due, and drops one the page cannot answer', async () => {
    await queue({ dueAt: Date.now() + 5 * MINUTE });
    const early = fakeContext('tweets', [shown()]);
    await runDueChecks(asContext(early));
    expect(early.navigate).not.toHaveBeenCalled();

    await db.checks.clear();
    await queue({ action: 'unlike' });
    const blank = fakeContext('timeout');
    await runDueChecks(asContext(blank));
    expect(await db.checks.count()).toBe(0);
    expect(await db.risk.count()).toBe(0);
    expect(blank.log.mock.calls[0][2]).toMatch(/could not show/);
  });
});

describe('Cleanup samples confirmed deletes', () => {
  it('queues a check for a confirmed delete when it is picked', async () => {
    const now = Date.now();
    await db.items.add({
      key: itemKey(ACCOUNT, 'post', '7'),
      accountId: ACCOUNT,
      kind: 'post',
      id: '7',
      targetId: '7',
      createdAt: now - 400 * 86_400_000,
      likedAt: null,
      text: 'old post',
      author: 'me',
      inReplyToId: null,
      selfReply: false,
      likes: 0,
      reposts: 0,
      replies: 0,
      sources: ['scan'],
      status: 'present',
      seenAt: now,
      statusAt: now,
      lastJobId: null,
    } satisfies Item);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const ctx = {
      ...fakeContext(),
      job: {
        id: 'j',
        accountId: ACCOUNT,
        filter: {
          target: 'post',
          before: now,
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
      verifyPage: vi.fn(async () => {}),
      limiter: { before: vi.fn(async () => {}) },
      settle: vi.fn(async () => true),
      save: vi.fn(async () => {}),
      setPhase: vi.fn(async () => {}),
    };
    // After fakeContext, which sets its own answers.
    send.mockImplementation(async (command: ActorCommand) =>
      command.cmd === 'canary' ? { verdict: 'ok', message: 'ok' } : { outcome: 'done' },
    );
    await runCleanup(ctx as unknown as JobContext);
    expect(await db.checks.toArray()).toMatchObject([{ action: 'delete', postId: '7', jobId: 'j' }]);
  });
});
