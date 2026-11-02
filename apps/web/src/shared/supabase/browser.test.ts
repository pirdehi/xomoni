import { describe, expect, it, vi } from 'vitest';
import { createBrowserSupabase } from './browser';

const createBrowserClient = vi.hoisted(() => vi.fn<(url: string, key: string, options?: object) => object>());
vi.mock('@supabase/ssr', () => ({ createBrowserClient }));

describe('createBrowserSupabase', () => {
  it('creates the browser client with the public Supabase URL and publishable key only', () => {
    const client: object = { auth: {} };
    createBrowserClient.mockReturnValue(client);

    expect(createBrowserSupabase()).toBe(client);
    // No custom cookie methods: @supabase/ssr writes the session cookie the server reads.
    expect(createBrowserClient).toHaveBeenCalledWith('http://127.0.0.1:54321', 'sb_publishable_test');
  });
});
