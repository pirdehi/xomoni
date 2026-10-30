import 'server-only';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@xomoni/db';
import { cookies } from 'next/headers';
import { SUPABASE_KEY, SUPABASE_URL } from './env';

/** A Supabase client bound to the current request's cookies. */
export type ServerSupabase = Awaited<ReturnType<typeof createServerSupabase>>;

/**
 * Creates a Supabase client for Server Components, Server Actions and Route Handlers.
 * Make a new one per request; never share one across requests.
 */
export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components can't set cookies; the proxy refreshes the session instead.
        }
      },
    },
  });
}
