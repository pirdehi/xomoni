import { db, itemKey, kvSet, recordConsent } from '../../src/shared/db';
import { incomingKey } from '../../src/shared/incoming';
import { MOVE_FORMAT, MOVE_VERSION, type MoveHeader, moveChecksum } from '../../src/shared/move-file';
import type { DailyStats } from '../../src/shared/daily';
import type { Account, IncomingReply, Item, Job, LogEntry } from '../../src/shared/types';
import { RUNNER_LOCK } from '../../src/shared/runner-lock';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';

/** The X account the move tests work with: X's ids are digits, which a move file insists on. */
export const MOVER = '1111111111';

/** A second X account, for what a move must leave alone. */
export const OTHER = '2222222222';

/** When the moved data was made (2026-11-20 12:00 UTC); tests import at `NOW`. */
export const THEN = Date.UTC(2026, 10, 20, 12);

/** When the tests import: an hour after `THEN`. */
export const NOW = THEN + 60 * 60_000;

/** The xomoni.com device token a move must never write into its file. */
export const SECRET_TOKEN = 'device-token-never-in-a-file';

/** An account as Xomoni stores it, for `MOVER` unless `over` says otherwise. */
export function moverAccount(over: Partial<Account> = {}): Account {
  return {
    id: MOVER,
    handle: 'mover',
    name: 'The Mover',
    avatar: 'https://pbs.twimg.com/profile_images/1/me.jpg',
    postsCount: 120,
    likesCount: 340,
    followers: 10,
    following: 20,
    createdAt: Date.UTC(2012, 0, 1),
    profileAt: THEN,
    verified: false,
    updatedAt: THEN,
    ...over,
  };
}

/** An inventory item of `MOVER` with an X id. */
export function moverItem(id: string, over: Partial<Item> = {}): Item {
  const kind = over.kind ?? 'post';
  const accountId = over.accountId ?? MOVER;
  return {
    key: itemKey(accountId, kind, id),
    accountId,
    kind,
    id,
    targetId: id,
    createdAt: Date.UTC(2019, 5, 1),
    likedAt: null,
    text: `post ${id}`,
    author: 'mover',
    inReplyToId: null,
    selfReply: false,
    likes: 1,
    reposts: 0,
    replies: 0,
    sources: ['scan'],
    status: 'present',
    seenAt: THEN - 1000,
    statusAt: THEN - 1000,
    lastJobId: null,
    ...over,
  };
}

/** A job of `MOVER`. */
export function moverJob(id: string, over: Partial<Job> = {}): Job {
  return {
    id,
    accountId: MOVER,
    kind: 'cleanup',
    title: 'Delete posts older than 2020',
    filter: {
      target: 'post',
      before: Date.UTC(2020, 0, 1),
      after: null,
      keepMinLikes: 10,
      keepKeywords: ['keep'],
      keepIds: ['123'],
      skipSelfReplies: true,
    },
    options: { sweep: true, deep: true, ghostLikes: false },
    scan: null,
    state: 'completed',
    phase: 'deep',
    stateReason: '',
    stats: { matched: 3, done: 2, skipped: 1, failed: 0, scanned: 40 },
    createdAt: THEN - 5000,
    startedAt: THEN - 4000,
    finishedAt: THEN - 3000,
    updatedAt: THEN - 3000,
    ...over,
  };
}

/** A line of `MOVER`'s activity log. */
export function moverLog(over: Partial<LogEntry> = {}): LogEntry {
  return {
    ts: THEN - 2000,
    accountId: MOVER,
    jobId: 'job-done',
    level: 'success',
    action: 'delete',
    targetId: '1000000001',
    outcome: 'done',
    message: 'Deleted',
    ...over,
  };
}

/** A day of `MOVER`'s numbers. */
export function moverDay(over: Partial<DailyStats> = {}): DailyStats {
  return {
    accountId: MOVER,
    day: '2026-11-20',
    followers: 10,
    following: 20,
    postsTotal: 120,
    likesTotal: 340,
    receivedLikes: 5,
    receivedReplies: 2,
    receivedReposts: 1,
    receivedQuotes: 0,
    receivedViews: 300,
    observedPosts: 4,
    postsWithLikes: 2,
    repliesWithLikes: 1,
    updatedAt: THEN,
    ...over,
  };
}

/** A reply someone else wrote to `MOVER` (ADR-0030), posted `daysAgo` days before `NOW`. */
export function moverReply(id: string, daysAgo = 1): IncomingReply {
  return {
    key: incomingKey(MOVER, id),
    accountId: MOVER,
    id,
    author: 'someone',
    text: `reply ${id}`,
    createdAt: NOW - daysAgo * 86_400_000,
    toId: '1000000001',
  };
}

/**
 * Fills every table with `MOVER`'s data as a Xomoni in use holds it: posts, a like and a reply, a finished and a paused
 * job, the log, X's limits, page loads, risk events (one of them the person's override), a sampled check, a day of
 * numbers, two replies to the person, consent, and `kv` values both moved (settings, Watch, archive, view cap) and
 * never moved (the xomoni.com connection with its token, the sign-in state, a plan from xomoni.com).
 */
