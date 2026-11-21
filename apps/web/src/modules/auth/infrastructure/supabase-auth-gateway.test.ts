import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xomoni/db';
import { describe, expect, it, vi } from 'vitest';
import { createSupabaseAuthGateway, toAuthFailure, toDeleteAccountFailure } from './supabase-auth-gateway';

describe('toAuthFailure', () => {
  it.each([
    ['invalid_credentials', 'invalid_credentials'],
    ['email_not_confirmed', 'email_not_confirmed'],
    ['otp_expired', 'link_invalid_or_expired'],
    ['bad_code_verifier', 'link_invalid_or_expired'],
    ['over_email_send_rate_limit', 'rate_limited'],
    ['session_not_found', 'not_signed_in'],
    // With "Require current password" on (#148).
    ['current_password_required', 'current_password_required'],
    ['current_password_invalid', 'wrong_current_password'],
    // Two-step verification (#173), as GoTrue answers them.
    ['mfa_verification_failed', 'invalid_code'],
    ['mfa_verification_rejected', 'invalid_code'],
    ['mfa_challenge_expired', 'code_expired'],
    ['mfa_ip_address_mismatch', 'code_expired'],
    ['mfa_factor_not_found', 'factor_not_found'],
    ['insufficient_aal', 'second_factor_required'],
    ['mfa_totp_enroll_not_enabled', 'two_factor_unavailable'],
    ['mfa_totp_verify_not_enabled', 'two_factor_unavailable'],
    ['too_many_enrolled_mfa_factors', 'too_many_factors'],
    ['mfa_factor_name_conflict', 'factor_name_taken'],
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

  it('asks for a code when the account has an authenticator app and the session gave none (#173)', () => {
    const failure = toDeleteAccountFailure({
      hint: 'second_factor_required',
      message: 'Enter a code from your authenticator app first.',
    });
    expect(failure).toEqual({
      ok: false,
      code: 'second_factor_required',
      detail: 'Enter a code from your authenticator app first.',
    });
  });

  it('treats any other failure as unexpected, whatever the hint names', () => {
    expect(toDeleteAccountFailure({ hint: null, message: 'permission denied' }).code).toBe('unknown');
    for (const hint of ['toString', 'constructor', '__proto__', 'nope']) {
      expect(toDeleteAccountFailure({ hint, message: 'x' }).code).toBe('unknown');
    }
  });
});

describe('changing the password (#148)', () => {
  const gatewayWith = (updateUser: ReturnType<typeof vi.fn>) =>
    createSupabaseAuthGateway({ auth: { updateUser } } as unknown as SupabaseClient<Database>);

  it('sends the current password with the new one, so Supabase can check it itself', async () => {
    const updateUser = vi.fn(async () => ({ data: { user: null }, error: null }));
    expect(await gatewayWith(updateUser).updatePassword('new password 1', 'old password 1')).toEqual({ ok: true });
    expect(updateUser).toHaveBeenCalledWith({ password: 'new password 1', current_password: 'old password 1' });
  });

  it('sends none for a reset from an emailed link, which has no current password', async () => {
    const updateUser = vi.fn(async () => ({ data: { user: null }, error: null }));
    await gatewayWith(updateUser).updatePassword('new password 1');
    expect(updateUser).toHaveBeenCalledWith({ password: 'new password 1' });
  });
});

describe('signing up (#244)', () => {
  it('keeps the name and where the emailed link returns in the account’s metadata', async () => {
    const signUp = vi.fn(async () => ({ data: { user: null, session: null }, error: null }));
    const gateway = createSupabaseAuthGateway({ auth: { signUp } } as unknown as SupabaseClient<Database>);
    const input = {
      email: 'ada@example.com',
      password: 'pw 1',
      emailRedirectTo: 'https://x/auth/confirm',
      next: '/connect',
    };
    expect(await gateway.signUp({ ...input, name: 'Ada', captchaToken: 'tok' })).toEqual({ ok: true });
    expect(signUp).toHaveBeenLastCalledWith({
      email: 'ada@example.com',
      password: 'pw 1',
      options: {
        captchaToken: 'tok',
        emailRedirectTo: 'https://x/auth/confirm',
        data: { full_name: 'Ada', next: '/connect' },
      },
    });
    await gateway.signUp(input);
    expect(signUp).toHaveBeenLastCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ data: { next: '/connect' } }) }),
    );
  });
});
