import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, getViewCap, hasConsent, kvGet, kvSet, wipeLocalData } from '../src/shared/db';
import { INCOMING_MAX } from '../src/shared/incoming';
import {
  MOVED_JOB_REASON,
  type MoveResult,
  arrivedJob,
  dismissImportNotice,
  dismissMoveOffer,
  exportData,
  importData,
  importNotice,
  mergeAccount,
  mergeDaily,
  mergeItem,
  moveOfferShown,
} from '../src/shared/move';
import {
  LEFT_OUT_TABLES,
  MOVE_TABLES,
  type MoveData,
  type MoveFile,
  VAULT_TABLE_NAMES,
  checkMoveText,
} from '../src/shared/move-file';
import { analyticsPostKey } from '../src/shared/vault/records';
import { RUNNER_LOCK } from '../src/shared/runner-lock';
import { PRESETS } from '../src/shared/settings';
import type { Settings } from '../src/shared/types';
import { resetDb } from './support/fixtures';
import {
  MOVER,
  NOW,
  OTHER,
  SECRET_TOKEN,
  THEN,
  moverAccount,
  moverAnalyticsDay,
  moverAnalyticsPost,
  moverDay,
  moverEvent,
  moverImport,
  moverItem,
  moverJob,
  moverLog,
  moverReply,
  seedEverything,
  holdRunnerLock,
  signedFile,
} from './support/move';

/** Exports, then checks the file as the import does, and returns it. */
async function exported(accountId?: string): Promise<MoveFile> {
  const { text } = await exportData({ app: '0.4.1', now: THEN, ...(accountId && { accountId }) });
  const checked = await checkMoveText(text, NOW);
  if (!checked.ok) throw new Error(checked.message);
  return checked.file;
}

/** A checked file made of `data`, with a checksum that matches. */
async function fileOf(data: MoveData): Promise<MoveFile> {
  const checked = await checkMoveText(await signedFile(data), NOW);
  if (!checked.ok) throw new Error(checked.message);
  return checked.file;
}

const empty = (): MoveData => ({
  accounts: [],
  items: [],
  jobs: [],
  logs: [],
  limits: [],
  reads: [],
  risk: [],
  checks: [],
  daily: [],
  incoming: [],
  kv: [],
  vaultImports: [],
  analyticsPosts: [],
  analyticsDays: [],
  accountEvents: [],
});

async function imported(file: MoveFile): Promise<MoveResult> {
  const result = await importData(file, NOW);
  if (result === 'busy') throw new Error('busy');
  return result;
}

/** Every row of every table, without auto-increment numbers, to compare two databases. */
async function snapshot() {
  const rows: Record<string, unknown[]> = {};
  for (const table of db.tables) {
    rows[table.name] = (await table.toArray()).map((row: Record<string, unknown>) => {
      const { seq: _seq, ...rest } = row;
      return rest;
    });
  }
  return rows;
}

beforeEach(resetDb);
afterEach(resetDb);

