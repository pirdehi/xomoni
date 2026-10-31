import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Limiter } from '../src/engine/limiter';
import { db } from '../src/shared/db';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

const ACCOUNT = 'acct-1';
const limiter = () => new Limiter(DEFAULT_SETTINGS, ACCOUNT, new AbortController().signal, () => {});

beforeEach(async () => {
  await Promise.all([db.reads.clear(), db.logs.clear(), db.limits.clear()]);
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
