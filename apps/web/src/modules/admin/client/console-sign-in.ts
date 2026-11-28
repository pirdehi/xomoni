import { createBrowserSupabase } from '@/shared/supabase/browser';
import { signInToConsole, type ConsoleSignInInput } from '../application/sign-in';
import { createSupabaseConsoleSignIn } from '../infrastructure/supabase-console-sign-in';

/**
 * Browser composition root for the console's sign-in (#516): the call goes from the person's browser straight to
 * Supabase Auth, so its per-IP limits and the Turnstile check apply to the person, and the session cookie is written by
 * `@supabase/ssr` for the server to read. An account that isn't a super-admin is signed out again at once.
 */
export const browserConsole = {
  /** Signs in to the console with email and password. */
  signIn: (input: ConsoleSignInInput) => signInToConsole(createSupabaseConsoleSignIn(createBrowserSupabase()), input),
};
