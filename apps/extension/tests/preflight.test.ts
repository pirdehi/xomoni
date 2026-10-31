import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runCleanup } from '../src/engine/cleanup';
import { type JobContext, Stop } from '../src/engine/context';
import type * as Timers from '../src/engine/timers';
import type * as WorkerTabModule from '../src/engine/worker-tab';
import { db, itemKey } from '../src/shared/db';
import type { ActorCommand, CanaryResult } from '../src/shared/messages';
import type { Item } from '../src/shared/types';

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

/** A deep-clean run over the inventory, with the worker tab answering `canary` as given. */
function deepClean(canary: CanaryResult) {
  send.mockImplementation(async (command: ActorCommand) => {
    if (command.cmd === 'canary') return canary;
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
    navigate: vi.fn(async () => ({ kind: 'tweets', count: 1, http: 200 })),
    verifyPage: vi.fn(async () => {}),
    limiter: { before: vi.fn(async () => {}) },
    settle: vi.fn(async () => true),
    checkpoint: vi.fn(),
    log: vi.fn(async () => 0),
    save: vi.fn(async () => {}),
    setPhase: vi.fn(async () => {}),
    status: vi.fn(),
  };
  return { ctx, run: () => runCleanup(ctx as unknown as JobContext) };
}

const sent = (cmd: ActorCommand['cmd']) => send.mock.calls.filter(([c]) => (c as ActorCommand).cmd === cmd).length;

beforeEach(async () => {
  send.mockReset();
  await db.items.clear();
  await db.items.bulkAdd([post('1'), post('2')]);
});

describe('Check before the first action (#21, PLAYBOOK F1)', () => {
  it('stops before any delete when X changed its page', async () => {
    const { run } = deepClean({ verdict: 'changed', message: 'the post menu (…) opened without a Delete option' });
    const err = await run().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Stop);
    expect((err as Stop).state).toBe('blocked');
    expect((err as Stop).message).toMatch(/^X changed its page: the post menu/);
    expect(sent('delete')).toBe(0);
  });

  it('checks once per run, then acts', async () => {
    const { run } = deepClean({ verdict: 'ok', message: 'a Delete option is where Xomoni expects it' });
    await run();
    expect(sent('canary')).toBe(1);
    expect(sent('delete')).toBe(2);
  });

  it('checks again on the next post when one cannot tell', async () => {
    const { run } = deepClean({ verdict: 'unknown', message: 'the post is not on the page' });
    await run();
    expect(sent('canary')).toBe(2);
  });
});
