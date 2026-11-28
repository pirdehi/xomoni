import { describe, expect, it, vi } from 'vitest';
import { createBrowserSupabase } from '@/shared/supabase/browser';
import { browserConsole } from './console-sign-in';

vi.mock('@/shared/supabase/browser', () => ({ createBrowserSupabase: vi.fn() }));

describe('browserConsole (#516)', () => {
  it('signs in from the browser straight to Supabase, then signs a stranger out again', async () => {
    const auth = {
      signInWithPassword: vi.fn(() => Promise.resolve({ data: {}, error: null })),
      signOut: vi.fn(() => Promise.resolve({ error: null })),
      mfa: { getAuthenticatorAssuranceLevel: vi.fn() },
    };
    const rpc = vi.fn(() => Promise.resolve({ data: false, error: null }));
    vi.mocked(createBrowserSupabase).mockReturnValue({ auth, rpc } as never);

    const result = await browserConsole.signIn({ email: 'ada@example.com', password: 'pw', captchaToken: 't' });

    expect(result).toEqual({ ok: false, problem: 'refused' });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'pw',
      options: { captchaToken: 't' },
    });
    expect(rpc).toHaveBeenCalledWith('is_superadmin');
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
