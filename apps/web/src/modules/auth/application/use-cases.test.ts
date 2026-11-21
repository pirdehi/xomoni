import { describe, expect, it, vi } from 'vitest';
import { ADA_PHONE, fakeTwoFactorGateway } from '@test/server-helpers';
import { authFailure, type AuthResult } from '../domain/auth-error';
import type { AuthGateway, FactorList, TwoFactorGateway } from './ports';
import * as useCases from './use-cases';

const SITE = 'https://xomoni.test';
const ok = async (): Promise<AuthResult> => ({ ok: true });
const GOOD_PASSWORD = 'correct horse 42';

/** A gateway whose every method succeeds unless overridden; calls are recorded with vi.fn. */
function fakeGateway(overrides: Partial<AuthGateway> = {}): AuthGateway {
  return {
    currentClaims: vi.fn(async () => ({ sub: 'u1', email: 'ada@example.com' })),
    currentAccount: vi.fn(async () => ({ email: 'ada@example.com', pendingEmail: null })),
    startOAuth: vi.fn(async (_provider: 'google', redirectTo: string) => ({
      ok: true as const,
      url: `https://accounts.google.test/?r=${encodeURIComponent(redirectTo)}`,
    })),
    exchangeCode: vi.fn(ok),
    signUp: vi.fn(ok),
    signInWithPassword: vi.fn(ok),
    sendPasswordReset: vi.fn(ok),
    resendConfirmation: vi.fn(ok),
    verifyEmailLink: vi.fn(ok),
    updatePassword: vi.fn(ok),
    changeEmail: vi.fn(ok),
    signOut: vi.fn(async () => {}),
    deleteAccount: vi.fn(ok),
    ...overrides,
  };
}

/** Ada's account with an authenticator app (#173). */
const WITH_APP: FactorList = { verified: [ADA_PHONE], unverified: [] };

const deps = (
  overrides: Partial<AuthGateway> = {},
  factors: FactorList | null = { verified: [], unverified: [] },
  twoFactor: Partial<TwoFactorGateway> = {},
) => ({ auth: fakeGateway(overrides), twoFactor: fakeTwoFactorGateway(factors, twoFactor), siteUrl: SITE });
const signedOut = { currentClaims: async () => null, currentAccount: async () => null };
const atAal2 = { currentClaims: async () => ({ sub: 'u1', email: 'ada@example.com', aal: 'aal2' }) };

describe('session', () => {
  it('getViewer returns null when signed out and maps claims otherwise', async () => {
    expect(await useCases.getViewer(deps(signedOut))).toBeNull();
    expect(await useCases.getViewer(deps())).toMatchObject({ id: 'u1', email: 'ada@example.com' });
  });

  it('getAccount adds the pending email from the provider', async () => {
    const account = await useCases.getAccount(
      deps({ currentAccount: async () => ({ email: 'ada@example.com', pendingEmail: 'new@example.com' }) }),
    );
    expect(account).toMatchObject({ id: 'u1', email: 'ada@example.com', pendingEmail: 'new@example.com' });
  });

  it('getAccount lists the account’s authenticator apps, verified only (#173)', async () => {
    const account = await useCases.getAccount(deps(atAal2, { verified: [ADA_PHONE], unverified: ['f-abandoned'] }));
    expect(account?.secondFactors).toEqual([ADA_PHONE]);
  });

  it('getAccount is null when the provider no longer knows the session', async () => {
    expect(await useCases.getAccount(deps({}, null))).toBeNull();
  });
});

