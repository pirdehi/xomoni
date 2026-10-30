import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './types';
import { SUPABASE_KEY, SUPABASE_URL } from './env';

export function createClient() {
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_KEY);
}
