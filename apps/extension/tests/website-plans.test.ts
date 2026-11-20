import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CleanupPlan, PLAN, READ } from '@xomoni/bridge';
import { type CloudConnection, saveConnection } from '../src/cloud/connection';
import type { ActionPorts } from '../src/cloud/website-actions';
import { answerPlan, describePlan, estimatePlan, toFilter } from '../src/cloud/website-plans';
import { answerRead } from '../src/cloud/website-reads';
import { clearPlannedCleanup, plannedCleanup, PLAN_FRESH_MS, savePlannedCleanup } from '../src/shared/cleanup-plan';
import { db, kvSet, markArchiveImported, upsertAccount } from '../src/shared/db';
import { markSignedOut } from '../src/shared/session';
import { PRESETS } from '../src/shared/settings';
import { stubChrome } from './support/chrome';
import { draft, seed } from './support/cleanup-pages';
import { ME, account, resetDb } from './support/fixtures';

const DEVICE = '0b5e0b9e-7c1a-4d55-9a53-8f3f6a1c2d3e';
const CONNECTED: CloudConnection = {
  deviceId: DEVICE,
  token: 'tok',
  deviceName: 'Chrome',
  connectedAt: 1,
  reportedUpTo: 0,
  account: 'a•••@example.com',
  confirmed: true,
};

const PLAN_2019: CleanupPlan = {
  target: 'post',
  before: Date.UTC(2019, 0, 1),
  after: null,
  keepMinLikes: 100,
  keepKeywords: [' Launch '],
  skipSelfReplies: true,
};

let ports: ActionPorts & { openDashboard: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  stubChrome();
  await resetDb();
  await saveConnection(CONNECTED);
  await upsertAccount(account());
  await kvSet('activeAccount', ME);
  await seed([
    draft({ id: '1000000001', createdAt: Date.UTC(2018, 0, 10), text: 'Plain old post', likes: 2 }),
    draft({ id: '1000000002', createdAt: Date.UTC(2018, 2, 10), text: 'Our LAUNCH day', likes: 3 }),
    draft({ id: '1000000003', createdAt: Date.UTC(2018, 4, 10), text: 'Went viral', likes: 120 }),
    draft({ id: '1000000004', createdAt: Date.UTC(2020, 4, 10), text: 'Newer post' }),
  ]);
  ports = { openDashboard: vi.fn(() => Promise.resolve()) };
});
afterEach(() => vi.unstubAllGlobals());

