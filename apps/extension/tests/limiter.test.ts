import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Limiter } from '../src/engine/limiter';
import { db, upsertAccount } from '../src/shared/db';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { readFactor } from '../src/shared/x-limits';

const ACCOUNT = 'acct-1';
const limiter = () => new Limiter(DEFAULT_SETTINGS, ACCOUNT, new AbortController().signal, () => {});

beforeEach(async () => {
  await Promise.all([db.reads.clear(), db.logs.clear(), db.limits.clear(), db.accounts.clear()]);
});

describe('Limiter slowdown (#57)', () => {
  it('is not eased by page loads or scrolls', () => {
    const l = limiter();
    l.easeIn();
    for (let i = 0; i < 20; i++) l.after('read', 'done', 'userTimeline');
    expect(l.slowdown).toBe(2);
  });

  it('is eased by successful actions on X', () => {
    const l = limiter();
    l.easeIn();
    l.after('delete', 'done');
    expect(l.slowdown).toBeCloseTo(1.9);
  });

  it('grows after rate limits and failures, up to 6', () => {
    const l = limiter();
    for (let i = 0; i < 10; i++) l.after('delete', 'rate_limited');
    expect(l.slowdown).toBe(6);
  });
});

describe('Limiter memory across runs', () => {
  it('counts page loads from earlier runs (#57)', async () => {
    const first = limiter();
    await first.init();
    for (let i = 0; i < 5; i++) first.after('read', 'done', 'search');
    await new Promise((r) => setTimeout(r, 20)); // page loads are saved in the background

    const second = limiter();
    await second.init();
    expect(second.usage('read')).toEqual({ hour: 5, day: 5 });
  });

  it('counts successful actions from the activity log', async () => {
    const now = Date.now();
    await db.logs.bulkAdd([
      {
        ts: now - 1000,
        accountId: ACCOUNT,
        jobId: 'j',
        level: 'info',
        action: 'unlike',
        targetId: '1',
        outcome: 'done',
        message: '',
      },
      {
        ts: now - 2000,
        accountId: ACCOUNT,
        jobId: 'j',
        level: 'info',
        action: 'unlike',
        targetId: '2',
        outcome: 'failed',
        message: '',
      },
      {
        ts: now - 2 * 86_400_000,
        accountId: ACCOUNT,
        jobId: 'j',
        level: 'info',
        action: 'unlike',
        targetId: '3',
        outcome: 'done',
        message: '',
      },
    ] as never);
    const l = limiter();
    await l.init();
    expect(l.usage('unlike')).toEqual({ hour: 1, day: 1 });
  });

  it('forgets page loads older than a day', async () => {
    await db.reads.add({ accountId: ACCOUNT, budget: 'search', ts: Date.now() - 2 * 86_400_000 });
    await limiter().init();
    expect(await db.reads.count()).toBe(0);
  });
});

describe('Limiter: page loads by account type (#33, PLAYBOOK A6)', () => {
  it('halves page loads for an account not known to be Premium, and keeps the ceiling for Premium', async () => {
    expect([readFactor(true), readFactor(false), readFactor(null), readFactor(undefined)]).toEqual([1, 0.5, 0.5, 0.5]);

    const unknown = limiter();
    await unknown.init();
    expect(unknown.readShare).toBe(0.5);

    await upsertAccount({ id: ACCOUNT, handle: 'me', verified: false });
    const unverified = limiter();
    await unverified.init();
    expect(unverified.readShare).toBe(0.5);

    await upsertAccount({ id: ACCOUNT, verified: true });
    const premium = limiter();
    await premium.init();
    expect(premium.readShare).toBe(1);
  });
});

describe('Limiter: the one-fifth ceiling at run time', () => {
  it('counts failed requests against X’s budget but not as successes', () => {
    const l = limiter();
    l.after('delete', 'failed');
    l.after('delete', 'already');
    l.after('delete', 'done');
    l.after('delete', 'skipped');
    expect(l.spent('deletePost')).toBe(3);
    expect(l.usage('delete')).toEqual({ hour: 1, day: 1 });
  });

  it('makes a ghost-like cleanup spend the unlike budget too', () => {
    const l = limiter();
    l.after('relike', 'done');
    expect(l.spent('like')).toBe(1);
    expect(l.spent('unlike')).toBe(1);
  });

  it('starts a new account on warm-up day 1 and reaches day 4 after three active days', async () => {
    const fresh = limiter();
    await fresh.init();
    expect(fresh.warmup).toEqual({ day: 1, days: 4, factor: 0.25 });

    const day = 86_400_000;
    const log = (ts: number) => ({
      ts,
      accountId: ACCOUNT,
      jobId: 'j',
      level: 'info',
      action: 'delete',
      targetId: String(ts),
      outcome: 'done',
      message: '',
    });
    await db.logs.bulkAdd([log(Date.now() - day), log(Date.now() - 2 * day), log(Date.now() - 3 * day)] as never);
    const seasoned = limiter();
    await seasoned.init();
    expect(seasoned.warmup.factor).toBe(1);
  });
});

describe('Limiter and the risk ladder (#17)', () => {
  const day = 86_400_000;
  const doneLog = (ts: number) => ({
    ts,
    accountId: ACCOUNT,
    jobId: 'j',
    level: 'info',
    action: 'delete',
    targetId: String(ts),
    outcome: 'done',
    message: '',
  });

  beforeEach(async () => {
    await db.risk.clear();
  });

  it('slows a seasoned account to a quarter after a lock and drops the warm-up a step', async () => {
    const now = Date.now();
    await db.logs.bulkAdd([doneLog(now - day), doneLog(now - 2 * day), doneLog(now - 3 * day)] as never);
    await db.risk.add({ accountId: ACCOUNT, kind: 'lock', at: now - 60_000 });
    const l = limiter();
    await l.init();
    expect(l.risk.level).toBe(3);
    expect(l.warmup.day).toBe(3);
    expect(l.paceFactor).toBeCloseTo(0.75 * 0.25);
  });

  it('runs at full one fifth with no warnings on a seasoned account', async () => {
    const now = Date.now();
    await db.logs.bulkAdd([doneLog(now - day), doneLog(now - 2 * day), doneLog(now - 3 * day)] as never);
    const l = limiter();
    await l.init();
    expect(l.paceFactor).toBe(1);
  });
});