describe('getSessionState (#173)', () => {
  it('is signed out without verified claims, and asks nothing more', async () => {
    const d = deps(signedOut, WITH_APP);
    expect(await useCases.getSessionState(d)).toEqual({ status: 'signed_out' });
    expect(d.twoFactor.factors).not.toHaveBeenCalled();
  });

  it('is signed in at aal1 when the account has no authenticator app', async () => {
    expect(await useCases.getSessionState(deps())).toMatchObject({ status: 'signed_in', viewer: { id: 'u1' } });
  });

  it('owes a code at aal1 when the account has one', async () => {
    expect(await useCases.getSessionState(deps({}, WITH_APP))).toMatchObject({
      status: 'second_factor_needed',
      viewer: { email: 'ada@example.com' },
    });
  });

  it('treats an app never confirmed as none', async () => {
    const abandoned = { verified: [], unverified: ['f-abandoned'] };
    expect(await useCases.getSessionState(deps({}, abandoned))).toMatchObject({ status: 'signed_in' });
  });

  it('is signed in at aal2 without asking the provider about apps', async () => {
    const d = deps(atAal2, WITH_APP);
    expect(await useCases.getSessionState(d)).toMatchObject({ status: 'signed_in' });
    expect(d.twoFactor.factors).not.toHaveBeenCalled();
  });

  it('counts an unknown or forged level as aal1', async () => {
    const forged = { currentClaims: async () => ({ sub: 'u1', aal: 'AAL2 ' }) };
    expect(await useCases.getSessionState(deps(forged, WITH_APP))).toMatchObject({ status: 'second_factor_needed' });
  });

  it('is signed out when the provider no longer knows the session', async () => {
    expect(await useCases.getSessionState(deps({}, null))).toEqual({ status: 'signed_out' });
  });

  it('nextAfterSignIn goes to the code page first when one is owed, keeping a same-site next', async () => {
    expect(await useCases.nextAfterSignIn(deps({}, WITH_APP), '/connect')).toBe('/login/two-factor?next=%2Fconnect');
    expect(await useCases.nextAfterSignIn(deps({}, WITH_APP), 'https://evil.example')).toBe('/login/two-factor');
    expect(await useCases.nextAfterSignIn(deps(), '/connect')).toBe('/connect');
  });
});

describe('verifyWithAnyFactor (#173)', () => {
  it('tries each app until one takes the code', async () => {
    const verify = vi.fn(async (id: string) => (id === 'f2' ? { ok: true as const } : authFailure('invalid_code')));
    const twoFactor = fakeTwoFactorGateway(WITH_APP, { verify });
    expect(await useCases.verifyWithAnyFactor(twoFactor, ['f1', 'f2', 'f3'], '123456')).toEqual({ ok: true });
    expect(verify.mock.calls.map(([id]) => id)).toEqual(['f1', 'f2']);
  });

  it('stops at once on a failure that isn’t about the code, such as too many tries', async () => {
    const verify = vi.fn(async () => authFailure('rate_limited'));
    const twoFactor = fakeTwoFactorGateway(WITH_APP, { verify });
    expect(await useCases.verifyWithAnyFactor(twoFactor, ['f1', 'f2'], '123456')).toMatchObject({
      code: 'rate_limited',
    });
    expect(verify).toHaveBeenCalledOnce();
  });

  it('fails with the last wrong code when no app takes it, and without any app to try', async () => {
    const twoFactor = fakeTwoFactorGateway(WITH_APP, { verify: async () => authFailure('invalid_code') });
    expect(await useCases.verifyWithAnyFactor(twoFactor, ['f1', 'f2'], '000000')).toMatchObject({
      code: 'invalid_code',
    });
    expect(await useCases.verifyWithAnyFactor(twoFactor, [], '000000')).toMatchObject({ code: 'factor_not_found' });
  });
});

describe('OAuth', () => {
  it('returns to /auth/callback on this site with a sanitized next path', async () => {
    const d = deps();
    await useCases.startOAuthSignIn(d, 'google', '//evil.example');
    expect(d.auth.startOAuth).toHaveBeenCalledWith('google', `${SITE}/auth/callback?next=%2Fdashboard`);
  });

  it('keeps a same-site next path', async () => {
    const d = deps();
    await useCases.startOAuthSignIn(d, 'google', '/dashboard?tab=jobs');
    expect(d.auth.startOAuth).toHaveBeenCalledWith('google', `${SITE}/auth/callback?next=%2Fdashboard%3Ftab%3Djobs`);
  });

  it('fails without a code and never calls the provider', async () => {
    const d = deps();
    const result = await useCases.completeOAuthSignIn(d, { code: null, next: null, error: 'access_denied' });
    expect(result).toMatchObject({ ok: false, code: 'provider_error' });
    expect(d.auth.exchangeCode).not.toHaveBeenCalled();
  });

  it('lands on the sanitized next path', async () => {
    const result = await useCases.completeOAuthSignIn(deps(), { code: 'c', next: 'https://evil.example', error: null });
    expect(result).toEqual({ ok: true, next: '/dashboard' });
  });

  it('goes to the code page first for an account with an authenticator app (#173)', async () => {
    const result = await useCases.completeOAuthSignIn(deps({}, WITH_APP), { code: 'c', next: '/account', error: null });
    expect(result).toEqual({ ok: true, next: '/login/two-factor?next=%2Faccount' });
  });

  it('keeps the failure of a code exchange', async () => {
    const d = deps({ exchangeCode: async () => authFailure('link_invalid_or_expired') });
    expect(await useCases.completeOAuthSignIn(d, { code: 'c', next: null, error: null })).toMatchObject({
      code: 'link_invalid_or_expired',
    });
  });
});

