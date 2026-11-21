import { describe, expect, it, vi } from 'vitest';
import { ADA, ADA_PHONE, fakeAuthGateway, fakeTwoFactorGateway } from '@test/server-helpers';
import { authFailure } from '../domain/auth-error';
import type { AuthGateway, FactorList, TwoFactorGateway } from './ports';
import {
  cancelEnrollment,
  confirmEnrollment,
  listSecondFactors,
  removeSecondFactor,
  startEnrollment,
  verifySecondFactor,
} from './two-factor';

const WITH_APP: FactorList = { verified: [ADA_PHONE], unverified: [] };
const NONE: FactorList = { verified: [], unverified: [] };
const AAL2: Partial<AuthGateway> = { currentClaims: () => Promise.resolve({ ...ADA, aal: 'aal2' }) };

function deps(factors: FactorList | null, twoFactor: Partial<TwoFactorGateway> = {}, auth: Partial<AuthGateway> = {}) {
  return { auth: fakeAuthGateway(auth), twoFactor: fakeTwoFactorGateway(factors, twoFactor) };
}

describe('verifySecondFactor: the code after sign-in', () => {
  it('verifies the code, spaces dropped, and goes on to the same-site next', async () => {
    const d = deps(WITH_APP);
    expect(await verifySecondFactor(d, { code: '123 456', next: '/account' })).toEqual({ ok: true, next: '/account' });
    expect(d.twoFactor.verify).toHaveBeenCalledWith('f1', '123456');
  });

  it('never follows a next to another site', async () => {
    expect(await verifySecondFactor(deps(WITH_APP), { code: '123456', next: '//evil.example' })).toEqual({
      ok: true,
      next: '/dashboard',
    });
  });

  it.each([
    ['empty', ''],
    ['letters', '12a456'],
    ['too short', '12345'],
    ['too long', '1234567'],
    ['missing', undefined],
  ])('refuses a code that is %s without asking the provider', async (_label, code) => {
    const d = deps(WITH_APP);
    expect(await verifySecondFactor(d, { code })).toMatchObject({
      code: 'invalid_input',
      fieldErrors: { code: expect.any(String) },
    });
    expect(d.twoFactor.verify).not.toHaveBeenCalled();
  });

  it('says a wrong code is wrong, on the field', async () => {
    const d = deps(WITH_APP, { verify: () => Promise.resolve(authFailure('invalid_code', 'mfa_verification_failed')) });
    expect(await verifySecondFactor(d, { code: '000000' })).toMatchObject({
      ok: false,
      code: 'invalid_code',
      fieldErrors: { code: 'That code didn’t work' },
    });
  });

  it('passes on an expired or used challenge, and too many tries, as they are', async () => {
    for (const code of ['code_expired', 'rate_limited'] as const) {
      const d = deps(WITH_APP, { verify: () => Promise.resolve(authFailure(code)) });
      expect(await verifySecondFactor(d, { code: '123456' })).toMatchObject({ code });
    }
  });

  it('needs a session', async () => {
    expect(await verifySecondFactor(deps(null), { code: '123456' })).toMatchObject({ code: 'not_signed_in' });
  });

  it('goes on when the app was removed elsewhere: nothing is owed any more', async () => {
    const d = deps(NONE);
    expect(await verifySecondFactor(d, { code: '123456', next: '/account' })).toEqual({ ok: true, next: '/account' });
    expect(d.twoFactor.verify).not.toHaveBeenCalled();
  });
});

describe('listSecondFactors', () => {
  it('lists the verified apps, or fails when signed out', async () => {
    expect(await listSecondFactors(deps(WITH_APP))).toEqual({ ok: true, factors: [ADA_PHONE] });
    expect(await listSecondFactors(deps(null))).toMatchObject({ code: 'not_signed_in' });
  });
});