describe('what a move carries (#300, ADR-0032)', () => {
  it('names every table of the database: moved, or left out on purpose', () => {
    const names = db.tables.map((t) => t.name).sort();
    expect([...MOVE_TABLES, ...Object.keys(LEFT_OUT_TABLES)].sort()).toEqual(names);
  });

  it('exports every moved table with the person’s data, the risk ladder and X’s limits included', async () => {
    await seedEverything();
    const { data } = await exported();

    for (const table of MOVE_TABLES) expect(data[table].length, table).toBeGreaterThan(0);
    expect(data.items).toHaveLength(4);
    expect(data.jobs.map((j) => j.id).sort()).toEqual(['job-done', 'job-paused', 'job-scan']);
    expect(data.risk.map((e) => e.kind).sort()).toEqual(['automation_flag', 'override']);
    expect(data.reads).toEqual([{ accountId: MOVER, budget: 'userTimeline', ts: THEN - 3000, posts: 20 }]);
    expect(data.incoming).toHaveLength(2);
    expect(data.kv.map((v) => v.key).sort()).toEqual(
      [
        'activeAccount',
        'settings',
        `archive:${MOVER}`,
        `archiveRequest:${MOVER}`,
        `viewCap:${MOVER}`,
        `watchResults:${MOVER}`,
        `watchTabs:${MOVER}`,
      ].sort(),
    );
  });

  it('never writes the xomoni.com token, the sign-in state, a plan from xomoni.com or consent into the file', async () => {
    await seedEverything();
    const { text } = await exportData({ app: '0.4.1', now: THEN });

    expect(text).not.toContain(SECRET_TOKEN);
    for (const left of ['"cloud"', '"signedOut"', '"websitePlan"', '"dailyStats"', '"consents"'])
      expect(text).not.toContain(left);
  });

  it('only reads: the database is the same after an export', async () => {
    await seedEverything();
    const before = await snapshot();
    await exportData({ app: '0.4.1', now: THEN });
    expect(await snapshot()).toEqual(before);
  });

  it('leaves damaged records out of the file and counts them, so the file still imports', async () => {
    await seedEverything();
    await db.items.put({ ...moverItem('1000000009'), key: 'broken', accountId: 'not-an-id' });
    await db.logs.add(moverLog({ level: 'loud' as never }));

    const result = await exportData({ app: '0.4.1', now: THEN });

    expect(result.skipped).toBe(2);
    expect(result.counts.items).toBe(4);
    expect((await checkMoveText(result.text, NOW)).ok).toBe(true);
  });

  it('exports one account alone, with its own values but not the browser’s settings (the copy before removing it)', async () => {
    await seedEverything();
    await db.accounts.put(moverAccount({ id: OTHER, handle: 'other' }));
    await db.items.put(moverItem('1000000007', { accountId: OTHER }));
    await db.logs.add(moverLog({ accountId: OTHER }));
    await kvSet(`watchTabs:${OTHER}`, []);

    const { data } = await exported(MOVER);

    expect(data.accounts.map((a) => a.id)).toEqual([MOVER]);
    expect(data.items.every((i) => i.accountId === MOVER)).toBe(true);
    expect(data.items).toHaveLength(4);
    expect(data.logs.every((l) => l.accountId === MOVER)).toBe(true);
    expect(data.kv.map((v) => v.key)).not.toContain('settings');
    expect(data.kv.map((v) => v.key)).not.toContain(`watchTabs:${OTHER}`);
    expect(data.kv.map((v) => v.key)).toContain(`watchTabs:${MOVER}`);
  });
});