describe('signUp', () => {
  it('rejects invalid input without calling the provider', async () => {
    const d = deps();
    const result = await useCases.signUp(d, { email: 'nope', password: 'short' });
    expect(result).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(!result.ok && result.fieldErrors).toMatchObject({
      email: expect.any(String),
      password: expect.any(String),
    });
    expect(d.auth.signUp).not.toHaveBeenCalled();
  });

  it('normalizes the email and sends links to /auth/confirm', async () => {
    const d = deps();
    const result = await useCases.signUp(d, {
      name: ' Ada ',
      email: ' Ada@Example.com ',
      password: GOOD_PASSWORD,
      captchaToken: 'tok',
    });
    expect(result).toEqual({ ok: true, email: 'ada@example.com' });
    expect(d.auth.signUp).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: GOOD_PASSWORD,
      name: 'Ada',
      captchaToken: 'tok',
      emailRedirectTo: `${SITE}/auth/confirm`,
      next: '/dashboard',
    });
  });

  it('keeps where the person was going for the emailed link, but only on this site (#244)', async () => {
    const d = deps();
    const input = { email: 'ada@example.com', password: GOOD_PASSWORD };
    await useCases.signUp(d, { ...input, next: '/connect' });
    expect(d.auth.signUp).toHaveBeenLastCalledWith(expect.objectContaining({ next: '/connect' }));
    await useCases.signUp(d, { ...input, next: 'https://evil.example/' });
    expect(d.auth.signUp).toHaveBeenLastCalledWith(expect.objectContaining({ next: '/dashboard' }));
  });

  it('answers the same way when the account already exists (no enumeration)', async () => {
    const result = await useCases.signUp(deps({ signUp: async () => authFailure('account_exists') }), {
      email: 'ada@example.com',
      password: GOOD_PASSWORD,
    });
    expect(result).toEqual({ ok: true, email: 'ada@example.com' });
  });

  it('shows captcha failures', async () => {
    const result = await useCases.signUp(deps({ signUp: async () => authFailure('captcha_failed') }), {
      email: 'ada@example.com',
      password: GOOD_PASSWORD,
    });
    expect(result).toMatchObject({ ok: false, code: 'captcha_failed' });
  });
});

describe('signInWithPassword', () => {
  it('passes provider failures through', async () => {
    const result = await useCases.signInWithPassword(
      deps({ signInWithPassword: async () => authFailure('email_not_confirmed') }),
      { email: 'ada@example.com', password: 'x' },
    );
    expect(result).toMatchObject({ ok: false, code: 'email_not_confirmed' });
  });

  it('returns a sanitized next path', async () => {
    const d = deps();
    expect(await useCases.signInWithPassword(d, { email: 'ada@example.com', password: 'x', next: '/account' })).toEqual(
      {
        ok: true,
        next: '/account',
      },
    );
    expect(await useCases.signInWithPassword(d, { email: 'ada@example.com', password: 'x', next: '//evil' })).toEqual({
      ok: true,
      next: '/dashboard',
    });
  });

  it('goes to the code page first when the account has an authenticator app, keeping next (#173)', async () => {
    const d = deps({}, WITH_APP);
    expect(await useCases.signInWithPassword(d, { email: 'ada@example.com', password: 'x', next: '/account' })).toEqual(
      { ok: true, next: '/login/two-factor?next=%2Faccount' },
    );
    expect(await useCases.signInWithPassword(d, { email: 'ada@example.com', password: 'x' })).toEqual({
      ok: true,
      next: '/login/two-factor',
    });
  });

  it('requires a password', async () => {
    expect(await useCases.signInWithPassword(deps(), { email: 'ada@example.com', password: '' })).toMatchObject({
      code: 'invalid_input',
      fieldErrors: { password: 'Enter your password' },
    });
  });
});

