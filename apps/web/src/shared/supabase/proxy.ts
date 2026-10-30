import { createServerClient } from '@supabase/ssr';
import type { Database } from '@xomoni/db';
import { NextResponse, type NextRequest } from 'next/server';
import { SUPABASE_KEY, SUPABASE_URL } from './env';

/** A Supabase client for the proxy, plus the response that carries any refreshed session cookies. */
export interface ProxySupabase {
  /** The client; reading the session through it refreshes an expiring token. */
  supabase: ReturnType<typeof createServerClient<Database>>;
  /** The pass-through response, with refreshed cookies and headers applied. */
  response: () => NextResponse;
  /** Builds a redirect that keeps the refreshed cookies. */
  redirect: (url: URL) => NextResponse;
}

/**
 * Creates a Supabase client that reads cookies from the incoming request and writes refreshed ones
 * to the outgoing response, as `@supabase/ssr` requires in a proxy (formerly middleware).
 */
export function createProxySupabase(request: NextRequest): ProxySupabase {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  return {
    supabase,
    response: () => response,
    redirect(url) {
      const redirect = NextResponse.redirect(url);
      response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
      return redirect;
    },
  };
}
