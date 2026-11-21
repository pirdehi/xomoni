import type { BrowserSupabase } from '@/shared/supabase/browser';
import type { AccountSession } from '../application/ports';

/** An access token's payload, decoded but not verified; null when it isn't a token. */
function claimsOf(accessToken: string): Record<string, unknown> | null {
  const payload = accessToken.split('.')[1];
  if (!payload) return null;
  try {
    const json = atob(
      payload
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(payload.length / 4) * 4, '='),
    );
    const claims: unknown = JSON.parse(json);
    return typeof claims === 'object' && claims !== null ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The session id in an access token (`session_id`), or null. The token is only decoded, not verified: this says which
 * session the browser holds, for the sync's bookkeeping; the server verifies every request on its own.
 */
export function sessionIdOf(accessToken: string): string | null {
  const id = claimsOf(accessToken)?.session_id;
  return typeof id === 'string' && id ? id : null;
}

/**
 * Whether a session still owes a code from the account's authenticator app (#173): its token is below `aal2` and the
 * account, as the session's cookie lists it, has a verified factor. Until it gives one, the sync treats the browser as
 * signed out: the database would show it no devices and make it no code, which would read as another account.
 */
export function owesSecondFactor(accessToken: string, factors: readonly { status?: unknown }[] | undefined): boolean {
  return claimsOf(accessToken)?.aal !== 'aal2' && (factors ?? []).some((f) => f.status === 'verified');
}

/** `AccountSession` with the browser's Supabase client: the session cookie, the account's devices, its codes. */
export function createSupabaseAccountSession(supabase: BrowserSupabase): AccountSession {
  return {
    async currentSessionId() {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (!session || owesSecondFactor(session.access_token, session.user.factors)) return null;
      return sessionIdOf(session.access_token);
    },
    async deviceIds() {
      const { data, error } = await supabase.from('devices').select('id');
      if (error) throw new Error(error.message);
      return new Set(data.map((row) => row.id));
    },
    async createCode() {
      const { data, error } = await supabase.rpc('create_pairing_code');
      if (error) return null;
      return data[0]?.code ?? null;
    },
    async signOut() {
      // This session only, as the header's Sign out does; Supabase ends it on the server too.
      await supabase.auth.signOut({ scope: 'local' });
    },
  };
}