describe('password reset and resend (no enumeration)', () => {
  it.each(['requestPasswordReset', 'resendConfirmation'] as const)(
    '%s hides provider errors that could leak',
    async (name) => {
      const method = name === 'requestPasswordReset' ? 'sendPasswordReset' : 'resendConfirmation';
      const result = await useCases[name](deps({ [method]: async () => authFailure('email_unusable') }), {
        email: 'ghost@example.com',
      });
      expect(result).toEqual({ ok: true, email: 'ghost@example.com' });
    },
  );

  it.each(['rate_limited', 'captcha_failed'] as const)('shows %s, which leaks nothing', async (code) => {
    const result = await useCases.requestPasswordReset(deps({ sendPasswordReset: async () => authFailure(code) }), {
      email: 'ada@example.com',
    });
    expect(result).toMatchObject({ ok: false, code });
  });

  it('sends reset links to /auth/confirm', async () => {
    const d = deps();
    await useCases.requestPasswordReset(d, { email: 'ada@example.com', captchaToken: 't' });
    expect(d.auth.sendPasswordReset).toHaveBeenCalledWith({
      email: 'ada@example.com',
      captchaToken: 't',
      redirectTo: `${SITE}/auth/confirm`,
    });
  });
});

describe('confirmEmailLink', () => {
  const tokenHash = 'a'.repeat(56);

  it('rejects malformed links before calling the provider', async () => {
    const d = deps();
    expect(await useCases.confirmEmailLink(d, { token_hash: 'x', type: 'email' })).toMatchObject({
      code: 'link_invalid_or_expired',
    });
    expect(await useCases.confirmEmailLink(d, { token_hash: tokenHash, type: 'phone_change' })).toMatchObject({
      code: 'link_invalid_or_expired',
    });
    expect(d.auth.verifyEmailLink).not.toHaveBeenCalled();
  });

  it('sends recovery links to the reset page by default and keeps next on this site', async () => {
    expect(await useCases.confirmEmailLink(deps(), { token_hash: tokenHash, type: 'recovery' })).toEqual({
      ok: true,
      next: '/reset-password',
    });
    expect(
      await useCases.confirmEmailLink(deps(), { token_hash: tokenHash, type: 'email', next: 'https://evil.example' }),
    ).toEqual({ ok: true, next: '/dashboard' });
  });

  it('reports expired links', async () => {
    const result = await useCases.confirmEmailLink(
      deps({ verifyEmailLink: async () => authFailure('link_invalid_or_expired') }),
      { token_hash: tokenHash, type: 'email' },
    );
    expect(result).toMatchObject({ ok: false, code: 'link_invalid_or_expired' });
  });
});

describe('passwords while signed in', () => {
  it('setNewPassword enforces the policy and needs a session', async () => {
    expect(await useCases.setNewPassword(deps(), { password: 'onlyletters' })).toMatchObject({ code: 'invalid_input' });
    expect(await useCases.setNewPassword(deps(signedOut), { password: GOOD_PASSWORD })).toMatchObject({
      code: 'not_signed_in',
    });
    const d = deps();
    expect(await useCases.setNewPassword(d, { password: GOOD_PASSWORD })).toEqual({ ok: true });
    expect(d.auth.updatePassword).toHaveBeenCalledWith(GOOD_PASSWORD);
  });

  it('changePassword checks the current password before changing it', async () => {
    const d = deps({ signInWithPassword: async () => authFailure('invalid_credentials') });
    const result = await useCases.changePassword(d, { currentPassword: 'wrong', newPassword: GOOD_PASSWORD });
    expect(result).toMatchObject({
      code: 'wrong_current_password',
      fieldErrors: { currentPassword: 'Incorrect password' },
    });
    expect(d.auth.updatePassword).not.toHaveBeenCalled();
  });

  it('changePassword re-authenticates as the signed-in email, then updates', async () => {
    const d = deps();
    const result = await useCases.changePassword(d, {
      currentPassword: 'old password 1',
      newPassword: GOOD_PASSWORD,
      captchaToken: 't',
    });
    expect(result).toEqual({ ok: true });
    expect(d.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'old password 1',
      captchaToken: 't',
    });
    // The current password goes with the change too, so the provider can check it itself (#148).
    expect(d.auth.updatePassword).toHaveBeenCalledWith(GOOD_PASSWORD, 'old password 1');
  });

  describe('with an authenticator app (#173)', () => {
    const input = { currentPassword: 'old password 1', newPassword: GOOD_PASSWORD, captchaToken: 't' };

    it('asks for a code before signing in again, so a missing one changes nothing', async () => {
      const d = deps({}, WITH_APP);
      expect(await useCases.changePassword(d, input)).toMatchObject({
        code: 'invalid_input',
        fieldErrors: { code: expect.any(String) },
      });
      expect(d.auth.signInWithPassword).not.toHaveBeenCalled();
      expect(d.auth.updatePassword).not.toHaveBeenCalled();
    });

    it('verifies the code on the new session, then changes the password', async () => {
      const d = deps({}, WITH_APP);
      expect(await useCases.changePassword(d, { ...input, code: '123 456' })).toEqual({ ok: true });
      expect(d.twoFactor.verify).toHaveBeenCalledWith('f1', '123456');
      const order = [d.auth.signInWithPassword, d.twoFactor.verify, d.auth.updatePassword].map(
        (fn) => vi.mocked(fn).mock.invocationCallOrder[0],
      );
      expect(order).toEqual([...order].sort((a = 0, b = 0) => a - b));
    });

    it('keeps the old password when the code is wrong', async () => {
      const d = deps({}, WITH_APP, { verify: async () => authFailure('invalid_code') });
      expect(await useCases.changePassword(d, { ...input, code: '000000' })).toMatchObject({
        code: 'invalid_code',
        fieldErrors: { code: expect.any(String) },
      });
      expect(d.auth.updatePassword).not.toHaveBeenCalled();
    });

    it('passes on other failures of the code as they are', async () => {
      const d = deps({}, WITH_APP, { verify: async () => authFailure('rate_limited') });
      expect(await useCases.changePassword(d, { ...input, code: '000000' })).toMatchObject({ code: 'rate_limited' });
      expect(d.auth.updatePassword).not.toHaveBeenCalled();
    });

    it('needs a session the provider still knows', async () => {
      expect(await useCases.changePassword(deps({}, null), { ...input, code: '123456' })).toMatchObject({
        code: 'not_signed_in',
      });
    });
  });

  it('changePassword refuses reusing the current password', async () => {
    expect(
      await useCases.changePassword(deps(), { currentPassword: GOOD_PASSWORD, newPassword: GOOD_PASSWORD }),
    ).toMatchObject({ code: 'invalid_input', fieldErrors: { newPassword: expect.any(String) } });
  });
});

