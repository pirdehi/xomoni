import { createBrowserSupabase } from './browser';

/**
 * Calls `onChange` with the signed-in person's email as this browser's session cookie has it, at once and again
 * whenever the browser signs in or out; null when signed out, empty when the session names no email. The second
 * argument is the display name from sign-up or Google (`full_name`, else `name`), empty when there is none, so every
 * avatar shows the same initial (#239). Returns the function that stops listening.
 *
 * For what the page shows, such as the header's account menu: it reads the cookie without asking Supabase, so it
 * is not a security check. Pages verify the viewer on the server.
 */
export function watchSessionEmail(onChange: (email: string | null, name?: string) => void): () => void {
  const { data } = createBrowserSupabase().auth.onAuthStateChange((_event, session) => {
    if (!session) {
      onChange(null, '');
      return;
    }
    // Typed as always there, but a session from an older client may come without it: `Object` turns that into {}.
    const meta = Object(session.user.user_metadata) as Record<string, unknown>;
    const name = [meta.full_name, meta.name].find((v): v is string => typeof v === 'string' && v.trim() !== '');
    onChange(session.user.email ?? '', name?.trim() ?? '');
  });
  return () => data.subscription.unsubscribe();
}
