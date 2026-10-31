import type { BrowserContext } from '@playwright/test';

/**
 * The refresh token of the session a browser holds, read from the Supabase session cookie
 * (`sb-<ref>-auth-token`, `base64-` + JSON, possibly split into `.0`, `.1`… chunks).
 */
export async function refreshTokenOf(context: BrowserContext): Promise<string> {
  const chunks = (await context.cookies())
    .filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => Number(a.name.split('.')[1] ?? 0) - Number(b.name.split('.')[1] ?? 0));
  const value = chunks.map((c) => c.value).join('');
  if (!value.startsWith('base64-')) throw new Error('no Supabase session cookie in this browser');
  const session = JSON.parse(Buffer.from(value.slice('base64-'.length), 'base64url').toString('utf8')) as {
    refresh_token: string;
  };
  return session.refresh_token;
}

/** Whether Supabase Auth still renews a session from this refresh token. */
export async function canRenew(refreshToken: string): Promise<boolean> {
  const api = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
  const response = await fetch(`${api}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  return response.ok;
}