describe('importing into a new Xomoni (#300, ADR-0032)', () => {
  it('brings everything back into an empty database', async () => {
    await seedEverything();
    const before = await snapshot();
    const file = await exported();
    await resetDb();

    const result = await imported(file);
    const after = await snapshot();

    expect(after.accounts).toEqual(before.accounts);
    expect(after.items).toEqual(before.items);
    expect(after.limits).toEqual(before.limits);
    expect(after.reads).toEqual(before.reads);
    expect(after.checks).toEqual(before.checks);
    expect(after.daily).toEqual(before.daily);
    expect(after.incoming).toEqual(before.incoming);
    expect(result.added).toMatchObject({ accounts: 1, items: 4, jobs: 3, logs: 2, incoming: 2, daily: 1 });
    expect(Object.values(result.updated).every((n) => n === 0)).toBe(true);
    expect(await kvGet(`viewCap:${MOVER}`, null)).toEqual({ cap: 800, seen: 1000, learnedAt: THEN - 5000 });
    expect(await kvGet('activeAccount', null)).toBe(MOVER);
    expect(await kvGet(`archive:${MOVER}`, null)).toBe(THEN - 86_400_000);
  });

  it('keeps X’s limits and the risk ladder, but not the person’s typed override: a file can’t lift a stop', async () => {
    await seedEverything();
    const file = await exported();
    await resetDb();

    await imported(file);

    expect((await db.risk.toArray()).map((e) => e.kind)).toEqual(['automation_flag']);
    expect(await db.reads.count()).toBe(1);
    expect(await db.limits.count()).toBe(1);
  });

  it('leaves the xomoni.com connection, the sign-in and consent behind: the new Xomoni asks again', async () => {
    await seedEverything();
    const file = await exported();
    await resetDb();

    await imported(file);

    expect(await kvGet('cloud', null)).toBeNull();
    expect(await kvGet('websitePlan', null)).toBeNull();
    expect(await hasConsent(MOVER)).toBe(false);
  });

  it('brings a job that hadn’t finished in ended, so nothing a file brings can resume work on X', async () => {
    await seedEverything();
    const file = await exported();
    await resetDb();

    await imported(file);

    const paused = await db.jobs.get('job-paused');
    expect(paused).toMatchObject({ state: 'cancelled', stateReason: MOVED_JOB_REASON, finishedAt: NOW });
    expect(await db.jobs.get('job-done')).toMatchObject({ state: 'completed', finishedAt: THEN - 3000 });
    for (const state of ['queued', 'running', 'waiting', 'blocked'] as const)
      expect(arrivedJob(moverJob('j', { state, finishedAt: null }), NOW).state).toBe('cancelled');
    expect(arrivedJob(moverJob('j', { state: 'failed' }), NOW).state).toBe('failed');
  });

  it('says in the activity log what came in, for each account', async () => {
    await seedEverything();
    const file = await exported();
    await resetDb();

    await imported(file);

    const lines = await db.logs.where('ts').equals(NOW).toArray();
    expect(lines).toEqual([
      expect.objectContaining({
        accountId: MOVER,
        level: 'success',
        action: 'system',
        message:
          'Moved in from Xomoni 0.4.1 (exported 2026-11-20): 3 posts, replies and reposts, 1 likes, 3 jobs and 2 log entries. Nothing here was replaced with less or deleted.',
      }),
    ]);
  });

  it('adds nothing the second time the same file is imported', async () => {
    await seedEverything();
    const file = await exported();
    await resetDb();
    await imported(file);
    const once = await snapshot();

    const again = await imported(file);

    expect(Object.values(again.added).every((n) => n === 0)).toBe(true);
    expect(Object.values(again.updated).every((n) => n === 0)).toBe(true);
    const twice = await snapshot();
    // Only the import's own line in the log is new, and its result for the dashboard replaces the first one's (#357).
    expect(twice.logs).toHaveLength(once.logs!.length + 1);
    const besides = (rows: Record<string, unknown[]>) => ({
      ...rows,
      logs: [],
      kv: rows.kv!.filter((row) => (row as { key: string }).key !== 'moveImported'),
    });
    expect(besides(twice)).toEqual(besides(once));
    expect(await importNotice()).toEqual({ app: '0.4.1', at: NOW, result: again });
  });

  it('keeps replies to the person within ADR-0030’s 90 days and 5,000', async () => {
    const replies = [moverReply('3000000001', 1), moverReply('3000000002', 91)];
    await imported(await fileOf({ ...empty(), incoming: replies }));
    expect((await db.incoming.toArray()).map((r) => r.id)).toEqual(['3000000001']);

    await resetDb();
    const many = Array.from({ length: INCOMING_MAX + 5 }, (_, i) => ({
      ...moverReply(String(3_100_000_000 + i), 1),
      createdAt: NOW - 86_400_000 + i,
    }));
    await imported(await fileOf({ ...empty(), incoming: many }));
    expect(await db.incoming.count()).toBe(INCOMING_MAX);
  });

  it('refuses while a job runs, writing nothing', async () => {
    await seedEverything();
    const file = await exported();
    await resetDb();

    const runner = await holdRunnerLock();

    expect(await importData(file, NOW)).toBe('busy');
    expect(await db.items.count()).toBe(0);
    expect(await db.logs.count()).toBe(0);
    await runner.release();
  });

  it('holds the runner’s lock while it imports, so no job can start meanwhile', async () => {
    await seedEverything();
    const file = await exported();
    await resetDb();
    let heldDuring = false;
    const original = db.items.bulkPut.bind(db.items);
    db.items.bulkPut = ((...args: Parameters<typeof original>) => {
      void navigator.locks.request(RUNNER_LOCK, { ifAvailable: true }, (lock) => {
        heldDuring = !lock;
        return Promise.resolve();
      });
      return original(...args);
    }) as typeof db.items.bulkPut;
    try {
      await imported(file);
    } finally {
      db.items.bulkPut = original;
    }
    expect(heldDuring).toBe(true);
  });
});

