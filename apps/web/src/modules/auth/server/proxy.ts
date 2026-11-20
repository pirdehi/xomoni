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

  // A plain URL on this site's origin: setting the path can never change the host, and the redirect needs a real
  // `URL`, not Next's `NextURL` (#285).
  const onThisSite = (pathname: string) => {
    const url = new URL(request.nextUrl.origin);
    url.pathname = pathname;
    return url;
  };
  const to = (pathname: string) => redirect(onThisSite(pathname));

  if (!signedIn && requiresSession(path)) {
    const url = onThisSite(ROUTES.signIn);
    url.searchParams.set('next', `${path}${request.nextUrl.search}`);
    return redirect(url);
  }
  if (signedIn && isGuestOnly(path)) return to(ROUTES.dashboard);

  const res = response();
  res.headers.set('Cache-Control', 'private, no-store');
  return res;
}
