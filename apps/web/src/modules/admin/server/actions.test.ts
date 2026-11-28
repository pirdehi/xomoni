import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, GRACE_ID, fakeConsoleStore } from '@test/fakes/admin-console';
import { NavigationThrow } from '@test/fakes/navigation';
import { redirectOf } from '@test/server-helpers';
import { revalidatePath } from 'next/cache';
import { ADMIN_PROBLEM_MESSAGES, AdminError } from '../domain/problems';
import { requireSuperadmin } from './access';
import { deleteUserAccount, setUserSuspended, signOutUserEverywhere } from './actions';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('./access', () => ({ requireSuperadmin: vi.fn() }));

function signedInAs(store = fakeConsoleStore()) {
  vi.mocked(requireSuperadmin).mockResolvedValue({ admin: ADMIN, store });
  return store;
}

beforeEach(() => {
  vi.mocked(requireSuperadmin).mockReset();
  vi.mocked(revalidatePath).mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('console actions (#516)', () => {
  it('signs an account out everywhere, says how many sessions ended, and refreshes the console', async () => {
    const store = signedInAs();
    expect(await signOutUserEverywhere(GRACE_ID)).toEqual({ done: 'Signed out everywhere: 3 sessions ended.' });
    expect(requireSuperadmin).toHaveBeenCalledWith(`/product/users/${GRACE_ID}`);
    expect(store.signOutUser).toHaveBeenCalledWith(GRACE_ID);
    expect(revalidatePath).toHaveBeenCalledWith('/product', 'layout');
  });

  it('suspends and restores an account', async () => {
    const store = signedInAs();
    expect(await setUserSuspended(GRACE_ID, true)).toEqual({ done: 'Suspended: the account can’t sign in.' });
    expect(await setUserSuspended(GRACE_ID, false)).toEqual({ done: 'Restored: the account can sign in again.' });
    expect(store.setBanned.mock.calls).toEqual([
      [GRACE_ID, true],
      [GRACE_ID, false],
    ]);
  });

  it('deletes an account once its email is typed, then goes back to the users list', async () => {
    const store = signedInAs();
    expect(await redirectOf(deleteUserAccount(GRACE_ID, 'grace@example.com'))).toBe('/product/users');
    expect(store.deleteUser).toHaveBeenCalledWith(GRACE_ID);
    expect(revalidatePath).toHaveBeenCalledWith('/product', 'layout');
  });

  it('deletes nothing when the email doesn’t match', async () => {
    const store = signedInAs();
    expect(await deleteUserAccount(GRACE_ID, 'someone@example.com')).toEqual({
      error: ADMIN_PROBLEM_MESSAGES['confirm-mismatch'],
    });
    expect(store.deleteUser).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('checks the caller first: anyone but a super-admin gets the 404 and nothing happens', async () => {
    vi.mocked(requireSuperadmin).mockRejectedValue(new NavigationThrow('not-found'));
    expect(await redirectOf(signOutUserEverywhere(GRACE_ID))).toBe('not-found');
    expect(await redirectOf(setUserSuspended(GRACE_ID, true))).toBe('not-found');
    expect(await redirectOf(deleteUserAccount(GRACE_ID, 'grace@example.com'))).toBe('not-found');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('refuses the super-admin’s own account and another super-admin’s, with plain words', async () => {
    const store = signedInAs();
    expect(await signOutUserEverywhere(ADMIN.id)).toEqual({ error: ADMIN_PROBLEM_MESSAGES.self });
    expect(store.signOutUser).not.toHaveBeenCalled();

    signedInAs(fakeConsoleStore({ user: vi.fn(() => Promise.resolve({ ...fakeUser(), superadmin: true })) }));
    expect(await setUserSuspended(GRACE_ID, true)).toEqual({ error: ADMIN_PROBLEM_MESSAGES.superadmin });
  });

  it('turns the database’s refusal into plain words, logging only unexpected failures', async () => {
    signedInAs(
      fakeConsoleStore({ setBanned: vi.fn(() => Promise.reject(new AdminError('forbidden', 'Not allowed.'))) }),
    );
    expect(await setUserSuspended(GRACE_ID, true)).toEqual({ error: ADMIN_PROBLEM_MESSAGES.forbidden });
    expect(console.error).not.toHaveBeenCalled();

    signedInAs(fakeConsoleStore({ signOutUser: vi.fn(() => Promise.reject(new Error('network'))) }));
    expect(await signOutUserEverywhere(GRACE_ID)).toEqual({ error: ADMIN_PROBLEM_MESSAGES.failed });
    expect(console.error).toHaveBeenCalledWith('console: sign out everywhere failed', 'network');
  });

  it('refuses input that can’t be an account or a choice before checking anything', async () => {
    for (const target of [undefined, '', 42, 'x'.repeat(200)]) {
      expect((await signOutUserEverywhere(target)).error).toBeDefined();
      expect((await setUserSuspended(target, true)).error).toBeDefined();
      expect((await deleteUserAccount(target, 'a@b.c')).error).toBeDefined();
    }
    expect((await setUserSuspended(GRACE_ID, 'yes')).error).toBe(ADMIN_PROBLEM_MESSAGES.failed);
    expect((await deleteUserAccount(GRACE_ID, null)).error).toBe(ADMIN_PROBLEM_MESSAGES['confirm-mismatch']);
    expect(requireSuperadmin).not.toHaveBeenCalled();
  });
});

function fakeUser() {
  return {
    id: GRACE_ID,
    email: 'grace@example.com',
    createdAt: '',
    lastSignInAt: null,
    confirmed: true,
    providers: [],
    mfa: false,
    banned: false,
    superadmin: false,
    plan: null,
    choices: { dailyStats: false, weeklyEmail: false, healthAlert: false },
    devices: [],
    jobs: [],
    sessionCount: 0,
    sessions: [],
  };
}
