import { describe, expect, it, vi } from 'vitest';
import type { BrowserSupabase } from '@/shared/supabase/browser';
import { createSupabaseAccountSession, sessionIdOf } from './supabase-account-session';

/** A JWT-shaped token with `claims` as its payload, base64url without padding, as Supabase issues them. */
function token(claims: Record<string, unknown>): string {
  const payload = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${payload}.signature`;
}

/** The parts of the browser client the adapter calls. */
function client(over: { session?: unknown; devices?: unknown; devicesError?: unknown; rpc?: unknown } = {}) {
  const signOut = vi.fn(() => Promise.resolve({ error: null }));
  const select = vi.fn(() => Promise.resolve({ data: over.devices ?? [], error: over.devicesError ?? null }));
  const supabase = {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: over.session ?? null } })),
      signOut,
    },
    from: vi.fn(() => ({ select })),
    rpc: vi.fn(() => Promise.resolve(over.rpc ?? { data: [{ code: 'ABCDE-FGHJK' }], error: null })),
  };
  return { supabase: supabase as unknown as BrowserSupabase, raw: supabase, select, signOut };
}

describe('sessionIdOf (#232)', () => {
  it('reads the session id from the token’s payload, whatever base64url characters it uses', () => {
    expect(sessionIdOf(token({ session_id: 'abc-123', sub: 'u1' }))).toBe('abc-123');
    expect(sessionIdOf(token({ session_id: 'é?>~ü' }))).toBe('é?>~ü');
  });

  it('is null for a token without one, or that isn’t a token', () => {
    expect(sessionIdOf(token({ sub: 'u1' }))).toBeNull();
    expect(sessionIdOf(token({ session_id: '' }))).toBeNull();
    expect(sessionIdOf('opaque')).toBeNull();
    expect(sessionIdOf('a.%%%.c')).toBeNull();
  });
});

describe('the account session adapter (#232)', () => {
  it('reads the current session’s id from the browser’s cookie, or null when signed out', async () => {
    const signedIn = client({ session: { access_token: token({ session_id: 's1' }) } });
    expect(await createSupabaseAccountSession(signedIn.supabase).currentSessionId()).toBe('s1');

    const signedOut = client();
    expect(await createSupabaseAccountSession(signedOut.supabase).currentSessionId()).toBeNull();
  });

  it('lists the account’s device ids', async () => {
    const { supabase, raw, select } = client({ devices: [{ id: 'd1' }, { id: 'd2' }] });

    expect(await createSupabaseAccountSession(supabase).deviceIds()).toEqual(new Set(['d1', 'd2']));
    expect(raw.from).toHaveBeenCalledWith('devices');
    expect(select).toHaveBeenCalledWith('id');
  });

  it('fails when the devices can’t be read, so the sync changes nothing', async () => {
    const { supabase } = client({ devicesError: { message: 'JWT expired' } });
    await expect(createSupabaseAccountSession(supabase).deviceIds()).rejects.toThrow('JWT expired');
  });

  it('makes a one-time code, or none when the database refuses', async () => {
    const ok = client();
    expect(await createSupabaseAccountSession(ok.supabase).createCode()).toBe('ABCDE-FGHJK');
    expect(ok.raw.rpc).toHaveBeenCalledWith('create_pairing_code');

    const refused = client({ rpc: { data: null, error: { message: 'not signed in' } } });
    expect(await createSupabaseAccountSession(refused.supabase).createCode()).toBeNull();

    const empty = client({ rpc: { data: [], error: null } });
    expect(await createSupabaseAccountSession(empty.supabase).createCode()).toBeNull();
  });

  it('signs this session out only', async () => {
    const { supabase, signOut } = client();
    await createSupabaseAccountSession(supabase).signOut();
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
