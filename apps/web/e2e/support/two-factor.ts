import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { totp } from './totp';

/**
 * Cloudflare's dummy token: the local stack's Turnstile secret is the always-pass test key (`supabase/config.toml`),
 * which takes it. Used only for sign-ins the tests make without a browser.
 */
const TEST_CAPTCHA = 'XXXX.DUMMY.TOKEN.XXXX';

/**
 * Signs in to the local stack without a browser, as an attacker with the password would call the API directly: a
 * session at `aal1`, its tokens kept in this client only.
 */
export async function apiSignIn(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_PUBLISHABLE_KEY ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password, options: { captchaToken: TEST_CAPTCHA } });
  if (error) throw new Error(`API sign-in failed: ${error.message}`);
  return client;
}

/** Adds and confirms an authenticator app through the API; the session is at `aal2` afterwards. */
export async function apiEnroll(client: SupabaseClient, name = 'Phone'): Promise<{ factorId: string; secret: string }> {
  const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: name });
  if (error) throw new Error(`enroll failed: ${error.message}`);
  const verified = await client.auth.mfa.challengeAndVerify({ factorId: data.id, code: totp(data.totp.secret) });
  if (verified.error) throw new Error(`first code failed: ${verified.error.message}`);
  return { factorId: data.id, secret: data.totp.secret };
}

/** The session's assurance level, from the access token this client holds. */
export async function aalOf(client: SupabaseClient): Promise<string | undefined> {
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token ?? '';
  const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8') || '{}') as {
    aal?: string;
  };
  return payload.aal;
}
