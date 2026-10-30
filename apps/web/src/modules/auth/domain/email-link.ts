import { safeNextPath } from './routes';

/** The kinds of one-time links Xomoni emails, as Supabase's `verifyOtp` names them. */
export type EmailLinkType = 'email' | 'recovery' | 'email_change' | 'invite';

/** Where each kind of link lands when it carries no `next` path. */
const DEFAULT_NEXT: Record<EmailLinkType, string> = {
  email: '/dashboard',
  recovery: '/reset-password',
  email_change: '/account?email=confirmed',
  invite: '/reset-password',
};

/** Older names Supabase may still put in links, mapped to current ones. */
const ALIASES: Record<string, EmailLinkType> = { signup: 'email', magiclink: 'email' };

/** A one-time email link, checked and ready to verify. */
export interface EmailLink {
  /** Hashed one-time token from the email. */
  tokenHash: string;
  /** What the link proves. */
  type: EmailLinkType;
  /** Same-site path to open after verifying. */
  next: string;
}

/**
 * Reads the query of a `/auth/confirm` link. Returns `null` for anything malformed, so a broken or
 * tampered link fails before reaching Supabase; `next` is always a same-site path.
 */
export function parseEmailLink(query: {
  token_hash?: string | null;
  type?: string | null;
  next?: string | null;
}): EmailLink | null {
  const rawType = query.type ?? '';
  const type = ALIASES[rawType] ?? (rawType in DEFAULT_NEXT ? (rawType as EmailLinkType) : null);
  const tokenHash = query.token_hash ?? '';
  if (!type || !/^[A-Za-z0-9_-]{16,256}$/.test(tokenHash)) return null;
  return { tokenHash, type, next: safeNextPath(query.next, DEFAULT_NEXT[type]) };
}
