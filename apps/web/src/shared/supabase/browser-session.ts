import { createBrowserSupabase } from './browser';

/**
 * Calls `onChange` with the signed-in person's email as this browser's session cookie has it, at once and again
 * whenever the browser signs in or out; null when signed out, empty when the session names no email. Returns the
 * function that stops listening.
 *
 * For what the page shows, such as the header's account menu: it reads the cookie without asking Supabase, so it
 * is not a security check. Pages verify the viewer on the server.
 */
export function watchSessionEmail(onChange: (email: string | null) => void): () => void {
  const { data } = createBrowserSupabase().auth.onAuthStateChange((_event, session) => {
    onChange(session ? (session.user.email ?? '') : null);
  });
  return () => data.subscription.unsubscribe();
}
