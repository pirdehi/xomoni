import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADA_PHONE,
  AT_AAL2,
  SIGNED_OUT,
  fakeAuthGateway,
  fakeTwoFactorGateway,
  redirectOf,
} from '@test/server-helpers';
import type { AuthGateway, FactorList } from '../application/ports';
import { AUTH_ERROR_MESSAGES, authFailure } from '../domain/auth-error';
import { deleteAccount } from './actions';
import { authDeps } from './deps';

vi.mock('./deps', () => ({ authDeps: vi.fn() }));

let gateway: AuthGateway;

function session(overrides: Partial<AuthGateway> = {}, factors?: FactorList) {
  gateway = fakeAuthGateway(overrides);
  vi.mocked(authDeps).mockResolvedValue({
    auth: gateway,
    twoFactor: fakeTwoFactorGateway(factors),
    siteUrl: 'http://localhost:3000',
  });
}

const WITH_APP: FactorList = { verified: [ADA_PHONE], unverified: [] };

describe('deleteAccount (Server Action)', () => {
  beforeEach(() => {
    vi.mocked(authDeps).mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deletes the account, signs out and goes home with a notice', async () => {
    session();

    expect(await redirectOf(deleteAccount())).toBe('/?account=deleted');
    expect(gateway.deleteAccount).toHaveBeenCalledOnce();
    expect(gateway.signOut).toHaveBeenCalledOnce();
  });

  it('re-checks the session itself: a signed-out caller goes to sign in and nothing is deleted', async () => {
    session(SIGNED_OUT);

    expect(await redirectOf(deleteAccount())).toBe('/login');
    expect(gateway.deleteAccount).not.toHaveBeenCalled();
    expect(gateway.signOut).not.toHaveBeenCalled();
  });

  it('sends a session that owes a code from the account’s authenticator app to the code page, deleting nothing (#173)', async () => {
    session({}, WITH_APP);

    expect(await redirectOf(deleteAccount())).toBe('/login/two-factor?next=%2Faccount');
    expect(gateway.deleteAccount).not.toHaveBeenCalled();
    expect(gateway.signOut).not.toHaveBeenCalled();
  });

  it('deletes the account of a session that verified a code', async () => {
    session(AT_AAL2, WITH_APP);

    expect(await redirectOf(deleteAccount())).toBe('/?account=deleted');
    expect(gateway.deleteAccount).toHaveBeenCalledOnce();
  });

  it('sends the person to the code page when the database asks for one too', async () => {
    session({ deleteAccount: vi.fn(() => Promise.resolve(authFailure('second_factor_required', 'aal1'))) });

    expect(await redirectOf(deleteAccount())).toBe('/login/two-factor?next=%2Faccount');
    expect(gateway.signOut).not.toHaveBeenCalled();
  });

  it('builds fresh dependencies for every call, so one request never reuses another’s session', async () => {
    session();
    await redirectOf(deleteAccount());
    session(SIGNED_OUT);
    await redirectOf(deleteAccount());

    expect(authDeps).toHaveBeenCalledTimes(2);
  });

  it('asks to sign in again when the sign-in is not recent enough (#80), and keeps the session', async () => {
    session({ deleteAccount: vi.fn(() => Promise.resolve(authFailure('reauthentication_needed', 'too old'))) });

    const state = await deleteAccount();

    expect(state).toEqual({
      error: expect.stringContaining('sign in again first'),
      reauthenticate: true,
    });
    expect(gateway.signOut).not.toHaveBeenCalled();
  });

  it('shows a generic message for an unexpected failure and logs the provider detail only', async () => {
    session({
      deleteAccount: vi.fn(() => Promise.resolve(authFailure('unknown', 'permission denied for table users'))),
    });

    const state = await deleteAccount();

    expect(state).toEqual({ error: AUTH_ERROR_MESSAGES.unknown });
    expect(state.reauthenticate).toBeUndefined();
    expect(JSON.stringify(state)).not.toContain('permission denied');
    expect(console.error).toHaveBeenCalledWith('delete account failed', 'permission denied for table users');
    expect(gateway.signOut).not.toHaveBeenCalled();
  });

  it('propagates a failure to build the request’s dependencies instead of acting', async () => {
    vi.mocked(authDeps).mockRejectedValue(new Error('cookies unavailable'));

    await expect(deleteAccount()).rejects.toThrow('cookies unavailable');
  });
});
