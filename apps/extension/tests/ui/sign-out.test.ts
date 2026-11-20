// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, itemKey, kvSet, upsertAccount } from '../../src/shared/db';
import { checkMoveText } from '../../src/shared/move-file';
import { getSignedOut } from '../../src/shared/session';
import type { Job } from '../../src/shared/types';
import { SIGNED_OUT_PAUSE } from '../../src/ui/hooks';
import {
  type SignOutDeps,
  X_SIGN_OUT,
  accountCopy,
  finishSignOut,
  finishSignOutMadeElsewhere,
  signOut,
} from '../../src/ui/sign-out';
import { stubChrome } from '../support/chrome';
import { account, resetDb } from '../support/fixtures';

const ME = account();

/** Fake steps that record their order; `runningFor` is how many checks a job still runs for. */
function fakeDeps(runningFor = 0, cloud: 'disconnected' | 'forgotten-here' | 'idle' = 'disconnected') {
  const steps: string[] = [];
  let checks = 0;
  const deps: SignOutDeps = {
    pause: vi.fn((reason: string) => void steps.push(`pause:${reason}`)),
    running: vi.fn(() => Promise.resolve(checks++ < runningFor)),
    disconnect: vi.fn(() => {
      steps.push('disconnect');
      return Promise.resolve(cloud);
    }),
    closeWorker: vi.fn(() => {
      steps.push('close');
      return Promise.resolve();
    }),
    stopSharing: vi.fn(() => void steps.push('stop sharing')),
    openTab: vi.fn((url: string) => {
      steps.push(`open:${url}`);
      return Promise.resolve();
    }),
    sleep: vi.fn(() => Promise.resolve()),
  };
  return { deps, steps };
}

async function storeAccountData() {
  await upsertAccount(ME);
  await db.items.put({ key: itemKey(ME.id, 'post', '1'), accountId: ME.id, kind: 'post', id: '1' } as never);
  await db.jobs.put({
    id: 'j1',
    accountId: ME.id,
    state: 'paused',
    createdAt: 1,
    title: 'Old posts',
  } as unknown as Job);
}