describe('merging with what is here (#300, ADR-0032)', () => {
  it('never deletes: what this Xomoni has and the file hasn’t stays', async () => {
    await db.accounts.put(moverAccount({ id: OTHER, handle: 'other' }));
    await db.items.put(moverItem('1000000099', { accountId: OTHER }));
    await db.logs.add(moverLog({ accountId: OTHER }));
    await kvSet('settings', { ...PRESETS, preset: 'careful' });

    await imported(await fileOf({ ...empty(), accounts: [moverAccount()], items: [moverItem('1000000001')] }));

    expect(await db.accounts.count()).toBe(2);
    expect(await db.items.count()).toBe(2);
    expect(await db.items.get(moverItem('1000000099', { accountId: OTHER }).key)).toBeDefined();
    expect(await db.logs.where('accountId').equals(OTHER).count()).toBe(1);
  });

  it('keeps an item this Xomoni removed removed, unless X showed it again later', async () => {
    const removed = moverItem('1000000001', { status: 'deleted', statusAt: THEN, lastJobId: 'job-here' });
    await db.items.put(removed);
    const older = moverItem('1000000001', { status: 'present', statusAt: THEN - 10_000, seenAt: THEN - 10_000 });

    await imported(await fileOf({ ...empty(), items: [older] }));
    expect(await db.items.get(removed.key)).toMatchObject({ status: 'deleted', statusAt: THEN, lastJobId: 'job-here' });

    const seenAgain = moverItem('1000000001', { status: 'present', statusAt: THEN + 10_000, seenAt: THEN + 10_000 });
    await imported(await fileOf({ ...empty(), items: [seenAgain] }));
    expect(await db.items.get(removed.key)).toMatchObject({ status: 'present', statusAt: THEN + 10_000 });
  });

  it('keeps an item removed when the other copy only came from an archive since', () => {
    const removed = moverItem('1000000001', { status: 'deleted', statusAt: THEN - 86_400_000, lastJobId: 'job-old' });
    const fromArchive = moverItem('1000000001', { status: 'present', statusAt: NOW, seenAt: 0, sources: ['archive'] });
    expect(mergeItem(fromArchive, removed)).toMatchObject({ status: 'deleted', lastJobId: 'job-old' });
    expect(mergeItem(removed, fromArchive)).toMatchObject({ status: 'deleted', sources: ['scan', 'archive'] });

    const gone = moverItem('1000000001', { status: 'gone', statusAt: THEN });
    expect(mergeItem(removed, gone).status).toBe('gone');
    const shownAgain = moverItem('1000000001', {
      status: 'present',
      statusAt: THEN - 1,
      seenAt: THEN - 86_400_000 + 9_000,
    });
    expect(mergeItem(removed, shownAgain).status).toBe('present');
  });

  it('merges two copies of an item field by field, never with less', () => {
    const here = moverItem('1000000001', {
      text: 'what I wrote',
      likes: 5,
      seenAt: THEN,
      statusAt: THEN - 100,
      sources: ['scan'],
      views: 100,
      likedAt: THEN - 50,
    });
    const there = moverItem('1000000001', {
      text: '',
      likes: 9,
      seenAt: THEN + 100,
      statusAt: THEN - 200,
      sources: ['archive'],
      quotes: 3,
      likedAt: null,
    });

    const merged = mergeItem(here, there);

    expect(merged).toMatchObject({
      text: 'what I wrote',
      likes: 9,
      seenAt: THEN + 100,
      statusAt: THEN - 100,
      sources: ['scan', 'archive'],
      quotes: 3,
      views: 100,
      likedAt: THEN - 50,
    });
    expect(mergeItem(here, here)).toEqual(here);
  });

  it('keeps a post’s links and media from the copy X showed last, and fills them in from the other (#428)', () => {
    const live = moverItem('1000000001', { seenAt: THEN + 100, links: 1 });
    const archived = moverItem('1000000001', { seenAt: 0, sources: ['archive'], links: 3, media: 2 });
    expect(mergeItem(archived, live)).toMatchObject({ links: 1, media: 2 });
    expect(mergeItem(live, archived)).toMatchObject({ links: 1, media: 2 });
    const neither = mergeItem(moverItem('1000000001'), moverItem('1000000001', { seenAt: THEN + 1 }));
    expect(neither).not.toHaveProperty('links');
    expect(neither).not.toHaveProperty('media');
  });

  it('counts an item changed by a newer copy as updated, and one already the same as nothing', async () => {
    await db.items.put(moverItem('1000000001', { likes: 1, seenAt: THEN - 10 }));
    const result = await imported(
      await fileOf({
        ...empty(),
        items: [moverItem('1000000001', { likes: 7, seenAt: THEN }), moverItem('1000000002')],
      }),
    );
    expect(result.added.items).toBe(1);
    expect(result.updated.items).toBe(1);
    expect((await db.items.get(moverItem('1000000001').key))?.likes).toBe(7);
  });

  it('keeps the newer copy of an account, filling in what it left empty', async () => {
    const here = moverAccount({ updatedAt: THEN + 1, followers: 99, name: '', avatar: '' });
    const there = moverAccount({ updatedAt: THEN, followers: 10, name: 'The Mover' });
    expect(mergeAccount(here, there)).toMatchObject({
      followers: 99,
      name: 'The Mover',
      avatar: there.avatar,
      updatedAt: THEN + 1,
    });
    expect(mergeAccount(there, here)).toMatchObject({ followers: 99, name: 'The Mover', updatedAt: THEN + 1 });
  });

  it('keeps a day’s counts at the larger of the two, and the profile from the later copy', () => {
    const here = moverDay({ receivedLikes: 10, receivedViews: 50, followers: 30, updatedAt: THEN + 1 });
    const there = moverDay({ receivedLikes: 4, receivedViews: 80, followers: 25, updatedAt: THEN });
    expect(mergeDaily(here, there)).toMatchObject({ receivedLikes: 10, receivedViews: 80, followers: 30 });
    expect(mergeDaily(moverDay({ followers: null, updatedAt: THEN + 1 }), there).followers).toBe(25);
  });

  it('keeps a job here unless the file’s copy is newer', async () => {
    await db.jobs.put(moverJob('j1', { state: 'paused', finishedAt: null, updatedAt: THEN }));
    await db.jobs.put(
      moverJob('j2', { state: 'completed', updatedAt: THEN - 10_000, stats: { ...moverJob('j').stats, done: 1 } }),
    );

    const result = await imported(
      await fileOf({
        ...empty(),
        jobs: [
          moverJob('j1', { state: 'completed', updatedAt: THEN - 1 }),
          moverJob('j2', { state: 'completed', updatedAt: THEN, stats: { ...moverJob('j').stats, done: 9 } }),
        ],
      }),
    );

    expect(await db.jobs.get('j1')).toMatchObject({ state: 'paused' });
    expect((await db.jobs.get('j2'))?.stats.done).toBe(9);
    expect(result.updated.jobs).toBe(1);
  });

  it('adds log lines, page loads, risk events and checks only when they aren’t here yet', async () => {
    await db.logs.add(moverLog());
    await db.risk.add({ accountId: MOVER, kind: 'rate_limited', at: THEN });
    const result = await imported(
      await fileOf({
        ...empty(),
        logs: [moverLog(), moverLog({ ts: THEN - 1, message: 'Another' })],
        risk: [
          { accountId: MOVER, kind: 'rate_limited', at: THEN },
          { accountId: MOVER, kind: 'lock', at: THEN - 5 },
        ],
      }),
    );
    expect(result.added.logs).toBe(1);
    expect(result.added.risk).toBe(1);
    expect(await db.risk.count()).toBe(2);
  });

  it('keeps the settings set up here, and takes the file’s inside the safety rules when there are none', async () => {
    const fast = {
      preset: 'custom',
      pacing: { delete: { minDelay: 0, maxDelay: 0, batchSize: 1000, hourlyCap: 100_000, dailyCap: 100_000 } },
      notifications: false,
    };
    await imported(await fileOf({ ...empty(), kv: [{ key: 'settings', value: fast }] }));
    const stored = await kvGet<Settings | null>('settings', null);
    expect(stored?.notifications).toBe(false);
    expect(stored?.pacing.delete.hourlyCap).toBeLessThanOrEqual(PRESETS.careful.delete.hourlyCap);
    expect(stored?.pacing.delete.minDelay).toBeGreaterThanOrEqual(PRESETS.careful.delete.minDelay);

    await imported(await fileOf({ ...empty(), kv: [{ key: 'settings', value: { notifications: true } }] }));
    expect((await kvGet<Settings | null>('settings', null))?.notifications).toBe(false);
  });

  it('keeps the lower daily view cap, so a move never lets Xomoni read more', async () => {
    await kvSet(`viewCap:${MOVER}`, { cap: 500, seen: 600, learnedAt: THEN });
    const value = (cap: number) => ({ key: `viewCap:${MOVER}`, value: { cap, seen: cap, learnedAt: THEN } });
    await imported(await fileOf({ ...empty(), kv: [value(900)] }));
    expect((await getViewCap(MOVER))?.cap).toBe(500);
    await imported(await fileOf({ ...empty(), kv: [value(300)] }));
    expect((await getViewCap(MOVER))?.cap).toBe(300);
  });

  it('keeps Watch as set up here; takes the file’s searches and results only where there are none', async () => {
    await kvSet(`watchTabs:${MOVER}`, [{ id: 'tab-1', query: 'mine' }]);
    const theirs = [
      { key: `watchTabs:${MOVER}`, value: [{ id: 'tab-1', query: 'theirs' }] },
      { key: `watchResults:${MOVER}`, value: { 'tab-1': { query: 'theirs', checkedAt: THEN, posts: [], error: '' } } },
      { key: `watchTabs:${OTHER}`, value: [{ id: 'tab-1', query: 'other' }] },
    ];
    await imported(await fileOf({ ...empty(), kv: theirs }));
    expect(await kvGet(`watchTabs:${MOVER}`, null)).toEqual([{ id: 'tab-1', query: 'mine' }]);
    expect(await kvGet(`watchResults:${MOVER}`, null)).toBeNull();
    expect(await kvGet(`watchTabs:${OTHER}`, null)).toEqual([
      { id: 'tab-1', query: 'other' },
      { id: 'tab-2', query: '' },
    ]);
  });

  it('keeps the later archive import and the later archive request', async () => {
    await kvSet(`archive:${MOVER}`, true);
    await kvSet(`archiveRequest:${MOVER}`, { requestedAt: THEN, checkedAt: THEN, downloadedAt: null });
    const older = { requestedAt: THEN - 10, checkedAt: THEN, downloadedAt: null };
    await imported(
      await fileOf({
        ...empty(),
        kv: [
          { key: `archive:${MOVER}`, value: THEN - 5 },
          { key: `archiveRequest:${MOVER}`, value: older },
        ],
      }),
    );
    expect(await kvGet(`archive:${MOVER}`, null)).toBe(THEN - 5);
    expect(await kvGet(`archiveRequest:${MOVER}`, null)).toMatchObject({ requestedAt: THEN });

    await imported(await fileOf({ ...empty(), kv: [{ key: `archive:${MOVER}`, value: THEN }] }));
    expect(await kvGet(`archive:${MOVER}`, null)).toBe(THEN);
  });

  it('keeps the newer of X’s limits, believing a reset at most a day ahead', async () => {
    const limit = (at: number, reset: number) => ({
      key: `${MOVER}:Likes`,
      accountId: MOVER,
      op: 'Likes',
      limit: 500,
      remaining: 10,
      reset,
      status: 200,
      at,
    });
    await db.limits.put(limit(THEN, THEN + 1000));
    await imported(await fileOf({ ...empty(), limits: [limit(THEN - 1, THEN + 5000)] }));
    expect((await db.limits.get(`${MOVER}:Likes`))?.reset).toBe(THEN + 1000);
    await imported(await fileOf({ ...empty(), limits: [limit(THEN + 1, NOW + 5 * 86_400_000)] }));
    expect((await db.limits.get(`${MOVER}:Likes`))?.reset).toBe(NOW + 86_400_000);
  });
});