export async function seedEverything() {
  await db.accounts.put(moverAccount());
  await db.items.bulkPut([
    moverItem('1000000001'),
    moverItem('1000000002', { kind: 'like', author: 'friend', sources: ['archive'], seenAt: 0 }),
    moverItem('1000000003', { kind: 'reply', replyTo: 'friend', inReplyToId: '1000000009', quotes: 2, views: 50 }),
    moverItem('1000000004', { kind: 'repost', targetId: '', status: 'deleted', statusAt: THEN - 500 }),
  ]);
  await db.jobs.bulkPut([
    moverJob('job-done'),
    moverJob('job-paused', { state: 'paused', finishedAt: null, stateReason: 'Paused by you', updatedAt: THEN - 100 }),
    moverJob('job-scan', {
      kind: 'scan',
      filter: null,
      options: null,
      scan: 'range',
      range: { after: Date.UTC(2020, 0, 1), before: Date.UTC(2027, 0, 1) },
      health: {
        at: THEN - 50,
        level: 1,
        signals: { rate_limited: 1 },
        checks: { applied: 1, notApplied: 0, unclear: 0, pending: 0 },
        notice: null,
        restHours: 1,
        summary: 'One rate limit.',
      },
    }),
  ]);
  await db.logs.bulkAdd([moverLog(), moverLog({ ts: THEN - 1000, action: 'system', targetId: null, outcome: null })]);
  await db.limits.put({
    key: `${MOVER}:DeleteTweet`,
    accountId: MOVER,
    op: 'DeleteTweet',
    limit: 50,
    remaining: 40,
    reset: THEN + 600_000,
    status: 200,
    at: THEN,
  });
  await db.reads.add({ accountId: MOVER, budget: 'userTimeline', ts: THEN - 3000, posts: 20 });
  await db.risk.bulkAdd([
    { accountId: MOVER, kind: 'automation_flag', at: THEN - 3_600_000 },
    { accountId: MOVER, kind: 'override', at: THEN - 1_800_000 },
  ]);
  await db.checks.add({
    accountId: MOVER,
    jobId: 'job-done',
    action: 'delete',
    postId: '1000000004',
    at: THEN - 3000,
    dueAt: THEN + 600_000,
  });
  await db.daily.put(moverDay());
  await db.incoming.bulkPut([moverReply('3000000001'), moverReply('3000000002', 10)]);
  await recordConsent(MOVER);
  await kvSet('settings', { ...DEFAULT_SETTINGS, notifications: false });
  await kvSet('activeAccount', MOVER);
  await kvSet(`watchTabs:${MOVER}`, [
    { id: 'tab-1', query: '#xomoni' },
    { id: 'tab-2', query: '' },
  ]);
  await kvSet(`watchResults:${MOVER}`, {
    'tab-1': {
      query: '#xomoni',
      checkedAt: THEN,
      posts: [{ id: '4000000001', handle: 'fan', name: 'A fan', text: 'Xomoni!', time: THEN - 60_000 }],
      error: '',
    },
  });
  await kvSet(`archive:${MOVER}`, THEN - 86_400_000);
  await kvSet(`archiveRequest:${MOVER}`, { requestedAt: THEN - 7_200_000, checkedAt: THEN, downloadedAt: null });
  await kvSet(`viewCap:${MOVER}`, { cap: 800, seen: 1000, learnedAt: THEN - 5000 });
  await kvSet('cloud', { deviceId: 'device-1', token: SECRET_TOKEN, deviceName: 'Laptop', connectedAt: THEN });
  await kvSet('signedOut', null);
  await kvSet('websitePlan', { at: THEN, accountId: MOVER });
  await kvSet('dailyStats', { on: true, sentUpTo: { [MOVER]: '2026-11-19' } });
}

/**
 * A move file made of `data` with a checksum that matches it, as someone who changed a file and computed its checksum
 * again would make it: the checks after the checksum must still catch what is wrong.
 */
export async function signedFile(data: unknown, header: Partial<Record<keyof MoveHeader, unknown>> = {}) {
  const head = { format: MOVE_FORMAT, version: MOVE_VERSION, app: '0.5.0', exportedAt: new Date(THEN).toISOString() };
  const full = { ...head, ...header };
  const checksum = await moveChecksum(full as MoveHeader, data);
  return JSON.stringify({ ...full, checksum, data });
}

/**
 * Holds the runner's Web Lock as a job running in another dashboard tab does, until `release` is awaited.
 */
export async function holdRunnerLock(): Promise<{ release: () => Promise<void> }> {
  let free: () => void = () => undefined;
  let taken: () => void = () => undefined;
  const isTaken = new Promise<void>((resolve) => (taken = resolve));
  const held = navigator.locks.request(RUNNER_LOCK, async () => {
    taken();
    await new Promise<void>((resolve) => (free = resolve));
  });
  await isTaken;
  return {
    release: async () => {
      free();
      await held;
    },
  };
}
