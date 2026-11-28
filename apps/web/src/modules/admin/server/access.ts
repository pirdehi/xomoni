import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { currentViewer, requireViewer, sameSitePath, secondFactorPath } from '@/modules/auth/server/session';
import { createServerSupabase } from '@/shared/supabase/server';
import type { ConsoleStore } from '../application/ports';
import { CONSOLE_PATHS, consoleNext } from '../domain/routes';
import { createSupabaseConsoleStore } from '../infrastructure/supabase-console-store';

/** The super-admin using the console. */
export interface ConsoleAdmin {
  /** Their user id. */
  readonly id: string;
  /** Their sign-in email, shown in the console's header. */
  readonly email: string;
}

/** A super-admin and the store, as them, for one request. */
export interface ConsoleSession {
  /** Who is signed in. */
  readonly admin: ConsoleAdmin;
  /** The console's data, read and changed as them. */
  readonly store: ConsoleStore;
}

/** What the console's access checks need; tests replace them. */
export interface ConsoleDeps {
  /**
   * The signed-in person, or a redirect: to the console's sign-in and back to `returnTo` when signed out, to the code
   * page first when the session owes a code from the account's authenticator app (auth's `requireViewer`).
   */
  readonly requireViewer: (returnTo: string) => Promise<ConsoleAdmin>;
  /** The signed-in person, or null (signed out, or still owing a code). */
  readonly currentViewer: () => Promise<ConsoleAdmin | null>;
  /** The store, as the signed-in person. */
  readonly store: () => Promise<ConsoleStore>;
}

const defaultDeps: ConsoleDeps = {
  requireViewer,
  currentViewer,
  store: async () => createSupabaseConsoleStore(await createServerSupabase()),
};

/**
 * The console's one access check (#516), run by every console page and every console action: a signed-out visitor goes
 * to the console's sign-in and back to `returnTo`; a session that owes a code from the account's authenticator app goes
 * to the code page first; anyone signed in who isn't a super-admin gets the site's 404, the same as an address that
 * doesn't exist. The database checks again in each `admin_*` function.
 */
export async function requireSuperadmin(returnTo: string, deps: ConsoleDeps = defaultDeps): Promise<ConsoleSession> {
  const viewer = await deps.requireViewer(returnTo);
  const store = await deps.store();
  if (!(await store.isSuperadmin())) notFound();
  return { admin: { id: viewer.id, email: viewer.email }, store };
}

/**
 * The signed-in super-admin, or null for anyone else; it never redirects. The console's layout uses it to decide
 * whether to draw the console around a page at all, so nobody else ever receives the console's navigation.
 */
export async function consoleAdmin(deps: ConsoleDeps = defaultDeps): Promise<ConsoleAdmin | null> {
  const viewer = await deps.currentViewer();
  if (!viewer) return null;
  const store = await deps.store();
  const superadmin = await store.isSuperadmin().catch(() => false);
  return superadmin ? { id: viewer.id, email: viewer.email } : null;
}

/** Where the console's sign-in goes once it succeeded. */
export interface ConsoleSignInTargets {
  /** The console page to open: `?next=` when it is a console page, otherwise the overview. */
  readonly next: string;
  /** The code page, returning to {@link ConsoleSignInTargets.next}, for an account with an authenticator app. */
  readonly twoFactor: string;
}

/**
 * The console's sign-in page (`/product/login`): anyone may open it, signed in or not; a super-admin who is already
 * signed in goes straight on to `next`. `next` is untrusted: only a console page on this site is followed.
 */
export async function consoleSignInStep(
  rawNext: string | null,
  deps: ConsoleDeps = defaultDeps,
): Promise<ConsoleSignInTargets> {
  const next = consoleNext(sameSitePath(rawNext, CONSOLE_PATHS.overview));
  if (await consoleAdmin(deps)) redirect(next);
  return { next, twoFactor: secondFactorPath(next) };
}