describe('a plan from xomoni.com (#235)', () => {
  it('becomes the rules of a cleanup, keywords lowercased, no ids kept', () => {
    expect(toFilter(PLAN_2019)).toEqual({
      target: 'post',
      before: PLAN_2019.before,
      after: null,
      keepMinLikes: 100,
      keepKeywords: ['launch'],
      keepIds: [],
      skipSelfReplies: true,
    });
  });

  it('is described in the log’s words, keeping only what applies to its target', () => {
    expect(describePlan(PLAN_2019)).toBe('posts older than 2019-01-01, keeping 100+ likes, 1 words');
    expect(describePlan({ ...PLAN_2019, target: 'reply', after: Date.UTC(2015, 0, 1), keepKeywords: [] })).toBe(
      'replies older than 2019-01-01, from 2015-01-01, keeping 100+ likes, your threads',
    );
    expect(describePlan({ ...PLAN_2019, target: 'like', keepKeywords: [] })).toBe('likes older than 2019-01-01');
  });

  it('carries the posts picked on xomoni.com, counts and logs them (#256)', async () => {
    const picked: CleanupPlan = { ...PLAN_2019, before: Date.UTC(2026, 0, 1), keepMinLikes: null, keepKeywords: [] };
    const two = { ...picked, onlyIds: ['1000000001', '1000000004'] };
    expect(toFilter(two).onlyIds).toEqual(['1000000001', '1000000004']);
    expect(toFilter(picked)).not.toHaveProperty('onlyIds');
    expect(describePlan(two)).toBe('2 posts picked on xomoni.com');
    expect(describePlan({ ...two, target: 'reply', onlyIds: ['1'], skipSelfReplies: false })).toBe(
      '1 reply picked on xomoni.com',
    );
    // Only the picked ones match, of the four posts that would match by date.
    await expect(estimatePlan(two)).resolves.toMatchObject({ matching: 2 });
    await expect(answerPlan({ type: PLAN, deviceId: DEVICE, plan: two }, ports)).resolves.toEqual({
      ok: true,
      outcome: 'opened',
    });
    expect((await plannedCleanup())?.filter.onlyIds).toEqual(['1000000001', '1000000004']);
    expect((await db.logs.toArray()).at(-1)?.message).toContain('2 posts picked on xomoni.com');
  });

  it('is estimated from Xomoni’s copy: counts only, with the archive and the pace per day', async () => {
    expect(await estimatePlan(PLAN_2019)).toEqual({
      handle: 'me',
      matching: 1,
      archive: false,
      perDay: PRESETS.careful.delete.dailyCap,
    });
    await markArchiveImported(ME);
    const all = await answerRead({
      type: READ,
      what: 'cleanup',
      deviceId: DEVICE,
      plan: { ...PLAN_2019, keepMinLikes: null, keepKeywords: [] },
    });
    expect(all).toEqual({
      ok: true,
      what: 'cleanup',
      estimate: { handle: 'me', matching: 3, archive: true, perDay: PRESETS.careful.delete.dailyCap },
    });
  });

  it('estimates nothing while Xomoni knows no account', async () => {
    await db.accounts.clear();
    await db.kv.delete('activeAccount');
    expect(await estimatePlan(PLAN_2019)).toMatchObject({ handle: '', matching: 0, archive: false });
  });

  it('is kept for the Cleanup page, logged, and that page opened: no job is made', async () => {
    const answer = await answerPlan({ type: PLAN, deviceId: DEVICE, plan: PLAN_2019 }, ports);
    expect(answer).toEqual({ ok: true, outcome: 'opened' });
    expect(ports.openDashboard).toHaveBeenCalledWith('cleanup');
    expect(await plannedCleanup()).toMatchObject({ accountId: ME, filter: toFilter(PLAN_2019) });
    expect(await db.jobs.count()).toBe(0);
    const [entry] = await db.logs.toArray();
    expect(entry?.message).toBe(
      'Cleanup planned on xomoni.com: posts older than 2019-01-01, keeping 100+ likes, 1 words. Waiting for you to review it in Xomoni.',
    );
  });

  it('is refused for another account, while signed out, or without an X account, and nothing opens', async () => {
    const other = '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
    expect(await answerPlan({ type: PLAN, deviceId: other, plan: PLAN_2019 }, ports)).toEqual({
      ok: false,
      reason: 'other_account',
    });
    await markSignedOut('me', true);
    expect(await answerPlan({ type: PLAN, deviceId: DEVICE, plan: PLAN_2019 }, ports)).toEqual({
      ok: false,
      reason: 'signed_out',
    });
    await db.kv.delete('signedOut');
    await db.accounts.clear();
    await db.kv.delete('activeAccount');
    expect((await answerPlan({ type: PLAN, deviceId: DEVICE, plan: PLAN_2019 }, ports)).ok).toBe(false);
    expect(ports.openDashboard).not.toHaveBeenCalled();
    expect(await plannedCleanup()).toBeNull();
  });
});

describe('the plan waiting for the Cleanup page (#235)', () => {
  const planned = (at: number) => ({ accountId: ME, filter: toFilter(PLAN_2019), at });

  it('waits a quarter of an hour, then is ignored', async () => {
    const at = Date.now();
    await savePlannedCleanup(planned(at));
    expect(await plannedCleanup(at + PLAN_FRESH_MS)).toEqual(planned(at));
    expect(await plannedCleanup(at + PLAN_FRESH_MS + 1)).toBeNull();
  });

  it('ignores anything stored that isn’t a plan', async () => {
    for (const value of [null, 'plan', { accountId: ME, at: 1 }, { ...planned(Date.now()), filter: { target: 'x' } }]) {
      await kvSet('websitePlan', value);
      expect(await plannedCleanup()).toBeNull();
    }
  });

  it('is forgotten once taken, but a newer plan stays', async () => {
    await savePlannedCleanup(planned(1000));
    await savePlannedCleanup(planned(Date.now()));
    await clearPlannedCleanup(1000);
    expect(await plannedCleanup()).not.toBeNull();
    const { at } = (await plannedCleanup())!;
    await clearPlannedCleanup(at);
    expect(await plannedCleanup()).toBeNull();
  });
});
