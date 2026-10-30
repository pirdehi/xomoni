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
}

/** The subset of verified access-token claims Xomoni reads. */
export interface IdentityClaims {
  /** Subject: the user id. */
  sub: string;
  /** Email address on the account. */
  email?: string;
  /** Profile data from sign-up or the identity provider. */
  user_metadata?: Record<string, unknown>;
}

/** Builds the viewer from verified token claims, falling back to the email for a missing name. */
export function viewerFromClaims(claims: IdentityClaims): Viewer {
  const meta = claims.user_metadata ?? {};
  const email = claims.email ?? '';
  const name = text(meta.full_name) ?? text(meta.name) ?? email;
  return { id: claims.sub, email, name, avatarUrl: text(meta.avatar_url) };
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
