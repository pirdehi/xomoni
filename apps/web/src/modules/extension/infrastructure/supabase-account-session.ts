import type { BrowserSupabase } from '@/shared/supabase/browser';
import type { AccountSession } from '../application/ports';

/**
 * The session id in an access token (`session_id`), or null. The token is only decoded, not verified: this says which
 * session the browser holds, for the sync's bookkeeping; the server verifies every request on its own.
 */
export function sessionIdOf(accessToken: string): string | null {
  const payload = accessToken.split('.')[1];
  if (!payload) return null;
  try {
    const json = atob(
      payload
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(payload.length / 4) * 4, '='),
    );
    const claims = JSON.parse(json) as { session_id?: unknown };
    return typeof claims.session_id === 'string' && claims.session_id ? claims.session_id : null;
  } catch {
    return null;
  }
}

/** `AccountSession` with the browser's Supabase client: the session cookie, the account's devices, its codes. */
export function createSupabaseAccountSession(supabase: BrowserSupabase): AccountSession {
  return {
    async currentSessionId() {
      const { data } = await supabase.auth.getSession();
      return data.session ? sessionIdOf(data.session.access_token) : null;
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
