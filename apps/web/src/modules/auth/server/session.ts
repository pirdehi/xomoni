import 'server-only';
import { redirect } from 'next/navigation';
import { getAccount, getViewer } from '../application/use-cases';
import { ROUTES } from '../domain/routes';
import type { AccountDetails, Viewer } from '../domain/viewer';
import { authDeps } from './deps';

export type { AccountDetails, Viewer } from '../domain/viewer';

/**
 * Data Access Layer entry point: the signed-in viewer, or `null`.
 * Reads the request's cookies, so call it inside a `<Suspense>` boundary.
 */
export async function currentViewer(): Promise<Viewer | null> {
  return getViewer(await authDeps());
}

/** Like {@link currentViewer}, but sends signed-out visitors to sign in and back here afterwards. */
export async function requireViewer(returnTo?: string): Promise<Viewer> {
  const viewer = await currentViewer();
  if (!viewer) redirect(returnTo ? `${ROUTES.signIn}?next=${encodeURIComponent(returnTo)}` : ROUTES.signIn);
  return viewer;
}

/** The account page's data; sends signed-out visitors to sign in and back afterwards. */
export async function requireAccount(returnTo: string): Promise<AccountDetails> {
  const account = await getAccount(await authDeps());
  if (!account) redirect(`${ROUTES.signIn}?next=${encodeURIComponent(returnTo)}`);
  return account;
}
