import 'server-only';
import { redirect } from 'next/navigation';
import { getAccount, getSessionState } from '../application/use-cases';
import { ROUTES, safeNextPath, twoFactorPath } from '../domain/routes';
import type { AccountDetails, Viewer } from '../domain/viewer';
import { authDeps } from './deps';

export type { AccountDetails, Viewer } from '../domain/viewer';

const signInFor = (returnTo?: string) =>
  returnTo ? `${ROUTES.signIn}?next=${encodeURIComponent(returnTo)}` : ROUTES.signIn;

/**
 * Data Access Layer entry point: the signed-in viewer, or `null`. A session that still owes a code from the account's
 * authenticator app (`aal1` with a verified factor, #173) is not signed in yet, so it gets `null` too.
 * Reads the request's cookies, so call it inside a `<Suspense>` boundary.
 */
export async function currentViewer(): Promise<Viewer | null> {
  const state = await getSessionState(await authDeps());
  return state.status === 'signed_in' ? state.viewer : null;
}

/**
 * Like {@link currentViewer}, but sends signed-out visitors to sign in and back here afterwards, and a session that
 * owes a code to the code page and back (#173). This is the server's check of the session's `aal` claim: a page
 * behind it never renders for a stolen password or session alone when the account has an authenticator app.
 */
export async function requireViewer(returnTo?: string): Promise<Viewer> {
  const state = await getSessionState(await authDeps());
  if (state.status === 'signed_out') redirect(signInFor(returnTo));
  if (state.status === 'second_factor_needed') redirect(twoFactorPath(returnTo));
  return state.viewer;
}

/**
 * The account page's data; sends signed-out visitors to sign in and back afterwards, and a session that owes a code
 * from the account's authenticator app to the code page first (#173).
 */
export async function requireAccount(returnTo: string): Promise<AccountDetails> {
  const deps = await authDeps();
  const state = await getSessionState(deps);
  if (state.status === 'second_factor_needed') redirect(twoFactorPath(returnTo));
  const account = state.status === 'signed_in' ? await getAccount(deps) : null;
  if (!account) redirect(signInFor(returnTo));
  return account;
}

/**
 * The code page's guard (#173): the person who owes a code, or a redirect. Signed out → sign in, returning to `next`;
 * nothing owed (already `aal2`, or no authenticator app) → straight on to `next`, same-site only.
 */
export async function requireSecondFactorStep(next: string | null): Promise<Viewer> {
  const state = await getSessionState(await authDeps());
  if (state.status === 'signed_out') redirect(signInFor(safeNextPath(next)));
  if (state.status === 'signed_in') redirect(safeNextPath(next));
  return state.viewer;
}
