/** The signed-in person as the website shows them. Holds no tokens or secrets. */
export interface Viewer {
  /** Supabase user id (`auth.users.id`). */
  id: string;
  /** The account's email address. */
  email: string;
  /** Display name from the identity provider, or the email when there is none. */
  name: string;
  /** Profile picture from the identity provider, if any. */
  avatarUrl: string | null;
  /** How this account can sign in, such as `email` (password) and `google`. */
  signInMethods: string[];
}

/** The account page's view of the signed-in person: the viewer plus an email change awaiting confirmation. */
export interface AccountDetails extends Viewer {
  /** The new address while an email change waits for both confirmations, otherwise `null`. */
  pendingEmail: string | null;
}

/** The subset of verified access-token claims Xomoni reads. */
export interface IdentityClaims {
  /** Subject: the user id. */
  sub: string;
  /** Email address on the account. */
  email?: string;
  /** Profile data from sign-up or the identity provider. */
  user_metadata?: Record<string, unknown>;
  /** Data only the server can set; `providers` lists the account's sign-in methods. */
  app_metadata?: { providers?: unknown };
}

/** Builds the viewer from verified token claims, falling back to the email for a missing name. */
export function viewerFromClaims(claims: IdentityClaims): Viewer {
  const meta = claims.user_metadata ?? {};
  const email = claims.email ?? '';
  const name = text(meta.full_name) ?? text(meta.name) ?? email;
  const providers = claims.app_metadata?.providers;
  const signInMethods = Array.isArray(providers) ? providers.filter((p): p is string => typeof p === 'string') : [];
  return { id: claims.sub, email, name, avatarUrl: text(meta.avatar_url), signInMethods };
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