describe('the offer on a new install (#300)', () => {
  it('shows while Xomoni hasn’t done anything here, until dismissed', async () => {
    expect(await moveOfferShown()).toBe(true);
    await db.items.put(moverItem('1000000001'));
    expect(await moveOfferShown()).toBe(true);

    await dismissMoveOffer();
    expect(await moveOfferShown()).toBe(false);
  });

  it('doesn’t show once there is a job or a line in the log', async () => {
    await db.jobs.put(moverJob('j'));
    expect(await moveOfferShown()).toBe(false);
    await resetDb();
    await db.logs.add(moverLog());
    expect(await moveOfferShown()).toBe(false);
  });
});

describe('the import’s result, until the person dismisses it (#357)', () => {
  it('keeps what the import did, with the version it came from, until dismissed', async () => {
    await seedEverything();
    const file = await exported();
    await resetDb();
    expect(await importNotice()).toBeNull();

    const result = await imported(file);

    expect(await importNotice()).toEqual({ app: '0.4.1', at: NOW, result });
    // Still there for the next page that asks, until the person dismisses it.
    expect(await importNotice()).toEqual({ app: '0.4.1', at: NOW, result });
    await dismissImportNotice();
    expect(await importNotice()).toBeNull();
  });

  it('keeps it in the import’s own transaction: the log line that ends the offer never lands without it', async () => {
    await seedEverything();
    const file = await exported();
    await resetDb();
    const original = db.kv.put.bind(db.kv);
    db.kv.put = (...args: Parameters<typeof original>) => {
      if (args[0].key === 'moveImported') throw new Error('disk full');
      return original(...args);
    };
    try {
      await expect(importData(file, NOW)).rejects.toThrow('disk full');
    } finally {
      db.kv.put = original;
    }

    // All of it, or none: no log line ends the offer while the result is missing.
    expect(await db.logs.count()).toBe(0);
    expect(await db.items.count()).toBe(0);
    expect(await moveOfferShown()).toBe(true);
    expect(await importNotice()).toBeNull();
  });

  it('keeps nothing when the import is refused', async () => {
    await seedEverything();
    const file = await exported();
    await resetDb();
    const runner = await holdRunnerLock();

    expect(await importData(file, NOW)).toBe('busy');

    expect(await importNotice()).toBeNull();
    await runner.release();
  });

  it('never goes into a move file, and Delete local data clears it', async () => {
    await seedEverything();
    const file = await exported();
    await resetDb();
    await imported(file);

    const { text } = await exportData({ app: '0.5.0', now: NOW });
    expect(text).not.toContain('moveImported');

    await wipeLocalData();
    expect(await importNotice()).toBeNull();
  });

  it('reads a value out of shape as none, so a damaged one never breaks the page', async () => {
    for (const value of [
      'imported',
      { app: 4, at: NOW, result: { added: {}, updated: {} } },
      { app: '0.4.1', at: NOW },
      { app: '0.4.1', at: NOW, result: { added: { items: 1 }, updated: { items: 0 } } },
    ]) {
      await kvSet('moveImported', value);
      expect(await importNotice()).toBeNull();
    }
  });
});

