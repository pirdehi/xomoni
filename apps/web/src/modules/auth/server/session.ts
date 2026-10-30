import 'server-only';
import { redirect } from 'next/navigation';
import { getViewer } from '../application/use-cases';
import { ROUTES } from '../domain/routes';
import type { Viewer } from '../domain/viewer';
import { authDeps } from './deps';

export type { Viewer } from '../domain/viewer';

/**
 * Data Access Layer entry point: the signed-in viewer, or `null`.
 * Reads the request's cookies, so call it inside a `<Suspense>` boundary.
 */
export async function currentViewer(): Promise<Viewer | null> {
  return getViewer(await authDeps());
}

/** Like {@link currentViewer}, but redirects signed-out visitors to the sign-in page. */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await currentViewer();
  if (!viewer) redirect(ROUTES.signIn);
  return viewer;
}
