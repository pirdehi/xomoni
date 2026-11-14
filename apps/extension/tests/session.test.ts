import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jobRunning } from '../src/engine/runner';
import { db, forgetAccount, itemKey, kvGet, kvSet, setViewCap, upsertAccount } from '../src/shared/db';
import { getSignedOut, markSignedOut, signIn } from '../src/shared/session';
import type { Job } from '../src/shared/types';
import { account, resetDb } from './support/fixtures';

beforeEach(resetDb);
afterEach(() => vi.unstubAllGlobals());

const ME = 'acct-me';
const OTHER = 'acct-other';

/** Stores everything Xomoni keeps for an account: a post, a job, a log line, limits, a check, consent and kv values. */
async function fill(accountId: string) {
  await upsertAccount(account({ id: accountId, handle: accountId }));
  await db.items.put({
    key: itemKey(accountId, 'post', '1'),
    accountId,
    kind: 'post',
    id: '1',
    createdAt: 1,
    status: 'present',
    sources: ['scan'],
  } as never);
  await db.jobs.put({ id: `job-${accountId}`, accountId, state: 'paused', createdAt: 1 } as unknown as Job);
  await db.logs.add({ accountId, ts: 5, level: 'info', kind: 'system', message: 'hi' } as never);
  await db.limits.put({ key: `${accountId}:DeleteTweet`, accountId } as never);
  await db.checks.add({ accountId, dueAt: 9 } as never);
  await db.consents.put({ accountId, version: 1, at: 1 });
  await kvSet(`watchTabs:${accountId}`, []);
  await kvSet(`archive:${accountId}`, 1);
  await kvSet(`archiveRequest:${accountId}`, { at: 1 });
  await kvSet(`archiveFilesSeen:${accountId}`, ['a']);
  await setViewCap(accountId, { posts: 100 } as never);
  await db.reads.add({ accountId, budget: 'read', ts: 1 });
  await db.risk.add({ accountId, at: 1 } as never);
}

describe('signing out of Xomoni (#226)', () => {
  it('starts signed in, and remembers a sign-out with its handle and whether the data stayed', async () => {
    expect(await getSignedOut()).toBeNull();

    await markSignedOut('me', false, 42);

    expect(await getSignedOut()).toEqual({ at: 42, handle: 'me', dataKept: false });
  });

  it('reads an unusable stored value as signed in, and a missing dataKept as kept', async () => {
    await kvSet('signedOut', 'yes');
    expect(await getSignedOut()).toBeNull();

    await kvSet('signedOut', { at: 7 });
    expect(await getSignedOut()).toEqual({ at: 7, handle: '', dataKept: true });
  });

  it('signs in again with the X window’s account: forgets the sign-out and makes it the active account', async () => {
    await markSignedOut('me', true);

    await signIn('1000', 'newme');

    expect(await getSignedOut()).toBeNull();
    expect(await kvGet('activeAccount', null)).toBe('1000');
    expect(await db.accounts.get('1000')).toMatchObject({ id: '1000', handle: 'newme' });
  });
});

describe('forgetAccount (#226)', () => {
  it('removes one account’s data and every kv value kept for it', async () => {
    await fill(ME);
    await kvSet('activeAccount', ME);

    await forgetAccount(ME);

    expect(await db.accounts.get(ME)).toBeUndefined();
    expect(await db.items.where('accountId').equals(ME).count()).toBe(0);
    expect(await db.jobs.where('accountId').equals(ME).count()).toBe(0);
    expect(await db.logs.count()).toBe(0);
    expect(await db.limits.count()).toBe(0);
    expect(await db.checks.count()).toBe(0);
    expect(await db.consents.get(ME)).toBeUndefined();
    for (const name of ['watchTabs', 'archive', 'archiveRequest', 'archiveFilesSeen'])
      expect(await db.kv.get(`${name}:${ME}`)).toBeUndefined();
    expect(await kvGet('activeAccount', null)).toBeNull();
  });

  it('keeps what holds X’s limits: page loads, the risk ladder and the view cap', async () => {
    await fill(ME);

    await forgetAccount(ME);

    expect(await db.reads.count()).toBe(1);
    expect(await db.risk.count()).toBe(1);
    expect(await db.kv.get(`viewCap:${ME}`)).toBeDefined();
  });

  it('leaves other accounts, settings and the active account when it is another one', async () => {
    await fill(ME);
    await fill(OTHER);
    await kvSet('settings', { preset: 'careful' });
    await kvSet('activeAccount', OTHER);

    await forgetAccount(ME);

    expect(await db.accounts.get(OTHER)).toBeDefined();
    expect(await db.items.where('accountId').equals(OTHER).count()).toBe(1);
    expect(await db.jobs.where('accountId').equals(OTHER).count()).toBe(1);
    expect(await db.logs.where('[accountId+ts]').between([OTHER, 0], [OTHER, Infinity]).count()).toBe(1);
    expect(await db.consents.get(OTHER)).toBeDefined();
    expect(await db.kv.get(`watchTabs:${OTHER}`)).toBeDefined();
    expect(await kvGet('settings', null)).toEqual({ preset: 'careful' });
    expect(await kvGet('activeAccount', null)).toBe(OTHER);
  });

  it('doesn’t take an account whose id ends like another’s for it', async () => {
    await kvSet('watchTabs:x-acct-me', []);

    await forgetAccount(ME);

    expect(await db.kv.get('watchTabs:x-acct-me')).toBeDefined();
  });
});

describe('jobRunning (#226)', () => {
  const locks = (names: string[]) =>
    vi.stubGlobal('navigator', { locks: { query: () => Promise.resolve({ held: names.map((name) => ({ name })) }) } });

  it('is true while some dashboard tab holds the runner’s lock', async () => {
    locks(['xomoni-runner']);
    expect(await jobRunning()).toBe(true);
  });

  it('is false when no one holds it, whatever other locks are held', async () => {
    locks(['something-else']);
    expect(await jobRunning()).toBe(false);
    vi.stubGlobal('navigator', { locks: { query: () => Promise.resolve({}) } });
    expect(await jobRunning()).toBe(false);
  });
});