describe('the vault in a move (#424, version 2)', () => {
  it('carries every vault row of the old Xomoni into an empty one, unchanged', async () => {
    await seedEverything();
    const before = await snapshot();
    const file = await exported();
    for (const table of VAULT_TABLE_NAMES) expect(file.data[table].length, table).toBeGreaterThan(0);
    await resetDb();

    const result = await imported(file);
    const after = await snapshot();
    for (const table of VAULT_TABLE_NAMES) expect(after[table], table).toEqual(before[table]);
    expect(result.added).toMatchObject({ vaultImports: 1, analyticsPosts: 1, analyticsDays: 1, accountEvents: 2 });
  });

  it('exports one account’s vault alone', async () => {
    await seedEverything();
    await db.vaultImports.put(moverImport({ accountId: OTHER }));
    await db.analyticsPosts.put(moverAnalyticsPost('7', { accountId: OTHER, key: analyticsPostKey(OTHER, '7') }));
    await db.analyticsDays.put(moverAnalyticsDay('2026-11-01', { accountId: OTHER }));
    await db.accountEvents.add(moverEvent({ accountId: OTHER }));

    const { data } = await exported(MOVER);
    for (const table of VAULT_TABLE_NAMES) {
      const rows = data[table] as { accountId: string }[];
      expect(rows.length, table).toBeGreaterThan(0);
      expect(
        rows.every((r) => r.accountId === MOVER),
        table,
      ).toBe(true);
    }
    expect(data.accountEvents.every((e) => !('seq' in e))).toBe(true);
  });

  it('adds nothing to the vault the second time the same file is imported', async () => {
    await seedEverything();
    const file = await exported();
    await resetDb();
    await imported(file);
    const again = await imported(file);
    for (const table of VAULT_TABLE_NAMES) {
      expect(again.added[table], table).toBe(0);
      expect(again.updated[table], table).toBe(0);
    }
    expect(await db.accountEvents.count()).toBe(2);
  });

  it('merges each vault table by its rule, and never deletes what is here', async () => {
    // Here: a ledger row the file also has (changed there), one of its own, a post with higher likes, an older day.
    await db.vaultImports.bulkPut([
      moverImport(),
      moverImport({ importedAt: THEN - 5_000, source: 'x-analytics-days', parser: 'x-analytics-days@1' }),
    ]);
    await db.analyticsPosts.put(
      moverAnalyticsPost('1000000001', { likes: 50, impressions: 900, asOf: THEN - 9_000_000 }),
    );
    await db.analyticsDays.put(moverAnalyticsDay('2026-11-19', { impressions: 10, asOf: THEN - 9_000_000 }));
    await db.accountEvents.bulkAdd([moverEvent(), moverEvent({ words: 'Only here.', at: THEN - 60_000 })]);

    const result = await imported(
      await fileOf({
        ...empty(),
        vaultImports: [moverImport({ bytes: 1 }), moverImport({ importedAt: THEN - 9_000 })],
        analyticsPosts: [moverAnalyticsPost('1000000001', { likes: 9, impressions: 1_200, asOf: THEN - 3_600_000 })],
        analyticsDays: [moverAnalyticsDay('2026-11-19', { impressions: 3_000 })],
        accountEvents: [moverEvent(), moverEvent({ kind: 'premium_on', source: 'profile', words: 'X Premium on.' })],
      }),
    );

    expect(result.added).toMatchObject({ vaultImports: 1, analyticsPosts: 0, analyticsDays: 0, accountEvents: 1 });
    expect(result.updated).toMatchObject({ vaultImports: 0, analyticsPosts: 1, analyticsDays: 1, accountEvents: 0 });
    // The ledger is joined by id: the row here stays as it is.
    expect(await db.vaultImports.count()).toBe(3);
    expect((await db.vaultImports.get(moverImport().id))?.bytes).toBe(moverImport().bytes);
    // A post keeps the highest of each number, never lower, with the newer date.
    expect(await db.analyticsPosts.get(analyticsPostKey(MOVER, '1000000001'))).toMatchObject({
      likes: 50,
      impressions: 1_200,
      asOf: THEN - 3_600_000,
    });
    // A day takes the newer import's numbers.
    expect((await db.analyticsDays.get([MOVER, '2026-11-19']))?.impressions).toBe(3_000);
    // The timeline gains what it lacked and keeps its own.
    expect((await db.accountEvents.toArray()).map((e) => e.words).sort()).toEqual(
      ['Asked X about the label.', 'Only here.', 'X Premium on.'].sort(),
    );
  });

  it('brings a file from a Xomoni before the vault in, leaving the vault here as it is', async () => {
    await db.accountEvents.add(moverEvent());
    const { vaultImports: _a, analyticsPosts: _b, analyticsDays: _c, accountEvents: _d, ...core } = empty();
    const checked = await checkMoveText(await signedFile({ ...core, accounts: [moverAccount()] }, { version: 1 }), NOW);
    if (!checked.ok) throw new Error(checked.message);
    const result = await imported(checked.file);
    expect(result.added.accounts).toBe(1);
    expect(result.added.accountEvents).toBe(0);
    expect(await db.accountEvents.count()).toBe(1);
  });

  it('writes nothing to the vault while a job runs', async () => {
    await seedEverything();
    const file = await exported();
    await resetDb();
    const lock = await holdRunnerLock();
    try {
      expect(await importData(file, NOW)).toBe('busy');
    } finally {
      await lock.release();
    }
    for (const table of VAULT_TABLE_NAMES) expect(await db.table(table).count(), table).toBe(0);
  });

  it('reads an import’s result kept before version 2 with no vault counts as nothing added to the vault', async () => {
    const core = Object.fromEntries(
      MOVE_TABLES.filter((t) => !(VAULT_TABLE_NAMES as readonly string[]).includes(t)).map((t) => [t, 1]),
    );
    await kvSet('moveImported', { app: '0.5.0', at: NOW, result: { added: core, updated: core } });
    const notice = await importNotice();
    expect(notice?.result.added).toMatchObject({ items: 1, vaultImports: 0, accountEvents: 0 });
  });
});
