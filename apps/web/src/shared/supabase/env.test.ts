import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// env.ts reads the variables once, at import; each test imports a fresh copy.
const load = () => import('./env');

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Supabase public settings', () => {
  it('exports the configured URL and publishable key', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcd.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_live');

    const env = await load();
    expect(env.SUPABASE_URL).toBe('https://abcd.supabase.co');
    expect(env.SUPABASE_KEY).toBe('sb_publishable_live');
  });

  it.each([undefined, ''])('fails clearly when the URL is %j', async (value) => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', value);

    await expect(load()).rejects.toThrow(
      'Missing NEXT_PUBLIC_SUPABASE_URL: copy apps/web/.env.example to apps/web/.env.local, or set it in Vercel.',
    );
  });

  it.each([undefined, ''])('fails clearly when the publishable key is %j', async (value) => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', value);

    await expect(load()).rejects.toThrow('Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  });
});
