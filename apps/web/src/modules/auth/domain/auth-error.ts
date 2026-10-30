import type { FieldErrors } from './credentials';

/** Every way an auth action can fail, independent of the identity provider. */
export type AuthErrorCode =
  | 'invalid_input'
  | 'invalid_credentials'
  | 'wrong_current_password'
  | 'email_not_confirmed'
  | 'account_exists'
  | 'email_unusable'
  | 'weak_password'
  | 'same_password'
  | 'link_invalid_or_expired'
  | 'captcha_failed'
  | 'rate_limited'
  | 'reauthentication_needed'
  | 'not_signed_in'
  | 'signup_disabled'
  | 'provider_error'
  | 'unknown';

/** A failed auth action: a stable code, optional per-field messages, and provider detail for logs. */
export interface AuthFailure {
  /** Discriminant for results. */
  ok: false;
  /** What went wrong, in domain terms. */
  code: AuthErrorCode;
  /** Messages for individual form fields, when the input itself was the problem. */
  fieldErrors?: FieldErrors;
  /** Provider detail for server logs; never shown to people. */
  detail?: string;
}

/** The result of an auth action that returns nothing on success. */
export type AuthResult = { ok: true } | AuthFailure;

/** Builds a failure result. */
export function authFailure(code: AuthErrorCode, detail?: string): AuthFailure {
  return { ok: false, code, detail };
}

/** Builds a failure for invalid form input. */
export function invalidInput(fieldErrors: FieldErrors): AuthFailure {
  return { ok: false, code: 'invalid_input', fieldErrors };
}

/**
 * What people read for each failure. Worded so it never reveals whether an account exists for an
 * email address (no "user not found", no "email already registered").
 */
export const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  invalid_input: 'Check the highlighted fields.',
  invalid_credentials: 'That email and password don’t match an account.',
  wrong_current_password: 'Your current password is incorrect.',
  email_not_confirmed: 'Confirm your email address first. We can send the link again.',
  account_exists: 'Check your inbox to continue.',
  email_unusable: 'That email address can’t be used. Check it or try another one.',
  weak_password: 'Choose a stronger password: at least 10 characters, with a letter and a number.',
  same_password: 'Choose a password you haven’t used for this account.',
  link_invalid_or_expired: 'That link is invalid, already used or expired. Request a new one.',
  captcha_failed: 'We couldn’t confirm you’re human. Wait for the check to finish, then try again.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  reauthentication_needed: 'For your security, sign in again, then retry.',
  not_signed_in: 'Your session has ended. Sign in again.',
  signup_disabled: 'New accounts are paused right now. Try again later.',
  provider_error: 'Sign-in with the provider didn’t complete. Try again.',
  unknown: 'Something went wrong on our side. Try again in a moment.',
};
