import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xomoni/db';

/**
 * Whether the signed-in person is a super-admin (`public.is_superadmin()`, ADR-0048), for the proxy's gate in front of
 * the console (#516). Anything but a clear yes, an error included, is a no: the console stays closed when in doubt.
 */
export async function isSuperadmin(supabase: SupabaseClient<Database>): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_superadmin');
  return !error && data;
}
