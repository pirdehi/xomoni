import type { AuthFailure, AuthResult } from '../domain/auth-error';
import type { EmailLinkType } from '../domain/email-link';
import type { IdentityClaims } from '../domain/viewer';

/** OAuth providers the website offers. */
export type OAuthProvider = 'google';

/**
 * Everything the auth use cases need from an identity provider.
 * The Supabase adapter implements it, in the browser and on the server; tests use an in-memory fake.
 * Every method that sends an email or checks a password accepts a captcha token, which the provider
 * verifies with Cloudflare Turnstile.
 */
export interface AuthGateway {
  /** Verified claims of the current session, or `null` when signed out. */
  currentClaims(): Promise<IdentityClaims | null>;
  /** The account's current and pending email, read fresh from the provider, or `null` when signed out. */
  currentAccount(): Promise<{ email: string; pendingEmail: string | null } | null>;
  /** Starts an OAuth sign-in and returns the provider URL to send the browser to. */
  startOAuth(provider: OAuthProvider, redirectTo: string): Promise<{ ok: true; url: string } | AuthFailure>;
  /** Trades a one-time OAuth code for a session cookie. */
  exchangeCode(code: string): Promise<AuthResult>;
  /** Creates an account and emails a confirmation link. Must not reveal whether the email is taken. */
  signUp(input: {
    email: string;
    password: string;
    name?: string;
    captchaToken?: string;
    emailRedirectTo: string;
  }): Promise<AuthResult>;
  /** Signs in with email and password. */
  signInWithPassword(input: { email: string; password: string; captchaToken?: string }): Promise<AuthResult>;
  /** Emails a password reset link, if an account exists. */
  sendPasswordReset(input: { email: string; captchaToken?: string; redirectTo: string }): Promise<AuthResult>;
  /** Emails the sign-up confirmation link again, if the account is still unconfirmed. */
  resendConfirmation(input: { email: string; captchaToken?: string; emailRedirectTo: string }): Promise<AuthResult>;
  /** Verifies a one-time email link; on success the browser holds a session. */
  verifyEmailLink(input: { tokenHash: string; type: EmailLinkType }): Promise<AuthResult>;
  /** Sets a new password for the signed-in account. */
  updatePassword(password: string): Promise<AuthResult>;
  /** Starts an email change; both the old and the new address get a confirmation link. */
  changeEmail(input: { email: string; emailRedirectTo: string }): Promise<AuthResult>;
  /**
   * Ends the session on this device, or with `everywhere` every session of the account, this one included:
   * the others can no longer renew theirs, and their current access expires within the hour.
   */
  signOut(everywhere?: boolean): Promise<void>;
  /** Deletes the signed-in account; devices and job summaries cascade in the database. */
  deleteAccount(): Promise<AuthResult>;
}
