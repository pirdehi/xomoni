import 'server-only';
import type { NextRequest, NextResponse } from 'next/server';
import { createProxySupabase } from '@/shared/supabase/proxy';
import { isGuestOnly, requiresSession, ROUTES, safeNextPath } from '../domain/routes';
import { assuranceOf, secondFactorNeeded } from '../domain/two-factor';
import type { IdentityClaims } from '../domain/viewer';
import { createSupabaseTwoFactorGateway } from '../infrastructure/supabase-two-factor-gateway';

/**
 * Runs in the proxy for auth-related paths: refreshes the session cookie, then does the optimistic
 * redirects (signed out on a protected page → sign in; signed in on a guest-only page → dashboard; a session that
 * still owes a code from the account's authenticator app → the code page, #173). Pages still verify the viewer
 * themselves (`requireViewer`); this is not the security boundary.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { supabase, response, redirect } = createProxySupabase(request);

  // Must run before anything else so a refreshed token reaches the response.
  const { data } = await supabase.auth.getClaims();
  const claims = (data?.claims as IdentityClaims | undefined) ?? null;
  const path = request.nextUrl.pathname;

  // A plain URL on this site's origin: setting the path can never change the host, and the redirect needs a real
  // `URL`, not Next's `NextURL` (#285).
  const onThisSite = (pathname: string, next?: string) => {
    const url = new URL(request.nextUrl.origin);
    url.pathname = pathname;
    if (next !== undefined) url.searchParams.set('next', next);
    return url;
  };
  const here = `${path}${request.nextUrl.search}`;

  if (!claims && requiresSession(path)) return redirect(onThisSite(ROUTES.signIn, here));
  if (claims && (requiresSession(path) || isGuestOnly(path))) {
    // Only below aal2 is the provider asked whether the account has an authenticator app.
    const level = assuranceOf(claims.aal);
    const owesCode =
      level !== 'aal2' &&
      secondFactorNeeded(level, ((await createSupabaseTwoFactorGateway(supabase).factors())?.verified.length ?? 0) > 0);
    if (owesCode) {
      // A guest page's own `next` is untrusted: only a same-site path is kept.
      const next = safeNextPath(requiresSession(path) ? here : request.nextUrl.searchParams.get('next'));
      return redirect(onThisSite(ROUTES.twoFactor, next === ROUTES.dashboard ? undefined : next));
    }
    if (isGuestOnly(path)) return redirect(onThisSite(ROUTES.dashboard));
  }

  const res = response();
  res.headers.set('Cache-Control', 'private, no-store');
  return res;
}
