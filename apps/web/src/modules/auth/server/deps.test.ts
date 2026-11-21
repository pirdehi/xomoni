import { connection } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeAuthGateway, fakeTwoFactorGateway } from '@test/server-helpers';
import { createServerSupabase, type ServerSupabase } from '@/shared/supabase/server';
import { createSupabaseAuthGateway } from '../infrastructure/supabase-auth-gateway';
import { createSupabaseTwoFactorGateway } from '../infrastructure/supabase-two-factor-gateway';
import { authDeps } from './deps';

vi.mock('next/server', () => ({ connection: vi.fn() }));
vi.mock('@/shared/supabase/server', () => ({ createServerSupabase: vi.fn() }));
vi.mock('../infrastructure/supabase-auth-gateway', () => ({ createSupabaseAuthGateway: vi.fn() }));
vi.mock('../infrastructure/supabase-two-factor-gateway', () => ({ createSupabaseTwoFactorGateway: vi.fn() }));

const client: object = { auth: {} };
const gateway = fakeAuthGateway();
const twoFactor = fakeTwoFactorGateway();

describe('authDeps (server composition root)', () => {
  beforeEach(() => {
    vi.mocked(connection).mockReset().mockResolvedValue(undefined);
    vi.mocked(createServerSupabase)
      .mockReset()
      .mockResolvedValue(client as ServerSupabase);
    vi.mocked(createSupabaseAuthGateway).mockReset().mockReturnValue(gateway);
    vi.mocked(createSupabaseTwoFactorGateway).mockReset().mockReturnValue(twoFactor);
  });

  it('wires the use cases to the request-bound Supabase client and the configured site URL', async () => {
    const deps = await authDeps();

    expect(deps).toEqual({ auth: gateway, twoFactor, siteUrl: 'http://localhost:3000' });
    expect(createSupabaseAuthGateway).toHaveBeenCalledWith(client);
    // Two-step verification reads the same request's session (#173).
    expect(createSupabaseTwoFactorGateway).toHaveBeenCalledWith(client);
  });

  it('waits for the request before reading the session, so no session check runs during a prerender', async () => {
    await authDeps();

    expect(connection).toHaveBeenCalledOnce();
    expect(vi.mocked(connection).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(createServerSupabase).mock.invocationCallOrder[0]!,
    );
  });

  it('never creates a client when there is no request (prerender)', async () => {
    vi.mocked(connection).mockRejectedValue(new Error('prerender interrupted'));

    await expect(authDeps()).rejects.toThrow('prerender interrupted');
    expect(createServerSupabase).not.toHaveBeenCalled();
  });

  it('creates a new client for every request', async () => {
    await authDeps();
    await authDeps();
    expect(createServerSupabase).toHaveBeenCalledTimes(2);
  });
});
