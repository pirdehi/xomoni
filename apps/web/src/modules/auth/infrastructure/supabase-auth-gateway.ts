import type { AuthError } from '@supabase/supabase-js';
import type { ServerSupabase } from '@/shared/supabase/server';
import { authFailure, type AuthErrorCode, type AuthFailure } from '../domain/auth-error';
import type { IdentityClaims } from '../domain/viewer';
import type { AuthGateway } from '../application/ports';

/** Supabase Auth error codes mapped to domain codes. Anything else becomes `unknown`. */
const ERROR_CODES: Record<string, AuthErrorCode> = {
  invalid_credentials: 'invalid_credentials',
  email_not_confirmed: 'email_not_confirmed',
  otp_expired: 'link_invalid_or_expired',
  flow_state_expired: 'link_invalid_or_expired',
  flow_state_not_found: 'link_invalid_or_expired',
  bad_code_verifier: 'link_invalid_or_expired',
  over_request_rate_limit: 'rate_limited',
  over_email_send_rate_limit: 'rate_limited',
  session_not_found: 'not_signed_in',
  no_authorization: 'not_signed_in',
  oauth_provider_not_supported: 'provider_error',
  provider_disabled: 'provider_error',
};

/** Converts a Supabase error into a domain failure, keeping the original text for logs. */
export function toAuthFailure(error: Pick<AuthError, 'code' | 'message' | 'status'>): AuthFailure {
  const code = (error.code && ERROR_CODES[error.code]) || (error.status === 429 ? 'rate_limited' : 'unknown');
  return authFailure(code, `${error.code ?? error.status ?? 'error'}: ${error.message}`);
}

/** Implements {@link AuthGateway} with Supabase Auth through a request-bound server client. */
export function createSupabaseAuthGateway(supabase: ServerSupabase): AuthGateway {
  return {
    async currentClaims() {
      // getClaims verifies the JWT signature; never trust getSession() on the server.
      const { data } = await supabase.auth.getClaims();
      return (data?.claims as IdentityClaims | undefined) ?? null;
    },

    async startOAuth(provider, redirectTo) {
      const { data, error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
      if (error || !data.url) return error ? toAuthFailure(error) : authFailure('provider_error', 'no url');
      return { ok: true, url: data.url };
    },

    async exchangeCode(code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      return error ? toAuthFailure(error) : { ok: true };
    },

    async signOut() {
      await supabase.auth.signOut({ scope: 'local' });
    },

    async deleteAccount() {
      const { error } = await supabase.rpc('delete_account');
      return error ? authFailure('unknown', error.message) : { ok: true };
    },
  };
}