describe('changeEmail', () => {
  it('refuses the current address', async () => {
    expect(await useCases.changeEmail(deps(), { email: 'ADA@example.com' })).toMatchObject({
      code: 'invalid_input',
      fieldErrors: { email: expect.any(String) },
    });
  });

  it('starts the change with links to /auth/confirm', async () => {
    const d = deps();
    expect(await useCases.changeEmail(d, { email: 'new@example.com' })).toEqual({ ok: true, email: 'new@example.com' });
    expect(d.auth.changeEmail).toHaveBeenCalledWith({
      email: 'new@example.com',
      emailRedirectTo: `${SITE}/auth/confirm`,
    });
  });

  it('needs a session', async () => {
    expect(await useCases.changeEmail(deps(signedOut), { email: 'new@example.com' })).toMatchObject({
      code: 'not_signed_in',
    });
  });
});

describe('deleteAccount', () => {
  it('refuses when signed out and deletes nothing', async () => {
    const d = deps(signedOut);
    expect(await useCases.deleteAccount(d)).toMatchObject({ ok: false, code: 'not_signed_in' });
    expect(d.auth.deleteAccount).not.toHaveBeenCalled();
  });

  it('signs out after deleting', async () => {
    const d = deps();
    expect(await useCases.deleteAccount(d)).toEqual({ ok: true });
    expect(d.auth.signOut).toHaveBeenCalledOnce();
  });

  it('refuses a session that owes a code from the account’s authenticator app, and deletes nothing (#173)', async () => {
    const d = deps({}, WITH_APP);
    expect(await useCases.deleteAccount(d)).toMatchObject({ ok: false, code: 'second_factor_required' });
    expect(d.auth.deleteAccount).not.toHaveBeenCalled();
  });

  it('deletes after a verified code', async () => {
    const d = deps(atAal2, WITH_APP);
    expect(await useCases.deleteAccount(d)).toEqual({ ok: true });
  });

  it('keeps the session when deletion fails', async () => {
    const d = deps({ deleteAccount: async () => authFailure('unknown', 'db down') });
    expect(await useCases.deleteAccount(d)).toMatchObject({ ok: false, code: 'unknown' });
    expect(d.auth.signOut).not.toHaveBeenCalled();
  });
});

describe('signOut (#83)', () => {
  it('ends only this session by default', async () => {
    const d = deps();
    await useCases.signOut(d);
    expect(d.auth.signOut).toHaveBeenCalledWith(false);
  });

  it('ends every session when asked to', async () => {
    const d = deps();
    await useCases.signOut(d, { everywhere: true });
    expect(d.auth.signOut).toHaveBeenCalledWith(true);
  });
});
