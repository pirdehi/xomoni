import { describe, expect, it } from 'vitest';
import { validate } from './credentials';
import {
  FACTOR_NAME_MAX,
  RECOVERY_COOL_DOWN_DAYS,
  TOTP_DIGITS,
  assuranceOf,
  confirmEnrollmentSchema,
  defaultFactorName,
  enrollSchema,
  groupSecret,
  secondFactorCodeSchema,
  secondFactorNeeded,
} from './two-factor';

const app = (name: string) => ({ id: name, name, addedAt: '2026-11-01T00:00:00Z' });

describe('assuranceOf', () => {
  it('reads aal2 only when the claim says exactly that', () => {
    expect(assuranceOf('aal2')).toBe('aal2');
    for (const claim of ['aal1', 'AAL2', 'aal2 ', 'aal3', '', null, undefined, 2, ['aal2'], { aal: 'aal2' }]) {
      expect(assuranceOf(claim), JSON.stringify(claim)).toBe('aal1');
    }
  });
});

describe('secondFactorNeeded', () => {
  it('is owed only by an account with a verified app, below aal2', () => {
    expect(secondFactorNeeded('aal1', true)).toBe(true);
    expect(secondFactorNeeded('aal2', true)).toBe(false);
    expect(secondFactorNeeded('aal1', false)).toBe(false);
    expect(secondFactorNeeded('aal2', false)).toBe(false);
  });
});

describe('codes', () => {
  it('has six digits, as Supabase makes them', () => {
    expect(TOTP_DIGITS).toBe(6);
  });

  it.each([
    ['123456', '123456'],
    ['123 456', '123456'],
    [' 123-456 ', '123456'],
    ['000000', '000000'],
  ])('takes %j as %s', (raw, code) => {
    expect(validate(secondFactorCodeSchema, { code: raw })).toEqual({ ok: true, value: { code } });
  });

  it.each([
    ['', 'Enter the 6-digit code from your app'],
    ['   ', 'Enter the 6-digit code from your app'],
    ['12345', 'The code has 6 digits'],
    ['1234567', 'The code has 6 digits'],
    ['12a456', 'The code has only numbers'],
    ['１２３４５６', 'The code has only numbers'],
  ])('refuses %j: %s', (raw, message) => {
    expect(validate(secondFactorCodeSchema, { code: raw })).toEqual({ ok: false, fieldErrors: { code: message } });
  });

  it('refuses a code that isn’t text', () => {
    expect(validate(secondFactorCodeSchema, { code: 123456 })).toMatchObject({ ok: false });
    expect(validate(secondFactorCodeSchema, {})).toMatchObject({ ok: false });
  });

  it('needs the app being added for its first code', () => {
    expect(validate(confirmEnrollmentSchema, { factorId: 'f1', code: '123456' })).toMatchObject({ ok: true });
    expect(validate(confirmEnrollmentSchema, { factorId: '', code: '123456' })).toMatchObject({ ok: false });
  });
});

describe('naming an app', () => {
  it('trims the name, and takes none for an empty one', () => {
    expect(validate(enrollSchema, { name: ' Phone ' })).toEqual({ ok: true, value: { name: 'Phone' } });
    expect(validate(enrollSchema, { name: '   ' })).toEqual({ ok: true, value: { name: undefined } });
    expect(validate(enrollSchema, {})).toEqual({ ok: true, value: { name: undefined } });
  });

  it(`refuses more than ${FACTOR_NAME_MAX} characters`, () => {
    expect(validate(enrollSchema, { name: 'x'.repeat(FACTOR_NAME_MAX) })).toMatchObject({ ok: true });
    expect(validate(enrollSchema, { name: 'x'.repeat(FACTOR_NAME_MAX + 1) })).toMatchObject({
      ok: false,
      fieldErrors: { name: expect.any(String) },
    });
  });

  it('numbers the default name past the ones the account has, whatever their case', () => {
    expect(defaultFactorName([])).toBe('Authenticator app');
    expect(defaultFactorName([app('Phone')])).toBe('Authenticator app');
    expect(defaultFactorName([app('authenticator app')])).toBe('Authenticator app 2');
    expect(defaultFactorName([app('Authenticator app'), app('Authenticator app 2')])).toBe('Authenticator app 3');
  });
});

describe('groupSecret', () => {
  it('shows a key in groups of four, as people type it', () => {
    expect(groupSecret('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
    expect(groupSecret('ABCDEF')).toBe('ABCD EF');
    expect(groupSecret(' AB CD EF ')).toBe('ABCD EF');
    expect(groupSecret('')).toBe('');
  });
});

describe('recovery', () => {
  it('waits some days before removing a lost app, so the owner hears of it first', () => {
    expect(RECOVERY_COOL_DOWN_DAYS).toBeGreaterThanOrEqual(1);
  });
});