describe('startEnrollment', () => {
  it('names the first app by default and returns its QR code and secret', async () => {
    const d = deps(NONE);
    const result = await startEnrollment(d, {});
    expect(result).toMatchObject({ ok: true, enrollment: { factorId: 'f-new', secret: 'JBSWY3DPEHPK3PXP' } });
    expect(d.twoFactor.enroll).toHaveBeenCalledWith('Authenticator app');
  });

  it('takes the name the person gave, trimmed', async () => {
    const d = deps(NONE);
    await startEnrollment(d, { name: '  1Password ' });
    expect(d.twoFactor.enroll).toHaveBeenCalledWith('1Password');
  });

  it('removes an abandoned enrollment first, so it holds neither the name nor a place', async () => {
    const d = deps({ verified: [], unverified: ['f-old', 'f-older'] });
    await startEnrollment(d, {});
    expect(vi.mocked(d.twoFactor.unenroll).mock.calls).toEqual([['f-old'], ['f-older']]);
    expect(vi.mocked(d.twoFactor.unenroll).mock.invocationCallOrder[1]).toBeLessThan(
      vi.mocked(d.twoFactor.enroll).mock.invocationCallOrder[0]!,
    );
  });

  it('goes on when an abandoned enrollment is already gone, but stops on other failures', async () => {
    const gone = deps(
      { verified: [], unverified: ['f-old'] },
      { unenroll: () => Promise.resolve(authFailure('factor_not_found')) },
    );
    expect(await startEnrollment(gone, {})).toMatchObject({ ok: true });

    const down = deps(
      { verified: [], unverified: ['f-old'] },
      { unenroll: () => Promise.resolve(authFailure('unknown')) },
    );
    expect(await startEnrollment(down, {})).toMatchObject({ code: 'unknown' });
    expect(down.twoFactor.enroll).not.toHaveBeenCalled();
  });

  it('needs a verified code in this session to add a second app (aal2)', async () => {
    const d = deps(WITH_APP);
    expect(await startEnrollment(d, {})).toMatchObject({ code: 'second_factor_required' });
    expect(d.twoFactor.enroll).not.toHaveBeenCalled();

    const verified = deps({ verified: [{ ...ADA_PHONE, name: 'Authenticator app' }], unverified: [] }, {}, AAL2);
    await startEnrollment(verified, {});
    expect(verified.twoFactor.enroll).toHaveBeenCalledWith('Authenticator app 2');
  });

  it('refuses a name another app has, whatever its case', async () => {
    const d = deps(WITH_APP, {}, AAL2);
    expect(await startEnrollment(d, { name: 'PHONE' })).toMatchObject({
      code: 'factor_name_taken',
      fieldErrors: { name: expect.any(String) },
    });
    expect(d.twoFactor.enroll).not.toHaveBeenCalled();
  });

  it('refuses a name that is too long, and needs a session', async () => {
    expect(await startEnrollment(deps(NONE), { name: 'x'.repeat(41) })).toMatchObject({ code: 'invalid_input' });
    expect(await startEnrollment(deps(null), {})).toMatchObject({ code: 'not_signed_in' });
  });

  it('passes on the provider’s refusal, such as enrollment turned off or too many apps', async () => {
    for (const code of ['two_factor_unavailable', 'too_many_factors'] as const) {
      const d = deps(NONE, { enroll: () => Promise.resolve(authFailure(code)) });
      expect(await startEnrollment(d, {})).toMatchObject({ code });
    }
  });
});

describe('confirmEnrollment', () => {
  it('verifies the first code for the new app', async () => {
    const d = deps(NONE);
    expect(await confirmEnrollment(d, { factorId: 'f-new', code: '123456' })).toEqual({ ok: true });
    expect(d.twoFactor.verify).toHaveBeenCalledWith('f-new', '123456');
  });

  it('says a wrong code is wrong, so the app stays unconfirmed', async () => {
    const d = deps(NONE, { verify: () => Promise.resolve(authFailure('invalid_code')) });
    expect(await confirmEnrollment(d, { factorId: 'f-new', code: '000000' })).toMatchObject({
      code: 'invalid_code',
      fieldErrors: { code: expect.any(String) },
    });
  });

  it('passes on an expired challenge', async () => {
    const d = deps(NONE, { verify: () => Promise.resolve(authFailure('code_expired')) });
    expect(await confirmEnrollment(d, { factorId: 'f-new', code: '123456' })).toMatchObject({ code: 'code_expired' });
  });

  it('refuses a malformed code or a missing app without asking the provider', async () => {
    const d = deps(NONE);
    expect(await confirmEnrollment(d, { factorId: 'f-new', code: 'abc' })).toMatchObject({ code: 'invalid_input' });
    expect(await confirmEnrollment(d, { code: '123456' })).toMatchObject({ code: 'invalid_input' });
    expect(d.twoFactor.verify).not.toHaveBeenCalled();
  });
});

describe('cancelEnrollment: an abandoned enrollment', () => {
  it('drops the unconfirmed app, and is fine when it is already gone', async () => {
    const d = deps(NONE);
    expect(await cancelEnrollment(d, 'f-new')).toEqual({ ok: true });
    expect(d.twoFactor.unenroll).toHaveBeenCalledWith('f-new');

    const gone = deps(NONE, { unenroll: () => Promise.resolve(authFailure('factor_not_found')) });
    expect(await cancelEnrollment(gone, 'f-new')).toEqual({ ok: true });
  });

  it('reports any other failure', async () => {
    const d = deps(NONE, { unenroll: () => Promise.resolve(authFailure('unknown')) });
    expect(await cancelEnrollment(d, 'f-new')).toMatchObject({ code: 'unknown' });
  });
});

describe('removeSecondFactor', () => {
  it('removes an app from a session that verified a code', async () => {
    const d = deps(WITH_APP, {}, AAL2);
    expect(await removeSecondFactor(d, 'f1')).toEqual({ ok: true });
    expect(d.twoFactor.unenroll).toHaveBeenCalledWith('f1');
  });

  it('refuses without a verified code (aal1): a password or session alone can’t turn it off', async () => {
    const d = deps(WITH_APP);
    expect(await removeSecondFactor(d, 'f1')).toMatchObject({ code: 'second_factor_required' });
    expect(d.twoFactor.unenroll).not.toHaveBeenCalled();
  });

  it('passes on the provider’s own refusal, should the session have dropped below aal2', async () => {
    const d = deps(WITH_APP, { unenroll: () => Promise.resolve(authFailure('second_factor_required')) }, AAL2);
    expect(await removeSecondFactor(d, 'f1')).toMatchObject({ code: 'second_factor_required' });
  });

  it('needs a session and an app', async () => {
    expect(
      await removeSecondFactor(deps(WITH_APP, {}, { currentClaims: () => Promise.resolve(null) }), 'f1'),
    ).toMatchObject({
      code: 'not_signed_in',
    });
    expect(await removeSecondFactor(deps(WITH_APP, {}, AAL2), '')).toMatchObject({ code: 'factor_not_found' });
  });
});
