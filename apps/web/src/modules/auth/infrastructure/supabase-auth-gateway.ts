import type { AuthError, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xomoni/db';
import { authFailure, type AuthErrorCode, type AuthFailure, type AuthResult } from '../domain/auth-error';
import type { IdentityClaims } from '../domain/viewer';
import type { AuthGateway } from '../application/ports';

/** Supabase Auth error codes mapped to domain codes. Anything else becomes `unknown`. */
const ERROR_CODES: Record<string, AuthErrorCode> = {
  validation_failed: 'invalid_input',
  invalid_credentials: 'invalid_credentials',
  email_not_confirmed: 'email_not_confirmed',
  user_already_exists: 'account_exists',
  email_exists: 'email_unusable',
  email_address_invalid: 'email_unusable',
  email_address_not_authorized: 'email_unusable',
  weak_password: 'weak_password',
  same_password: 'same_password',
  otp_expired: 'link_invalid_or_expired',
  flow_state_expired: 'link_invalid_or_expired',
  flow_state_not_found: 'link_invalid_or_expired',
  bad_code_verifier: 'link_invalid_or_expired',
  captcha_failed: 'captcha_failed',
  over_request_rate_limit: 'rate_limited',
  over_email_send_rate_limit: 'rate_limited',
  reauthentication_needed: 'reauthentication_needed',
  reauthentication_not_valid: 'reauthentication_needed',
  session_not_found: 'not_signed_in',
  no_authorization: 'not_signed_in',
  signup_disabled: 'signup_disabled',
  email_provider_disabled: 'signup_disabled',
  oauth_provider_not_supported: 'provider_error',
  provider_disabled: 'provider_error',
  // With "Require current password" on (#148).
  current_password_required: 'current_password_required',
  current_password_invalid: 'wrong_current_password',
  // Two-step verification (#173).
  mfa_verification_failed: 'invalid_code',
  mfa_verification_rejected: 'invalid_code',
  mfa_challenge_expired: 'code_expired',
  // What Supabase answers when a used challenge is tried again: the attempt is over either way.
  mfa_ip_address_mismatch: 'code_expired',
  mfa_factor_not_found: 'factor_not_found',
  insufficient_aal: 'second_factor_required',
  mfa_totp_enroll_not_enabled: 'two_factor_unavailable',
  mfa_totp_verify_not_enabled: 'two_factor_unavailable',
  too_many_enrolled_mfa_factors: 'too_many_factors',
  mfa_factor_name_conflict: 'factor_name_taken',
};

/** Converts a Supabase error into a domain failure, keeping the original text for logs. */
export function toAuthFailure(error: Pick<AuthError, 'code' | 'message' | 'status'>): AuthFailure {
  const code = (error.code && ERROR_CODES[error.code]) || (error.status === 429 ? 'rate_limited' : 'unknown');
  return authFailure(code, `${error.code ?? error.status ?? 'error'}: ${error.message}`);
}

const done = ({ error }: { error: AuthError | null }): AuthResult => (error ? toAuthFailure(error) : { ok: true });

/** Hints the database's account functions raise, mapped to domain codes. */
const DATABASE_HINTS = new Map<string, AuthErrorCode>([
  // A sign-in within the last 10 minutes is needed (#80).
  ['reauthentication_needed', 'reauthentication_needed'],
  // The account has an authenticator app and the session hasn't verified a code from it (#173).
  ['second_factor_required', 'second_factor_required'],
]);

/**
 * Maps a failed `delete_account()` call. The function asks for a recent sign-in with the hint
 * `reauthentication_needed` (#80), or for a code from the account's authenticator app with `second_factor_required`
 * (#173); anything else is unexpected.
 */
export function toDeleteAccountFailure(error: { hint?: string | null; message: string }): AuthFailure {
  return authFailure(DATABASE_HINTS.get(error.hint ?? '') ?? 'unknown', error.message);
}

/**
 * Implements {@link AuthGateway} with Supabase Auth. Works with the browser client (interactive sign-in,
 * so Supabase's per-IP limits and the captcha apply to the person) and with the request-bound server
 * client (session reads, OAuth callback, sign-out, account deletion).
 */
export function createSupabaseAuthGateway(supabase: SupabaseClient<Database>): AuthGateway {
  return {
    async currentClaims() {
      // getClaims verifies the JWT; never trust getSession() on the server.
      const { data } = await supabase.auth.getClaims();
      return (data?.claims as IdentityClaims | undefined) ?? null;
    },

    async currentAccount() {
      // getUser asks the Auth server, so a pending email change made on another device shows up.
      const { data, error } = await supabase.auth.getUser();
      if (error) return null;
      return { email: data.user.email ?? '', pendingEmail: data.user.new_email ?? null };
    },

    async startOAuth(provider, redirectTo) {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) return toAuthFailure(error);
      return data.url ? { ok: true, url: data.url } : authFailure('provider_error', 'no url');
    },

    async exchangeCode(code) {
      return done(await supabase.auth.exchangeCodeForSession(code));
    },

    async signUp({ email, password, name, captchaToken, emailRedirectTo, next }) {
      // `next` rides in the account's metadata, where the confirmation template reads it as `{{ .Data.next }}` (#244):
      // a template value can't start the link, or Supabase's html/template refuses it as ambiguous.
      return done(
        await supabase.auth.signUp({
          email,
          password,
          options: { captchaToken, emailRedirectTo, data: { ...(name && { full_name: name }), next } },
        }),
      );
    },

    async signInWithPassword({ email, password, captchaToken }) {
      return done(await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } }));
    },

    async sendPasswordReset({ email, captchaToken, redirectTo }) {
      return done(await supabase.auth.resetPasswordForEmail(email, { captchaToken, redirectTo }));
    },

    async resendConfirmation({ email, captchaToken, emailRedirectTo }) {
      return done(await supabase.auth.resend({ type: 'signup', email, options: { captchaToken, emailRedirectTo } }));
    },

    async verifyEmailLink({ tokenHash, type }) {
      return done(await supabase.auth.verifyOtp({ token_hash: tokenHash, type }));
    },

    async updatePassword(password, currentPassword) {
      // Supabase checks `current_password` itself once "Require current password" is on (#148).
      return done(
        await supabase.auth.updateUser(
          currentPassword === undefined ? { password } : { password, current_password: currentPassword },
        ),
      );
    },

    async changeEmail({ email, emailRedirectTo }) {
      return done(await supabase.auth.updateUser({ email }, { emailRedirectTo }));
    },

    async signOut(everywhere = false) {
      await supabase.auth.signOut({ scope: everywhere ? 'global' : 'local' });
    },

    async deleteAccount() {
      const { error } = await supabase.rpc('delete_account');
      return error ? toDeleteAccountFailure(error) : { ok: true };
    },
  };
}
