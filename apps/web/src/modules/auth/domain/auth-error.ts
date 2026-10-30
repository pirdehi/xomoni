/** Every way an auth action can fail, independent of the identity provider. */
export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'link_invalid_or_expired'
  | 'rate_limited'
  | 'not_signed_in'
  | 'provider_error'
  | 'unknown';

/** A failed auth action: a stable code plus the provider's text for logs, never shown raw to people. */
export interface AuthFailure {
  /** Discriminant for results. */
  ok: false;
  /** What went wrong, in domain terms. */
  code: AuthErrorCode;
  /** Provider detail for server logs. */
  detail?: string;
}

/** The result of an auth action that returns nothing on success. */
export type AuthResult = { ok: true } | AuthFailure;

/** Builds a failure result. */
export function authFailure(code: AuthErrorCode, detail?: string): AuthFailure {
  return { ok: false, code, detail };
}

/** What people read for each failure. Worded so it never reveals whether an account exists. */
export const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  invalid_credentials: 'That email and password don’t match an account.',
  email_not_confirmed: 'Confirm your email address first. We can send the link again.',
  link_invalid_or_expired: 'That link is invalid or has expired. Request a new one.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  not_signed_in: 'Your session has ended. Sign in again.',
  provider_error: 'Sign-in with the provider didn’t complete. Try again.',
  unknown: 'Something went wrong on our side. Try again in a moment.',
};
