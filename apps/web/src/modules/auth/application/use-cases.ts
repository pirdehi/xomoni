import { authFailure, type AuthFailure, type AuthResult } from '../domain/auth-error';
import { ROUTES, safeNextPath } from '../domain/routes';
import { viewerFromClaims, type Viewer } from '../domain/viewer';
import type { AuthGateway, OAuthProvider } from './ports';

/** Dependencies every auth use case receives from the composition root. */
export interface AuthDeps {
  /** The identity provider. */
  auth: AuthGateway;
  /** Public origin of the website, such as `https://xomoni.com`; used to build return URLs. */
  siteUrl: string;
}

/** Returns the signed-in viewer, or `null` when signed out. */
export async function getViewer({ auth }: Pick<AuthDeps, 'auth'>): Promise<Viewer | null> {
  const claims = await auth.currentClaims();
  return claims ? viewerFromClaims(claims) : null;
}

/** Starts OAuth sign-in; on success returns the provider URL. `next` is where to land afterwards. */
export async function startOAuthSignIn(deps: AuthDeps, provider: OAuthProvider, next?: string | null) {
  const callback = new URL(ROUTES.oauthCallback, deps.siteUrl);
  callback.searchParams.set('next', safeNextPath(next));
  return deps.auth.startOAuth(provider, callback.toString());
}

/** Completes OAuth sign-in from the callback's query; returns where to send the browser. */
export async function completeOAuthSignIn(
  { auth }: Pick<AuthDeps, 'auth'>,
  query: { code: string | null; next: string | null; error: string | null },
): Promise<{ ok: true; next: string } | AuthFailure> {
  if (!query.code) return authFailure('provider_error', query.error ?? 'missing code');
  const result = await auth.exchangeCode(query.code);
  return result.ok ? { ok: true, next: safeNextPath(query.next) } : result;
}

/** Signs out on this device. */
export async function signOut({ auth }: Pick<AuthDeps, 'auth'>): Promise<void> {
  await auth.signOut();
}

/** Deletes the signed-in account, then ends the session. */
export async function deleteAccount({ auth }: Pick<AuthDeps, 'auth'>): Promise<AuthResult> {
  if (!(await auth.currentClaims())) return authFailure('not_signed_in');
  const result = await auth.deleteAccount();
  if (result.ok) await auth.signOut();
  return result;
}
