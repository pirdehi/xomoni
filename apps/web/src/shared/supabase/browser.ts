import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@xomoni/db';
import { SUPABASE_KEY, SUPABASE_URL } from './env';

/** A Supabase client for the browser, signed in through the session cookie. */
export type BrowserSupabase = ReturnType<typeof createBrowserSupabase>;

/** Creates (or reuses) the browser Supabase client. Only for Client Components. */
export function createBrowserSupabase() {
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_KEY);
}
