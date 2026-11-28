import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xomoni/db';
import { describe, expect, it, vi } from 'vitest';
import { isSuperadmin } from './supabase-superadmin';

const client = (result: { data: unknown; error: { message: string } | null }) => {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { rpc, supabase: { rpc } as unknown as SupabaseClient<Database> };
};

describe('isSuperadmin (the proxy’s console gate, #516)', () => {
  it('asks the database as the signed-in person', async () => {
    const { rpc, supabase } = client({ data: true, error: null });
    expect(await isSuperadmin(supabase)).toBe(true);
    expect(rpc).toHaveBeenCalledWith('is_superadmin');
  });

  it('says no for anyone else', async () => {
    expect(await isSuperadmin(client({ data: false, error: null }).supabase)).toBe(false);
  });

  it('says no when the database can’t answer, so the console stays closed', async () => {
    expect(await isSuperadmin(client({ data: null, error: { message: 'JWT expired' } }).supabase)).toBe(false);
  });
});
