import 'server-only';
import type { NextRequest, NextResponse } from 'next/server';
import { createProxySupabase } from '@/shared/supabase/proxy';
import { isGuestOnly, requiresSession, ROUTES } from '../domain/routes';

/**
 * Runs in the proxy for auth-related paths: refreshes the session cookie, then does the optimistic
 * redirects (signed out on a protected page → sign in; signed in on a guest-only page → dashboard).
 * Pages still verify the viewer themselves; this is not the security boundary.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { supabase, response, redirect } = createProxySupabase(request);

  // Must run before anything else so a refreshed token reaches the response.
  const { data } = await supabase.auth.getClaims();
  const signedIn = !!data?.claims;
  const path = request.nextUrl.pathname;

  const to = (pathname: string) => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    url.search = '';
    return redirect(url);
  };

  if (!signedIn && requiresSession(path)) return to(ROUTES.signIn);
  if (signedIn && isGuestOnly(path)) return to(ROUTES.dashboard);

  const res = response();
  res.headers.set('Cache-Control', 'private, no-store');
  return res;
}
