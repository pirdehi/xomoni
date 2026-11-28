import type { FieldErrors } from './credentials';

/** Every way an auth action can fail, independent of the identity provider. */
export type AuthErrorCode =
  | 'invalid_input'
  | 'invalid_credentials'
  | 'wrong_current_password'
  | 'current_password_required'
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
  | 'invalid_code'
  | 'code_expired'
  | 'second_factor_required'
  | 'two_factor_unavailable'
  | 'too_many_factors'
  | 'factor_name_taken'
  | 'factor_not_found'
  | 'subscription_not_ended'
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
  current_password_required: 'Enter your current password to choose a new one.',
  email_not_confirmed: 'Confirm your email address first. We can send the link again.',
  account_exists: 'Check your inbox to continue.',
  email_unusable: 'That email address can’t be used. Check it or try another one.',
  weak_password: 'Choose a stronger password: at least 10 characters, with a letter and a number.',
  same_password: 'Choose a password you haven’t used for this account.',
  link_invalid_or_expired: 'That link is invalid, already used or expired. Request a new one.',
  captcha_failed: 'We couldn’t confirm you’re human. Wait for the check to finish, then try again.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  reauthentication_needed: 'For your security, sign in again, then retry.',
  subscription_not_ended:
    'We couldn’t cancel your subscription with Polar, our payment provider, so nothing was deleted. Try again in a moment.',
  not_signed_in: 'Your session has ended. Sign in again.',
  signup_disabled: 'New accounts are paused right now. Try again later.',
  provider_error: 'Sign-in with the provider didn’t complete. Try again.',
  invalid_code:
    'That code didn’t work. Enter the newest code from your app; if it keeps failing, check the time on your phone.',
  code_expired: 'That took too long. Enter the newest code from your app.',
  second_factor_required: 'For your security, enter a code from your authenticator app first.',
  two_factor_unavailable: 'Two-step verification is unavailable right now. Try again later.',
  too_many_factors: 'This account has as many authenticator apps as it can. Remove one first.',
  factor_name_taken: 'You already have an app with that name. Choose another name.',
  factor_not_found: 'That authenticator app is no longer on your account. Reload the page.',
  unknown: 'Something went wrong on our side. Try again in a moment.',
};
