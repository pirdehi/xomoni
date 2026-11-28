import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xomoni/db';
import type { ConsoleSignInGateway } from '../application/ports';
import type { ConsoleSignInProblem } from '../domain/sign-in';

/** Supabase Auth's answers that all mean "these details don't open the console", whichever it was. */
const REFUSED_CODES = new Set([
  'invalid_credentials',
  'email_not_confirmed',
  'validation_failed',
  'user_banned',
  'user_not_found',
]);

/**
 * The console's problem for a failed sign-in: wrong details, an unconfirmed or suspended account all read `refused`,
 * so nothing tells whether the email has an account; the security check and the rate limit keep their own words.
 */
export function signInProblemOf(error: { code?: string; status?: number }): ConsoleSignInProblem {
  if (error.code === 'captcha_failed') return 'captcha';
  if (error.code === 'over_request_rate_limit' || error.status === 429) return 'rate-limited';
  if (error.code && REFUSED_CODES.has(error.code)) return 'refused';
  return error.status === 400 ? 'refused' : 'failed';
}

/** The console's sign-in on Supabase, in the person's browser (#516). */
export function createSupabaseConsoleSignIn(supabase: SupabaseClient<Database>): ConsoleSignInGateway {
  return {
    async signInWithPassword({ email, password, captchaToken }) {
      const { error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });
      return error ? signInProblemOf(error) : 'ok';
    },
    async isSuperadmin() {
      const { data, error } = await supabase.rpc('is_superadmin');
      if (error) throw new Error(`is_superadmin: ${error.message}`);
      return data;
    },
    async secondFactorNeeded() {
      // Read from the new session's token and its user's factors; a verified app raises `nextLevel` to aal2.
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error) throw new Error(`assurance level: ${error.message}`);
      return data.nextLevel === 'aal2' && data.currentLevel !== 'aal2';
    },
    async signOut() {
      await supabase.auth.signOut({ scope: 'local' });
    },
  };
}
