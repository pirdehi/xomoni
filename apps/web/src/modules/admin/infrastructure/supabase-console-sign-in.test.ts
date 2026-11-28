import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xomoni/db';
import { describe, expect, it, vi } from 'vitest';
import { createSupabaseConsoleSignIn, signInProblemOf } from './supabase-console-sign-in';

type AuthError = { code?: string; status?: number; message: string };

function fakeClient({
  signIn = { error: null },
  superadmin = { data: true, error: null },
  aal = { data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null },
}: {
  signIn?: { error: AuthError | null };
  superadmin?: { data: boolean | null; error: { message: string } | null };
  aal?: { data: { currentLevel: string; nextLevel: string } | null; error: { message: string } | null };
} = {}) {
  const auth = {
    signInWithPassword: vi.fn(() => Promise.resolve({ data: {}, ...signIn })),
    signOut: vi.fn(() => Promise.resolve({ error: null })),
    mfa: { getAuthenticatorAssuranceLevel: vi.fn(() => Promise.resolve(aal)) },
  };
  const rpc = vi.fn(() => Promise.resolve(superadmin));
  return { client: { auth, rpc } as unknown as SupabaseClient<Database>, auth, rpc };
}

describe('createSupabaseConsoleSignIn (#516)', () => {
  it('signs in with the password and the security check’s token', async () => {
    const { client, auth } = fakeClient();
    expect(
      await createSupabaseConsoleSignIn(client).signInWithPassword({
        email: 'maintainer@example.com',
        password: 'pw',
        captchaToken: 'token',
      }),
    ).toBe('ok');
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'maintainer@example.com',
      password: 'pw',
      options: { captchaToken: 'token' },
    });
  });

  it('answers a wrong password with refused', async () => {
    const { client } = fakeClient({
      signIn: { error: { code: 'invalid_credentials', status: 400, message: 'Invalid' } },
    });
    expect(await createSupabaseConsoleSignIn(client).signInWithPassword({ email: 'a@b.c', password: 'x' })).toBe(
      'refused',
    );
  });

  it('asks the database whether the new session is a super-admin’s, and fails when it can’t say', async () => {
    const yes = fakeClient();
    expect(await createSupabaseConsoleSignIn(yes.client).isSuperadmin()).toBe(true);
    expect(yes.rpc).toHaveBeenCalledWith('is_superadmin');
    const down = fakeClient({ superadmin: { data: null, error: { message: 'down' } } });
    await expect(createSupabaseConsoleSignIn(down.client).isSuperadmin()).rejects.toThrow('is_superadmin: down');
  });

  it('tells a session that owes a code from one that doesn’t', async () => {
    const owes = fakeClient({ aal: { data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null } });
    expect(await createSupabaseConsoleSignIn(owes.client).secondFactorNeeded()).toBe(true);
    const done = fakeClient({ aal: { data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null } });
    expect(await createSupabaseConsoleSignIn(done.client).secondFactorNeeded()).toBe(false);
    expect(await createSupabaseConsoleSignIn(fakeClient().client).secondFactorNeeded()).toBe(false);
    const broken = fakeClient({ aal: { data: null, error: { message: 'no session' } } });
    await expect(createSupabaseConsoleSignIn(broken.client).secondFactorNeeded()).rejects.toThrow('no session');
  });

  it('signs out in this browser only', async () => {
    const { client, auth } = fakeClient();
    await createSupabaseConsoleSignIn(client).signOut();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});

describe('signInProblemOf', () => {
  it('reads every "these details are wrong" answer alike, whichever it was', () => {
    for (const code of ['invalid_credentials', 'email_not_confirmed', 'validation_failed', 'user_banned']) {
      expect(signInProblemOf({ code, status: 400 })).toBe('refused');
    }
    expect(signInProblemOf({ status: 400 })).toBe('refused');
  });

  it('keeps the security check, the rate limit and anything else apart', () => {
    expect(signInProblemOf({ code: 'captcha_failed', status: 400 })).toBe('captcha');
    expect(signInProblemOf({ code: 'over_request_rate_limit', status: 429 })).toBe('rate-limited');
    expect(signInProblemOf({ status: 429 })).toBe('rate-limited');
    expect(signInProblemOf({ code: 'unexpected_failure', status: 500 })).toBe('failed');
    expect(signInProblemOf({})).toBe('failed');
  });
});
