import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { completeOAuthSignIn, signOut } from '../application/use-cases';
import { AUTH_ERROR_MESSAGES } from '../domain/auth-error';
import { ROUTES } from '../domain/routes';
import { authDeps } from './deps';

/** `GET /auth/callback`: the identity provider returns here with a one-time code. */
export async function handleOAuthCallback(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;
  const result = await completeOAuthSignIn(await authDeps(), {
    code: searchParams.get('code'),
    next: searchParams.get('next'),
    error: searchParams.get('error_description'),
  });
  if (result.ok) return NextResponse.redirect(new URL(result.next, origin));

  console.warn('oauth callback failed', result.detail);
  const target = new URL(ROUTES.signIn, origin);
  target.searchParams.set('error', AUTH_ERROR_MESSAGES[result.code]);
  return NextResponse.redirect(target);
}

/** `POST /auth/signout`: ends the session and returns home. POST only, so links can't sign people out. */
export async function handleSignOut(request: NextRequest): Promise<NextResponse> {
  await signOut(await authDeps());
  return NextResponse.redirect(new URL(ROUTES.home, request.url), 303);
}
