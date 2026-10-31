import { describe, expect, it } from 'vitest';
import { toAuthFailure, toDeleteAccountFailure } from './supabase-auth-gateway';

describe('toAuthFailure', () => {
  it.each([
    ['invalid_credentials', 'invalid_credentials'],
    ['email_not_confirmed', 'email_not_confirmed'],
    ['otp_expired', 'link_invalid_or_expired'],
    ['bad_code_verifier', 'link_invalid_or_expired'],
    ['over_email_send_rate_limit', 'rate_limited'],
    ['session_not_found', 'not_signed_in'],
  ])('maps %s to %s', (supabaseCode, domainCode) => {
    expect(toAuthFailure({ code: supabaseCode, message: 'x', status: 400 }).code).toBe(domainCode);
  });

  it('treats an unknown 429 as rate limiting', () => {
    expect(toAuthFailure({ code: undefined, message: 'slow down', status: 429 }).code).toBe('rate_limited');
  });

  it('keeps the provider text for logs only', () => {
    const failure = toAuthFailure({ code: 'unexpected_failure', message: 'database exploded', status: 500 });
    expect(failure).toEqual({ ok: false, code: 'unknown', detail: 'unexpected_failure: database exploded' });
  });
});

describe('toDeleteAccountFailure (#80)', () => {
  it('asks for a fresh sign-in when delete_account() says the last one is too old', () => {
    const failure = toDeleteAccountFailure({
      hint: 'reauthentication_needed',
      message: 'Sign in again to delete your account.',
    });
    expect(failure.code).toBe('reauthentication_needed');
  });

  it('treats any other failure as unexpected', () => {
    expect(toDeleteAccountFailure({ hint: null, message: 'permission denied' }).code).toBe('unknown');
  });
});