beforeEach(async () => {
  stubChrome();
  await resetDb();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('signOut (#226)', () => {
  it('records the sign-out, pauses the job, stops sharing, disconnects and closes the X window, in that order', async () => {
    const { deps, steps } = fakeDeps();

    const result = await signOut(ME, { removeData: false, signOutOfX: false }, deps);

    expect(result).toEqual({ cloud: 'disconnected', stopped: true });
    expect(steps).toEqual([`pause:${SIGNED_OUT_PAUSE}`, 'stop sharing', 'disconnect', 'close']);
    expect(await getSignedOut()).toMatchObject({ handle: 'me', dataKept: true });
    expect(deps.openTab).not.toHaveBeenCalled();
  });

  it('keeps the account’s data unless asked to remove it', async () => {
    await storeAccountData();

    await signOut(ME, { removeData: false, signOutOfX: false }, fakeDeps().deps);

    expect(await db.accounts.get(ME.id)).toBeDefined();
    expect(await db.items.count()).toBe(1);
  });

  it('removes the account’s data once its job stopped, and says so on the signed-out page', async () => {
    await storeAccountData();
    const { deps } = fakeDeps(3);

    const result = await signOut(ME, { removeData: true, signOutOfX: false }, deps);

    expect(result.stopped).toBe(true);
    expect(deps.sleep).toHaveBeenCalledTimes(3);
    expect(await db.accounts.get(ME.id)).toBeUndefined();
    expect(await db.items.count()).toBe(0);
    expect(await db.jobs.count()).toBe(0);
    expect(await getSignedOut()).toMatchObject({ dataKept: false });
  });

  it('keeps the data when a job is still finishing after the wait, so it can’t be written back half-removed', async () => {
    await storeAccountData();
    const { deps } = fakeDeps(Infinity);

    const result = await signOut(ME, { removeData: true, signOutOfX: false }, deps, 1_000);

    expect(result).toEqual({ cloud: 'disconnected', stopped: false });
    expect(await db.accounts.get(ME.id)).toBeDefined();
    expect(await getSignedOut()).toMatchObject({ dataKept: true });
    expect(deps.disconnect).toHaveBeenCalled();
  });

  it('opens X’s own sign-out page last when asked', async () => {
    const { deps, steps } = fakeDeps();

    await signOut(ME, { removeData: false, signOutOfX: true }, deps);

    expect(steps.at(-1)).toBe(`open:${X_SIGN_OUT}`);
    expect(X_SIGN_OUT).toBe('https://x.com/logout');
  });

  it('still signs out when xomoni.com can’t be told, or the X window or X’s page won’t open', async () => {
    const { deps } = fakeDeps();
    deps.disconnect = vi.fn(() => Promise.reject(new Error('offline')));
    deps.closeWorker = vi.fn(() => Promise.reject(new Error('gone')));
    deps.openTab = vi.fn(() => Promise.reject(new Error('refused')));

    const result = await signOut(ME, { removeData: false, signOutOfX: true }, deps);

    expect(result.cloud).toBe('forgotten-here');
    expect(await getSignedOut()).not.toBeNull();
  });
});

describe('finishing a sign-out made elsewhere (#232)', () => {
  it('waits for the job to stop, then stops sharing and closes the X window', async () => {
    const { deps, steps } = fakeDeps(3);

    await finishSignOut(deps);

    expect(deps.sleep).toHaveBeenCalledTimes(3);
    expect(steps).toEqual(['stop sharing', 'close']);
    expect(deps.disconnect).not.toHaveBeenCalled();
    expect(deps.openTab).not.toHaveBeenCalled();
  });

  it('closes the X window after the wait even if a job still runs, and when closing fails', async () => {
    const { deps } = fakeDeps(Number.POSITIVE_INFINITY);
    deps.closeWorker = vi.fn(() => Promise.reject(new Error('gone')));

    await finishSignOut(deps, 1000);

    expect(deps.sleep).toHaveBeenCalledTimes(4);
    expect(deps.closeWorker).toHaveBeenCalled();
  });

  it('runs for a sign-out made elsewhere, and leaves one made in this tab’s dialog to the dialog', async () => {
    const finish = vi.fn(() => Promise.resolve());
    finishSignOutMadeElsewhere({ at: 1, handle: 'me', dataKept: true }, finish);
    expect(finish).toHaveBeenCalledTimes(1);

    const { deps } = fakeDeps();
    await signOut(ME, { removeData: false, signOutOfX: false }, deps);
    const here = await getSignedOut();
    finishSignOutMadeElsewhere(here!, finish);
    expect(finish).toHaveBeenCalledTimes(1);
  });
});

describe('accountCopy (#226)', () => {
  it('writes one account’s data in the file Export everything writes, without other accounts, ready to import', async () => {
    const X = '1234567890';
    await upsertAccount(account({ id: X, handle: 'mover' }));
    await db.items.put({ key: itemKey(X, 'post', '1'), accountId: X, kind: 'post', id: '1' } as never);
    await db.jobs.put({
      id: 'j1',
      accountId: X,
      kind: 'cleanup',
      state: 'paused',
      createdAt: 1,
      title: 'Old posts',
    } as Job);
    await upsertAccount(account({ id: '2', handle: 'other' }));
    await db.items.put({ key: itemKey('2', 'post', '2'), accountId: '2', kind: 'post', id: '2' } as never);
    await kvSet('activeAccount', X);
    await kvSet(`viewCap:${X}`, { cap: 100, seen: 120, learnedAt: 1 });

    const now = new Date();
    const text = await accountCopy(X, now);
    const checked = await checkMoveText(text);

    if (!checked.ok) throw new Error(checked.message);
    expect(checked.file.exportedAt).toBe(now.toISOString());
    expect(checked.file.app).toBe('0.3.0');
    const { data } = checked.file;
    expect(data.accounts.map((a) => a.id)).toEqual([X]);
    expect(data.items).toEqual([expect.objectContaining({ accountId: X })]);
    expect(data.jobs).toEqual([expect.objectContaining({ id: 'j1' })]);
    expect(data.logs).toEqual([]);
    // Its own values come along; the browser's (the active account) stay.
    expect(data.kv.map((v) => v.key)).toEqual([`viewCap:${X}`]);
  });
});
